'use strict';
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('desktop', {
  version: () => ipcRenderer.invoke('polycraft:version'),
  reportError: (message, stack) => ipcRenderer.invoke('polycraft:reportError', message, stack),
  reportGraphics: json => ipcRenderer.invoke('polycraft:reportGraphics', json),
  list: () => ipcRenderer.invoke('polycraft:list'),
  create: name => ipcRenderer.invoke('polycraft:create', name),
  load: id => ipcRenderer.invoke('polycraft:load', id),
  save: (id, state) => ipcRenderer.invoke('polycraft:save', id, state),
  rename: (id, name) => ipcRenderer.invoke('polycraft:rename', id, name),
  remove: id => ipcRenderer.invoke('polycraft:remove', id),
  import: () => ipcRenderer.invoke('polycraft:import'),
  export: id => ipcRenderer.invoke('polycraft:export', id),
  onlineMode: enabled => ipcRenderer.invoke('polycraft:onlineMode', enabled),
  fullscreen: () => ipcRenderer.invoke('polycraft:fullscreen'),
  onFullscreenChanged: callback => ipcRenderer.on('polycraft:fullscreen-changed', (_event, entered) => callback(entered)),
  windowFocused: () => ipcRenderer.invoke('polycraft:windowFocused'),
  onWindowFocusChanged: callback => {
    const listener = (_event, focused) => callback(focused);
    ipcRenderer.on('polycraft:focus-changed', listener);
    return () => ipcRenderer.removeListener('polycraft:focus-changed', listener);
  },
  closeReady: () => ipcRenderer.invoke('polycraft:closeReady'),
  closeFailed: message => ipcRenderer.invoke('polycraft:closeFailed', message),
  onBeforeClose: callback => ipcRenderer.on('polycraft:before-close', () => callback())
});
