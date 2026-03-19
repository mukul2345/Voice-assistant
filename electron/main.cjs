const { app, BrowserWindow, globalShortcut, screen, desktopCapturer, session, ipcMain } = require('electron');
const path = require('path');

let mainWindow;
let overlayWindow;
let backendUrl = 'http://localhost:5001';

if (process.env.COPILOT_BACKEND_URL) {
  backendUrl = process.env.COPILOT_BACKEND_URL;
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
      preload: path.join(__dirname, 'preload.cjs'),
      // Enable media access for screen/audio capture
      enableBlinkFeatures: 'GetDisplayMedia'
    }
  });

  // Grant permissions for media devices
  mainWindow.webContents.session.setPermissionRequestHandler((webContents, permission, callback) => {
    const allowedPermissions = ['media', 'mediaKeySystem', 'geolocation', 'notifications', 'midi', 'midiSysex', 'pointerLock', 'fullscreen', 'openExternal'];
    if (allowedPermissions.includes(permission)) {
      callback(true);
    } else {
      callback(false);
    }
  });

  mainWindow.loadURL(backendUrl);

  if (process.env.NODE_ENV === 'development') {
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    // Production mode: Disable DevTools to prevent accidental exposure
    mainWindow.webContents.closeDevTools();
    mainWindow.webContents.on('devtools-opened', () => {
      mainWindow.webContents.closeDevTools();
    });
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  console.log('✅ Main window created - Full app interface');
}

function createOverlayWindow() {
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width } = primaryDisplay.workAreaSize;

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
      preload: path.join(__dirname, 'preload.cjs'),
      // Enable media access for screen/audio capture
      enableBlinkFeatures: 'GetDisplayMedia'
    }
  });

  // Grant permissions for media devices
  overlayWindow.webContents.session.setPermissionRequestHandler((webContents, permission, callback) => {
    const allowedPermissions = ['media', 'mediaKeySystem', 'geolocation', 'notifications', 'midi', 'midiSysex', 'pointerLock', 'fullscreen', 'openExternal'];
    if (allowedPermissions.includes(permission)) {
      callback(true);
    } else {
      callback(false);
    }
  });

  // Enable OS-specific content protection to hide from screen capture
  try {
    if (process.platform === 'darwin') {
      // macOS: Enable content protection
      overlayWindow.setContentProtection(true);
    }

    if (process.platform === 'win32') {
      // Windows: Enable content protection to exclude from screen capture
      overlayWindow.setContentProtection(true);
      overlayWindow.setSkipTaskbar(true);
    }
  } catch (err) {
    console.warn('Content protection not available:', err.message);
  }

  overlayWindow.loadURL(`${backendUrl}/stealth`);

  if (process.env.NODE_ENV === 'development') {
    // DevTools available in development mode
  } else {
    // Production mode: Disable DevTools to prevent accidental exposure
    overlayWindow.webContents.closeDevTools();
    overlayWindow.webContents.on('devtools-opened', () => {
      overlayWindow.webContents.closeDevTools();
    });
  }

  overlayWindow.on('close', (e) => {
    e.preventDefault();
    overlayWindow.hide();
  });

  console.log('✅ Stealth overlay created (hidden) - Press Cmd+Shift+A to toggle');
}

function registerHotkeys() {
  globalShortcut.register('CommandOrControl+Shift+A', () => {
    if (overlayWindow) {
      if (overlayWindow.isVisible()) {
        overlayWindow.hide();
        console.log('Stealth overlay hidden');
      } else {
        overlayWindow.show();
        console.log('Stealth overlay shown');
      }
    }
  });

  globalShortcut.register('CommandOrControl+Shift+R', () => {
    if (overlayWindow) {
      overlayWindow.reload();
      console.log('Stealth overlay reloaded');
    }
  });

  globalShortcut.register('CommandOrControl+Shift+M', () => {
    if (mainWindow) {
      mainWindow.show();
      mainWindow.focus();
      console.log('Main window shown');
    }
  });

  console.log('⌨️  Hotkeys:');
  console.log('   Cmd+Shift+A: Toggle stealth overlay');
  console.log('   Cmd+Shift+R: Reload stealth overlay');
  console.log('   Cmd+Shift+M: Show main window');
}

app.whenReady().then(() => {
  // Handle desktop capturer requests from renderer
  ipcMain.handle('get-desktop-sources', async (event, opts) => {
    const sources = await desktopCapturer.getSources(opts);
    return sources;
  });

  // Enable screen capture permissions
  session.defaultSession.setPermissionCheckHandler((webContents, permission) => {
    return permission === 'media';
  });

  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    callback(permission === 'media');
  });

  createMainWindow();
  createOverlayWindow();
  registerHotkeys();

  console.log('');
  console.log('🚀 Interview Copilot Desktop App Started');
  console.log('📱 Main Window: Full app (fill context, start capture, view history)');
  console.log('👻 Stealth Overlay: Hidden (toggle with Cmd+Shift+A during interview)');
  console.log('🔒 Screen capture protection: Enabled');
  console.log('');
});

app.on('window-all-closed', () => {
  // Keep running
});

app.on('activate', () => {
  if (mainWindow === null) {
    createMainWindow();
  }
  if (overlayWindow === null) {
    createOverlayWindow();
  }
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});

process.on('uncaughtException', (error) => {
  console.error('Uncaught exception:', error);
});
