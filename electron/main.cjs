const { spawn } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const { app, BrowserWindow, dialog, globalShortcut, screen, session, shell } = require('electron');
const { autoUpdater } = require('electron-updater');

const BACKEND_STARTUP_TIMEOUT_MS = 20_000;
const BACKEND_HEALTH_RETRY_MS = 250;
const DEVELOPMENT_BACKEND_URL = 'http://127.0.0.1:5000';

let backendProcess;
let backendUrl;
let isQuitting = false;
let mainWindow;
let overlayWindow;

function log(level, message, metadata = {}) {
  const entry = JSON.stringify({ timestamp: new Date().toISOString(), level, message, metadata });
  if (level === 'error') {
    console.error(entry);
    return;
  }
  if (level === 'warn') {
    console.warn(entry);
    return;
  }
  console.log(entry);
}

function normalizeLocalBackendUrl(value) {
  const url = new URL(value);
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(url.hostname)) {
    throw new Error('COPILOT_BACKEND_URL must be a local HTTP URL.');
  }
  return url.origin;
}

function getOrCreateBackendSecret() {
  const secretPath = path.join(app.getPath('userData'), 'backend-jwt-secret');
  if (fs.existsSync(secretPath)) {
    return fs.readFileSync(secretPath, 'utf8').trim();
  }
  const secret = crypto.randomBytes(48).toString('hex');
  fs.mkdirSync(path.dirname(secretPath), { recursive: true });
  fs.writeFileSync(secretPath, secret, { encoding: 'utf8', mode: 0o600 });
  return secret;
}

function waitForBackend(url, timeoutMs = BACKEND_STARTUP_TIMEOUT_MS) {
  const startedAt = Date.now();
  return new Promise((resolve, reject) => {
    const checkHealth = async () => {
      try {
        const response = await fetch(`${url}/health`, { signal: AbortSignal.timeout(1_000) });
        if (response.ok) {
          resolve();
          return;
        }
      } catch {
        // Backend may still be starting.
      }
      if (Date.now() - startedAt >= timeoutMs) {
        reject(new Error('Backend readiness timed out.'));
        return;
      }
      setTimeout(checkHealth, BACKEND_HEALTH_RETRY_MS);
    };
    void checkHealth();
  });
}

function startPackagedBackend() {
  const backendEntry = path.join(app.getAppPath(), 'dist', 'index.cjs');
  if (!fs.existsSync(backendEntry)) {
    return Promise.reject(new Error('Packaged backend entrypoint is missing.'));
  }

  const childEnvironment = {
    ...process.env,
    ELECTRON_RUN_AS_NODE: '1',
    NODE_ENV: 'production',
    PORT: '0',
    JWT_SECRET: getOrCreateBackendSecret(),
    COPILOT_DATA_DIR: path.join(app.getPath('userData'), 'data'),
  };
  backendProcess = spawn(process.execPath, [backendEntry], {
    env: childEnvironment,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  backendProcess.stderr.resume();

  return new Promise((resolve, reject) => {
    let isSettled = false;
    let stdoutBuffer = '';
    const timeout = setTimeout(() => {
      if (!isSettled) {
        isSettled = true;
        reject(new Error('Packaged backend did not report readiness.'));
      }
    }, BACKEND_STARTUP_TIMEOUT_MS);

    backendProcess.stdout.setEncoding('utf8');
    backendProcess.stdout.on('data', (chunk) => {
      stdoutBuffer += chunk;
      const lines = stdoutBuffer.split(/\r?\n/);
      stdoutBuffer = lines.pop() ?? '';
      for (const line of lines) {
        if (!line.startsWith('COPILOT_BACKEND_READY=')) {
          continue;
        }
        try {
          const readiness = JSON.parse(line.slice('COPILOT_BACKEND_READY='.length));
          if (!Number.isInteger(readiness.port) || readiness.port < 1 || readiness.port > 65535) {
            throw new Error('Invalid backend readiness port.');
          }
          backendUrl = `http://127.0.0.1:${readiness.port}`;
          void waitForBackend(backendUrl).then(() => {
            if (!isSettled) {
              isSettled = true;
              clearTimeout(timeout);
              resolve();
            }
          }).catch(() => {
            if (!isSettled) {
              isSettled = true;
              clearTimeout(timeout);
              reject(new Error('Packaged backend health check failed.'));
            }
          });
        } catch {
          if (!isSettled) {
            isSettled = true;
            clearTimeout(timeout);
            reject(new Error('Packaged backend readiness output was invalid.'));
          }
        }
      }
    });
    backendProcess.once('error', () => {
      if (!isSettled) {
        isSettled = true;
        clearTimeout(timeout);
        reject(new Error('Packaged backend could not be started.'));
      }
    });
    backendProcess.once('exit', (code) => {
      backendProcess = undefined;
      if (!isSettled) {
        isSettled = true;
        clearTimeout(timeout);
        reject(new Error(`Packaged backend exited before readiness with code ${code ?? 'unknown'}.`));
      } else if (!isQuitting) {
        log('error', 'Packaged backend exited unexpectedly.', { exitCode: code ?? 'unknown' });
        void dialog.showMessageBox({
          type: 'error',
          title: 'Interview Copilot Backend Stopped',
          message: 'The local backend stopped unexpectedly. Please restart the application.',
        });
      }
    });
  });
}

async function prepareBackend() {
  if (process.env.COPILOT_BACKEND_URL) {
    backendUrl = normalizeLocalBackendUrl(process.env.COPILOT_BACKEND_URL);
    await waitForBackend(backendUrl);
    return;
  }
  if (!app.isPackaged || process.env.NODE_ENV === 'development') {
    backendUrl = DEVELOPMENT_BACKEND_URL;
    await waitForBackend(backendUrl);
    return;
  }
  await startPackagedBackend();
}

function secureWindow(window) {
  window.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const target = new URL(url);
      if (target.protocol === 'https:') {
        void shell.openExternal(target.toString());
      }
    } catch {
      // Invalid navigation is denied.
    }
    return { action: 'deny' };
  });
  window.webContents.on('will-navigate', (event, targetUrl) => {
    try {
      if (new URL(targetUrl).origin !== new URL(backendUrl).origin) {
        event.preventDefault();
      }
    } catch {
      event.preventDefault();
    }
  });
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    title: 'Interview Copilot',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      preload: path.join(__dirname, 'preload.cjs'),
      enableBlinkFeatures: 'GetDisplayMedia',
    },
  });
  secureWindow(mainWindow);
  void mainWindow.loadURL(backendUrl);
  if (process.env.NODE_ENV === 'development') {
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    mainWindow.webContents.on('devtools-opened', () => mainWindow?.webContents.closeDevTools());
  }
  mainWindow.on('closed', () => {
    mainWindow = undefined;
  });
}

