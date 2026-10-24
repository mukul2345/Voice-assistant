const { contextBridge, ipcRenderer } = require('electron');

// Expose protected methods that allow the renderer process to use
// ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('electronAPI', {
  // Window controls
  toggleVisibility: () => ipcRenderer.send('toggle-visibility'),
  setAlwaysOnTop: (value) => ipcRenderer.send('set-always-on-top', value),
  
  // Hotkey info
  getHotkeys: () => ipcRenderer.invoke('get-hotkeys'),
  
  // Platform info
  getPlatform: () => process.platform,
  
  // App version
  getVersion: () => ipcRenderer.invoke('get-version')
});
