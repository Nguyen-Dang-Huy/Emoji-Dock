const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('emojiApi', {
  getAll: () => ipcRenderer.invoke('emoji:getAll'),
  search: (query) => ipcRenderer.invoke('emoji:search', query),
  pick: (alias) => ipcRenderer.invoke('emoji:pick', alias),
  getByAliases: (aliases) => ipcRenderer.invoke('emoji:getByAliases', aliases),
  getBaseAliases: () => ipcRenderer.invoke('emoji:getBaseAliases'),
  getState: () => ipcRenderer.invoke('state:get'),
  toggleFavorite: (alias) => ipcRenderer.invoke('state:toggleFavorite', alias),
  setState: (partial) => ipcRenderer.invoke('state:set', partial),
  getCustomAliases: () => ipcRenderer.invoke('settings:getCustomAliases'),
  saveCustomAliases: (mappings) => ipcRenderer.invoke('settings:saveCustomAliases', mappings),
  importEmojis: () => ipcRenderer.invoke('emoji:import'),
  deleteImportedEmoji: (alias) => ipcRenderer.invoke('emoji:deleteImported', alias),
  clearImportedEmojis: () => ipcRenderer.invoke('emoji:clearImported'),
  quitApp: () => ipcRenderer.invoke('app:quit'),
  hide: () => ipcRenderer.invoke('picker:hide'),
  onExternalOpen: (handler) => {
    ipcRenderer.removeAllListeners('picker:open');
    ipcRenderer.on('picker:open', () => handler());
  }
});