function createOverlayWindow() {
  const { width } = screen.getPrimaryDisplay().workAreaSize;
  overlayWindow = new BrowserWindow({
    width: 420,
    height: 700,
    x: width - 440,
    y: 50,
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: true,
    movable: true,
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      preload: path.join(__dirname, 'preload.cjs'),
      enableBlinkFeatures: 'GetDisplayMedia',
    },
  });
  secureWindow(overlayWindow);

  if (process.platform === 'darwin' || process.platform === 'win32') {
    try {
      overlayWindow.setContentProtection(true);
      log('info', 'Best-effort overlay content protection requested.', { platform: process.platform });
    } catch {
      log('warn', 'Overlay content protection is unavailable.', { platform: process.platform });
    }
  }

  void overlayWindow.loadURL(`${backendUrl}/stealth`);
  if (process.env.NODE_ENV !== 'development') {
    overlayWindow.webContents.on('devtools-opened', () => overlayWindow?.webContents.closeDevTools());
  }
  overlayWindow.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault();
      overlayWindow?.hide();
    }
  });
  overlayWindow.on('closed', () => {
    overlayWindow = undefined;
  });
}

function registerHotkeys() {
  globalShortcut.register('CommandOrControl+Shift+A', () => {
    if (!overlayWindow) {
      return;
    }
    overlayWindow.isVisible() ? overlayWindow.hide() : overlayWindow.show();
  });
  globalShortcut.register('CommandOrControl+Shift+R', () => overlayWindow?.reload());
  globalShortcut.register('CommandOrControl+Shift+M', () => {
    mainWindow?.show();
    mainWindow?.focus();
  });
}

function configurePermissions() {
  const allowedPermissions = new Set(['media', 'display-capture']);
  const isTrustedContent = (webContents) => {
    try {
      return new URL(webContents.getURL()).origin === new URL(backendUrl).origin;
    } catch {
      return false;
    }
  };
  session.defaultSession.setPermissionCheckHandler((webContents, permission) => (
    Boolean(webContents) && isTrustedContent(webContents) && allowedPermissions.has(permission)
  ));
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    callback(isTrustedContent(webContents) && allowedPermissions.has(permission));
  });
}

function configureAutoUpdater() {
  if (!app.isPackaged) {
    return;
  }
  autoUpdater.logger = null;
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on('update-available', (update) => {
    void dialog.showMessageBox(mainWindow, {
      type: 'info',
      title: 'Update Available',
      message: `Version ${update.version} is available.`,
      buttons: ['Download', 'Later'],
    }).then(({ response }) => {
      if (response === 0) {
        void autoUpdater.downloadUpdate();
      }
    });
  });
  autoUpdater.on('update-downloaded', () => {
    void dialog.showMessageBox(mainWindow, {
      type: 'info',
      title: 'Update Ready',
      message: 'The update is ready to install.',
      buttons: ['Restart Now', 'Later'],
    }).then(({ response }) => {
      if (response === 0) {
        autoUpdater.quitAndInstall();
      }
    });
  });
  autoUpdater.on('error', () => log('warn', 'Automatic update check failed.'));
  void autoUpdater.checkForUpdates().catch(() => log('warn', 'Automatic update check was unavailable.'));
}

function stopBackend() {
  if (backendProcess && !backendProcess.killed) {
    backendProcess.kill('SIGTERM');
  }
  backendProcess = undefined;
}

const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    mainWindow?.show();
    mainWindow?.focus();
  });

  app.whenReady().then(async () => {
    await prepareBackend();
    configurePermissions();
    createMainWindow();
    createOverlayWindow();
    registerHotkeys();
    configureAutoUpdater();
    log('info', 'Interview Copilot desktop application started.');
  }).catch(async () => {
    await dialog.showMessageBox({
      type: 'error',
      title: 'Interview Copilot Could Not Start',
      message: 'The local backend did not become ready. Check the required configuration and restart the application.',
    });
    stopBackend();
    app.quit();
  });
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (!mainWindow && backendUrl) {
    createMainWindow();
  }
  if (!overlayWindow && backendUrl) {
    createOverlayWindow();
  }
});

app.on('before-quit', () => {
  isQuitting = true;
  stopBackend();
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});

process.on('uncaughtException', () => {
  log('error', 'Unhandled Electron main-process exception.');
  stopBackend();
  app.quit();
});
