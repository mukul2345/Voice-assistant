const { contextBridge } = require('electron');

contextBridge.exposeInMainWorld('electron', Object.freeze({
  platform: process.platform,
}));
