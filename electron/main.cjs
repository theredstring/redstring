const { app, BrowserWindow, ipcMain, shell, dialog, clipboard } = require('electron');
const path = require('path');
const fs = require('fs').promises;
const fsSync = require('fs');

// Set app name for proper display in menu bar/dock
app.setName('Redstring');

// Check for dev mode - either NODE_ENV or if running from source (not packaged)
const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;

let mainWindow = null;

// ============================================================
// Persistent Storage - replaces localStorage/IndexedDB in Electron
// ============================================================

// Get the Redstring data directory
const getRedstringDataPath = () => {
  return path.join(app.getPath('userData'), 'RedstringData');
};

// Get the default documents folder for user files
const getRedstringDocumentsPath = () => {
  return path.join(app.getPath('documents'), 'Redstring');
};

// Ensure directories exist
const ensureDirectories = async () => {
  const dataPath = getRedstringDataPath();
  const docsPath = getRedstringDocumentsPath();
  
  try {
    await fs.mkdir(dataPath, { recursive: true });
    await fs.mkdir(docsPath, { recursive: true });
    console.log('[Electron] Data directory:', dataPath);
    console.log('[Electron] Documents directory:', docsPath);
  } catch (error) {
    console.error('[Electron] Failed to create directories:', error);
  }
};

// Storage file paths
const getStoragePath = (storeName) => {
  return path.join(getRedstringDataPath(), `${storeName}.json`);
};

// Read storage file
const readStorage = async (storeName) => {
  try {
    const filePath = getStoragePath(storeName);
    const content = await fs.readFile(filePath, 'utf-8');
    return JSON.parse(content);
  } catch (error) {
    if (error.code === 'ENOENT') {
      return {}; // File doesn't exist yet
    }
    console.error(`[Electron] Failed to read storage ${storeName}:`, error);
    return {};
  }
};

// Write storage file
const writeStorage = async (storeName, data) => {
  try {
    const filePath = getStoragePath(storeName);
    await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8');
    return true;
  } catch (error) {
    console.error(`[Electron] Failed to write storage ${storeName}:`, error);
    return false;
  }
};

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    show: false, // Don't show until ready to prevent flash
    icon: path.join(__dirname, 'icon.png'), // App icon for dev mode
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.cjs'),
      webSecurity: true, // Enable web security
    },
    title: "Redstring",
  });

  // Show window when ready to prevent white flash
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    mainWindow.focus();
  });

  // Handle new window links externally
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  if (isDev) {
    // Wait for Vite to be ready (handled by script usually, but good to have fallback)
    // The port 4001 is from the existing vite.config.js
    mainWindow.loadURL('http://localhost:4001');
    mainWindow.webContents.openDevTools();
  } else {
    // In production, load the built index.html
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }
}

// File System IPC Handlers
ipcMain.handle('file:pick', async (event, options = {}) => {
  // Default to Redstring documents folder
  const defaultPath = options.defaultPath || getRedstringDocumentsPath();
  
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    defaultPath: defaultPath,
    filters: [
      { name: 'Redstring Files', extensions: ['redstring'] },
      { name: 'JSON Files', extensions: ['json'] },
      { name: 'All Files', extensions: ['*'] }
    ],
    ...options
  });

  if (result.canceled) {
    throw new Error('File picker cancelled');
  }

  return result.filePaths[0];
});

ipcMain.handle('file:saveAs', async (event, options = {}) => {
  const { suggestedName } = options;
  // Default to Redstring documents folder with suggested name
  const defaultPath = options.defaultPath || 
    path.join(getRedstringDocumentsPath(), suggestedName || 'untitled.redstring');
  
  const result = await dialog.showSaveDialog(mainWindow, {
    defaultPath: defaultPath,
    filters: [
      { name: 'Redstring Files', extensions: ['redstring'] },
      { name: 'JSON Files', extensions: ['json'] },
      { name: 'All Files', extensions: ['*'] }
    ]
  });

  if (result.canceled) {
    throw new Error('Save dialog cancelled');
  }

  return result.filePath;
});

