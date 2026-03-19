// Preload script for Electron security
// This runs in a sandboxed context with access to both Node.js and browser APIs

const { contextBridge, ipcRenderer } = require('electron');

// Expose protected methods that allow the renderer process to use
// ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('electron', {
  // Platform info
  platform: process.platform,
  
  // Desktop Capturer for screen sharing
  getDesktopSources: async (opts) => {
    return await ipcRenderer.invoke('get-desktop-sources', opts);
  },
  
  // IPC communication (if needed in future)
  send: (channel, data) => {
    // Whitelist channels
    const validChannels = ['toMain'];
    if (validChannels.includes(channel)) {
      ipcRenderer.send(channel, data);
    }
  },
  
  receive: (channel, func) => {
    const validChannels = ['fromMain'];
    if (validChannels.includes(channel)) {
      // Deliberately strip event as it includes `sender` 
      ipcRenderer.on(channel, (event, ...args) => func(...args));
    }
  },
  
  // App info
  versions: {
    node: process.versions.node,
    chrome: process.versions.chrome,
    electron: process.versions.electron
  }
});

console.log('Preload script loaded');
console.log('Platform:', process.platform);
console.log('Electron version:', process.versions.electron);
