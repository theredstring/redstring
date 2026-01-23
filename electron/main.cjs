const { app, BrowserWindow, ipcMain, shell, dialog, clipboard, Menu, protocol, session } = require('electron');
const path = require('node:path');
const fs = require('node:fs').promises;
const fsSync = require('node:fs');
const { fork } = require('child_process');
const { autoUpdater } = require('electron-updater');

// Configure autoUpdater
autoUpdater.autoDownload = true;
autoUpdater.autoInstallOnAppQuit = true;

// Basic logging
autoUpdater.logger = require('electron-log');
autoUpdater.logger.transports.file.level = 'info';

const DIST = path.join(__dirname, '../dist');
const VITE_DEV_SERVER_URL = process.env['VITE_DEV_SERVER_URL'];

// Protocol handling (Redstring)
if (process.defaultApp) {
  if (process.argv.length >= 2) {
    app.setAsDefaultProtocolClient('redstring', process.execPath, [path.resolve(process.argv[1])]);
  }
} else {
  app.setAsDefaultProtocolClient('redstring');
}

// Set app name for proper display in menu bar/dock
app.setName('Redstring');

// Agent server child process
let agentServerProcess = null;

// Start the agent server as a child process
function startAgentServer() {
  if (agentServerProcess) {
    console.log('[Electron] Agent server already running');
    return;
  }

  const agentServerPath = path.join(__dirname, '..', 'agent-server.js');

  // Check if agent-server.js exists
  if (!fsSync.existsSync(agentServerPath)) {
    console.error('[Electron] Agent server not found at:', agentServerPath);
    return;
  }

  console.log('[Electron] Starting agent server...');

  // Fork the agent server as a child process
  // Using fork with execArgv to handle ES modules
  agentServerProcess = fork(agentServerPath, [], {
    cwd: path.join(__dirname, '..'),
    stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
    env: {
      ...process.env,
      AGENT_SERVER_MODE: 'true',
      NODE_ENV: process.env.NODE_ENV || 'development'
    }
  });

  agentServerProcess.stdout.on('data', (data) => {
    console.log(`[AgentServer] ${data.toString().trim()} `);
  });

  agentServerProcess.stderr.on('data', (data) => {
    console.error(`[AgentServer] ${data.toString().trim()} `);
  });

  agentServerProcess.on('error', (error) => {
    console.error('[Electron] Failed to start agent server:', error);
    agentServerProcess = null;
  });

  agentServerProcess.on('exit', (code, signal) => {
    console.log(`[Electron] Agent server exited with code ${code}, signal ${signal} `);
    agentServerProcess = null;
  });
}

// Stop the agent server
function stopAgentServer() {
  if (agentServerProcess) {
    console.log('[Electron] Stopping agent server...');
    agentServerProcess.kill('SIGTERM');
    agentServerProcess = null;
  }
}

// Check for dev mode - either NODE_ENV or if running from source (not packaged)
const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;

// Check for --test flag in command-line arguments
const isTestMode = process.argv.includes('--test');
if (isTestMode) {
  console.log('[Electron] Test mode enabled via --test flag');
}

// Check for --session flag in command-line arguments (e.g. --session=mySession)
const sessionArg = process.argv.find(arg => arg.startsWith('--session='));
const sessionName = sessionArg ? sessionArg.split('=')[1] : null;
if (sessionName) {
  console.log(`[Electron] Starting with isolated session: ${sessionName} `);
}

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
    console.error(`[Electron] Failed to read storage ${storeName}: `, error);
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
    console.error(`[Electron] Failed to write storage ${storeName}: `, error);
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
    let devUrl = 'http://localhost:4001';
    const params = [];
    if (isTestMode) params.push('test=true');
    if (sessionName) params.push(`session = ${encodeURIComponent(sessionName)} `);

    if (params.length > 0) {
      devUrl += '?' + params.join('&');
    }

    mainWindow.loadURL(devUrl);
    mainWindow.webContents.openDevTools();
  } else {
    // In production, load the built index.html
    const indexPath = path.join(__dirname, '../dist/index.html');
    const query = {};
    if (isTestMode) query.test = 'true';
    if (sessionName) query.session = sessionName;

    mainWindow.loadFile(indexPath, { query });
  }
}

function createMenu() {
  const isMac = process.platform === 'darwin';

  const template = [
    ...(isMac ? [{
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' }
      ]
    }] : []),
    {
      label: 'File',
      submenu: [
        {
          label: 'Refresh',
          accelerator: 'CmdOrCtrl+R',
          click: () => {
            if (mainWindow) mainWindow.reload();
          }
        },
        { type: 'separator' },
        isMac ? { role: 'close' } : { role: 'quit' }
      ]
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'pasteAndMatchStyle' },
        { role: 'delete' },
        { role: 'selectAll' },
        { type: 'separator' },
        {
          label: 'Speech',
          submenu: [
            { role: 'startSpeaking' },
            { role: 'stopSpeaking' }
          ]
        }
      ]
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' }
      ]
    },
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        { role: 'zoom' },
        ...(isMac ? [
          { type: 'separator' },
          { role: 'front' },
          { type: 'separator' },
          { role: 'window' }
        ] : [
          { role: 'close' }
        ])
      ]
    },
    {
      role: 'help',
      submenu: [
        {
          label: 'Learn More',
          click: async () => {
            const { shell } = require('electron');
            await shell.openExternal('https://electronjs.org');
          }
        }
      ]
    }
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
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

ipcMain.handle('file:pickFolder', async (event, options = {}) => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory', 'createDirectory'],
    defaultPath: options.defaultPath || getRedstringDocumentsPath(),
    ...options
  });

  if (result.canceled) {
    return null; // Return null on cancellation consistent with expectation
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
    throw new Error(`Failed to read file: ${error.message} `);
  }
});

ipcMain.handle('file:write', async (event, filePath, content) => {
  try {
    await fs.writeFile(filePath, content, 'utf-8');
    return { success: true, path: filePath };
  } catch (error) {
    throw new Error(`Failed to write file: ${error.message} `);
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

ipcMain.handle('file:folderExists', async (event, folderPath) => {
  try {
    const stats = await fs.stat(folderPath);
    return stats.isDirectory();
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

  // Start the agent server (AI backend)
  startAgentServer();

  createWindow();
  createMenu();

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', function () {
  if (process.platform !== 'darwin') app.quit();
});

// Clean up agent server when app is quitting
app.on('will-quit', () => {
  stopAgentServer();
});

// Also handle before-quit for macOS
app.on('before-quit', () => {
  stopAgentServer();
});

// IPC handlers for agent server control
ipcMain.handle('agent:status', async () => {
  return {
    running: agentServerProcess !== null,
    pid: agentServerProcess?.pid || null
  };
});

ipcMain.handle('agent:restart', async () => {
  stopAgentServer();
  // Small delay to ensure clean shutdown
  await new Promise(resolve => setTimeout(resolve, 500));
  startAgentServer();
  return { success: true };
});

