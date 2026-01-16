const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electron', {
  // Platform check
  isElectron: true,

  // File System Access
  fileSystem: {
    pickFile: (options) => ipcRenderer.invoke('file:pick', options),
    pickFolder: (options) => ipcRenderer.invoke('file:pickFolder', options),
    saveAs: (options) => ipcRenderer.invoke('file:saveAs', options),
    readFile: (filePath) => ipcRenderer.invoke('file:read', filePath),
    writeFile: (filePath, content) => ipcRenderer.invoke('file:write', filePath, content),
    fileExists: (filePath) => ipcRenderer.invoke('file:exists', filePath),
    folderExists: (folderPath) => ipcRenderer.invoke('file:folderExists', folderPath),
  },

  // Persistent Storage (replaces localStorage/IndexedDB)
  storage: {
    // Get default paths
    getPaths: () => ipcRenderer.invoke('storage:getPaths'),
    // Key-value operations (storeName = namespace like 'fileHandles', 'settings', etc.)
    getItem: (storeName, key) => ipcRenderer.invoke('storage:getItem', storeName, key),
    setItem: (storeName, key, value) => ipcRenderer.invoke('storage:setItem', storeName, key, value),
    removeItem: (storeName, key) => ipcRenderer.invoke('storage:removeItem', storeName, key),
    getAll: (storeName) => ipcRenderer.invoke('storage:getAll', storeName),
    setAll: (storeName, data) => ipcRenderer.invoke('storage:setAll', storeName, data),
    clear: (storeName) => ipcRenderer.invoke('storage:clear', storeName),
  },

  // Clipboard Access
  clipboard: {
    writeText: (text) => ipcRenderer.invoke('clipboard:write', text),
  },

  // OAuth handling
  oauth: {
    start: (authUrl) => ipcRenderer.invoke('oauth:start', authUrl),
    onCallback: (callback) => {
      ipcRenderer.on('oauth:callback', (event, data) => callback(data));
    },
  },

  // Agent server control
  agent: {
    status: () => ipcRenderer.invoke('agent:status'),
    restart: () => ipcRenderer.invoke('agent:restart'),
  }
});