ipcMain.handle('file:read', async (event, filePath) => {
  try {
    const content = await fs.readFile(filePath, 'utf-8');
    return { content, path: filePath };
  } catch (error) {
    throw new Error(`Failed to read file: ${error.message}`);
  }
});

ipcMain.handle('file:write', async (event, filePath, content) => {
  try {
    await fs.writeFile(filePath, content, 'utf-8');
    return { success: true, path: filePath };
  } catch (error) {
    throw new Error(`Failed to write file: ${error.message}`);
  }
});

ipcMain.handle('file:exists', async (event, filePath) => {
  try {
    await fs.access(filePath, fsSync.constants.F_OK);
    return true;
  } catch {
    return false;
  }
});

// Clipboard IPC Handler
ipcMain.handle('clipboard:write', async (event, text) => {
  clipboard.writeText(text);
  return true;
});

// ============================================================
// Persistent Storage IPC Handlers (replaces localStorage/IndexedDB)
// ============================================================

// Get default paths
ipcMain.handle('storage:getPaths', async () => {
  return {
    data: getRedstringDataPath(),
    documents: getRedstringDocumentsPath(),
    userData: app.getPath('userData')
  };
});

// Get item from storage (like localStorage.getItem)
ipcMain.handle('storage:getItem', async (event, storeName, key) => {
  const data = await readStorage(storeName);
  return data[key] ?? null;
});

// Set item in storage (like localStorage.setItem)
ipcMain.handle('storage:setItem', async (event, storeName, key, value) => {
  const data = await readStorage(storeName);
  data[key] = value;
  return await writeStorage(storeName, data);
});

// Remove item from storage (like localStorage.removeItem)
ipcMain.handle('storage:removeItem', async (event, storeName, key) => {
  const data = await readStorage(storeName);
  delete data[key];
  return await writeStorage(storeName, data);
});

// Get all items from storage (like getting all keys from localStorage)
ipcMain.handle('storage:getAll', async (event, storeName) => {
  return await readStorage(storeName);
});

// Set all items in storage (bulk write)
ipcMain.handle('storage:setAll', async (event, storeName, data) => {
  return await writeStorage(storeName, data);
});

// Clear storage (like localStorage.clear for a specific store)
ipcMain.handle('storage:clear', async (event, storeName) => {
  return await writeStorage(storeName, {});
});

// GitHub OAuth Protocol Handler
let oauthCallbackResolve = null;

app.setAsDefaultProtocolClient('redstring');

app.on('open-url', (event, url) => {
  event.preventDefault();
  handleOAuthCallback(url);
});

// Windows/Linux protocol handler
if (process.platform === 'win32' || process.platform === 'linux') {
  app.on('second-instance', (event, commandLine, workingDirectory) => {
    // Look for redstring:// URL in command line arguments
    const url = commandLine.find(arg => arg.startsWith('redstring://'));
    if (url) {
      handleOAuthCallback(url);
    }
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}

function handleOAuthCallback(url) {
  try {
    const urlObj = new URL(url);
    if (urlObj.protocol === 'redstring:' && urlObj.hostname === 'auth') {
      const code = urlObj.searchParams.get('code');
      const state = urlObj.searchParams.get('state');
      const error = urlObj.searchParams.get('error');
      
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('oauth:callback', { code, state, error });
      }
      
      if (oauthCallbackResolve) {
        oauthCallbackResolve({ code, state, error });
        oauthCallbackResolve = null;
      }
    }
  } catch (error) {
    console.error('[Electron] Error handling OAuth callback:', error);
  }
}

ipcMain.handle('oauth:start', async (event, authUrl) => {
  return new Promise((resolve) => {
    oauthCallbackResolve = resolve;
    shell.openExternal(authUrl);
  });
});

app.whenReady().then(async () => {
  // Prevent multiple instances (Windows/Linux)
  if (process.platform === 'win32' || process.platform === 'linux') {
    const gotTheLock = app.requestSingleInstanceLock();
    if (!gotTheLock) {
      app.quit();
      return;
    }
  }

  // Create Redstring directories
  await ensureDirectories();

  createWindow();

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', function () {
  if (process.platform !== 'darwin') app.quit();
});

