const { app, BrowserWindow, ipcMain, shell, dialog, clipboard, Menu, protocol, session } = require('electron');
const path = require('node:path');
const fs = require('node:fs').promises;
const fsSync = require('node:fs');
const { fork } = require('child_process');
const { initUpdater } = require('./updater.cjs');

let updaterHandle = null;

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

  // In production: use the pre-bundled CJS file from app.asar.unpacked/
  // (single file, no ESM/asar issues, no node_modules needed)
  // In dev: use the original ESM source (system Node.js handles ESM fine)
  let agentServerPath;
  let agentCwd = path.join(__dirname, '..');
  if (app.isPackaged) {
    agentServerPath = path.join(__dirname, '..', 'agent-server.bundle.cjs')
      .replace('app.asar', 'app.asar.unpacked');
    agentCwd = agentCwd.replace('app.asar', 'app.asar.unpacked');
  } else {
    agentServerPath = path.join(__dirname, '..', 'agent-server.js');
  }

  if (!fsSync.existsSync(agentServerPath)) {
    console.error('[Electron] Agent server not found at:', agentServerPath);
    return;
  }

  console.log('[Electron] Starting agent server from:', agentServerPath);

  try {
    agentServerProcess = fork(agentServerPath, [], {
      cwd: agentCwd,
      stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: '1',
        AGENT_SERVER_MODE: 'true',
        NODE_ENV: process.env.NODE_ENV || 'development'
      }
    });
    console.log('[Electron] Agent server forked, pid:', agentServerProcess.pid);
  } catch (forkErr) {
    console.error('[Electron] Agent server fork failed:', forkErr.message);
    return;
  }

  agentServerProcess.stdout.on('data', (data) => {
    console.log(`[AgentServer] ${data.toString().trim()}`);
  });

  agentServerProcess.stderr.on('data', (data) => {
    console.error(`[AgentServer] ${data.toString().trim()}`);
  });

  agentServerProcess.on('error', (error) => {
    console.error('[Electron] Agent server error:', error.message);
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
  const folderName = sessionName ? `RedstringData_${sessionName}` : 'RedstringData';
  return path.join(app.getPath('userData'), folderName);
};

// Get the default documents folder for user files
const getRedstringDocumentsPath = () => {
  const folderName = sessionName ? `Redstring_${sessionName}` : 'Redstring';
  return path.join(app.getPath('documents'), folderName);
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

    // Seed the file IPC allowlist from previously-persisted file handles so
    // that file:read on a restored universe path works after restart without
    // requiring a re-pick.
    try {
      const handlesPath = path.join(dataPath, 'fileHandles.json');
      const raw = await fs.readFile(handlesPath, 'utf-8');
      const records = JSON.parse(raw);
      if (records && typeof records === 'object') {
        for (const record of Object.values(records)) {
          if (record && typeof record.handle === 'string') {
            userApprovedPaths.add(path.resolve(record.handle));
          }
          if (record && typeof record.displayPath === 'string') {
            userApprovedPaths.add(path.resolve(record.displayPath));
          }
        }
        console.log(`[FileIPC] Seeded ${userApprovedPaths.size} approved path(s) from persisted handles`);
      }
    } catch (err) {
      if (err.code !== 'ENOENT') {
        console.warn('[FileIPC] Could not seed approved paths:', err.message);
      }
    }
  } catch (error) {
    console.error('[Electron] Failed to create directories:', error);
  }
};

// Storage file paths
const getStoragePath = (storeName) => {
  return path.join(getRedstringDataPath(), `${storeName}.json`);
};

// ── File IPC path-traversal guard ─────────────────────────────
// The renderer is sandboxed (contextIsolation on), but a single XSS in a
// node-content render could turn `file:read`/`write`/`delete` into arbitrary
// filesystem access. We gate those handlers on this allowlist: files are
// readable/writable only if (a) they live under one of the Redstring app
// directories, or (b) the user picked them via a system dialog this session.
const userApprovedPaths = new Set();
const rememberApprovedPath = (filePath) => {
  if (typeof filePath === 'string' && filePath) {
    userApprovedPaths.add(path.resolve(filePath));
  }
};
const isInAllowedRoot = (resolved) => {
  const roots = [
    path.resolve(getRedstringDataPath()),
    path.resolve(getRedstringDocumentsPath()),
    path.resolve(app.getPath('userData')),
  ];
  return roots.some((root) => resolved === root || resolved.startsWith(root + path.sep));
};
const assertAccessAllowed = (filePath, action) => {
  if (typeof filePath !== 'string' || !filePath) {
    throw new Error(`Invalid file path for ${action}`);
  }
  const resolved = path.resolve(filePath);
  if (isInAllowedRoot(resolved)) return resolved;
  if (userApprovedPaths.has(resolved)) return resolved;
  console.warn(`[FileIPC] Blocked ${action} for unapproved path:`, resolved);
  throw new Error(`File access denied for path not approved by user: ${resolved}`);
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
      partition: sessionName ? 'persist:' + sessionName : undefined,
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
    if (sessionName) params.push(`session=${encodeURIComponent(sessionName)}`);

    if (params.length > 0) {
      devUrl += '?' + params.join('&');
    }

    mainWindow.loadURL(devUrl);
    mainWindow.webContents.openDevTools();
  } else {
    // In production, load the built index.html
    const indexPath = path.join(__dirname, '../dist/index.html');
    console.log('[Electron] Loading production index:', indexPath);
    const query = {};
    if (isTestMode) query.test = 'true';
    if (sessionName) query.session = sessionName;

    mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL) => {
      console.error('[Electron] Failed to load:', { errorCode, errorDescription, validatedURL });
    });

    mainWindow.loadFile(indexPath, { query }).catch(err => {
      console.error('[Electron] loadFile error:', err);
    });
  }

  // Fallback: show the window after 5s even if ready-to-show hasn't fired
  setTimeout(() => {
    if (mainWindow && !mainWindow.isVisible()) {
      console.warn('[Electron] ready-to-show did not fire, showing window anyway');
      mainWindow.show();
    }
  }, 5000);
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
        isMac ? { role: 'close', accelerator: '' } : { role: 'quit' }
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
          { role: 'close', accelerator: '' }
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
        },
        { type: 'separator' },
        {
          label: 'Update Diagnostics…',
          click: () => {
            if (updaterHandle) updaterHandle.openDiagnostics();
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

  let filePath = result.filePaths?.[0];
  if (!filePath || typeof filePath !== 'string') {
    // macOS iCloud conflict resolution dialogs can produce this state.
    throw new Error('No file selected (empty result from system dialog)');
  }

  if (!path.isAbsolute(filePath)) {
    console.warn('[FileHandles] ⚠ file:pick returned RELATIVE path:', filePath);
    filePath = path.resolve(defaultPath, '..', filePath);
    console.log('[FileHandles] ✓ Resolved to absolute path:', filePath);
  } else {
    console.log('[FileHandles] ✓ file:pick returned absolute path:', filePath);
  }

  rememberApprovedPath(filePath);
  return filePath;
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

  const folderPath = result.filePaths[0];
  // Approve the folder itself so subsequent file:exists / file:mkdir on it
  // succeed. Files saved into it via file:saveAs are approved separately
  // when the user confirms the save dialog.
  rememberApprovedPath(folderPath);
  return folderPath;
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

  // Validate and log the path being returned
  let filePath = result.filePath;
  const isAbsolute = path.isAbsolute(filePath);

  if (isAbsolute) {
    console.log('[FileHandles] ✓ saveAs returned absolute path:', filePath);
  } else {
    console.warn('[FileHandles] ⚠ saveAs returned RELATIVE path:', filePath);
    filePath = path.resolve(defaultPath, '..', filePath);
    console.log('[FileHandles] ✓ Resolved to absolute path:', filePath);
  }

  rememberApprovedPath(filePath);
  return filePath;
});

ipcMain.handle('file:read', async (event, filePath) => {
  try {
    const safePath = assertAccessAllowed(filePath, 'file:read');
    const content = await fs.readFile(safePath, 'utf-8');
    return { content, path: safePath };
  } catch (error) {
    throw new Error(`Failed to read file: ${error.message} `);
  }
});

ipcMain.handle('file:write', async (event, filePath, content) => {
  try {
    const safePath = assertAccessAllowed(filePath, 'file:write');
    await fs.writeFile(safePath, content, 'utf-8');
    return { success: true, path: safePath };
  } catch (error) {
    throw new Error(`Failed to write file: ${error.message} `);
  }
});

ipcMain.handle('file:delete', async (event, filePath) => {
  try {
    const safePath = assertAccessAllowed(filePath, 'file:delete');
    await fs.unlink(safePath);
    return true;
  } catch (err) {
    console.error('[file:delete] Failed to delete file:', filePath, err);
    throw err;
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

ipcMain.handle('file:getPathParent', async (event, filePath) => {
  try {
    return path.dirname(filePath);
  } catch {
    return null;
  }
});

ipcMain.handle('file:mkdir', async (event, folderPath) => {
  try {
    await fs.mkdir(folderPath, { recursive: true });
    return true;
  } catch (error) {
    throw new Error(`Failed to create directory: ${error.message} `);
  }
});

ipcMain.handle('file:showInFolder', async (event, filePath) => {
  try {
    if (!filePath) {
      throw new Error('File path is required');
    }
    console.log('[Electron] Showing file in folder:', filePath);
    const result = shell.showItemInFolder(filePath);
    console.log('[Electron] showItemInFolder result:', result);
    return true;
  } catch (error) {
    console.error('[Electron] showItemInFolder error:', error);
    throw new Error(`Failed to show file in folder: ${error.message}`);
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

// File-handle records carry absolute paths the user previously picked. Approve
// those paths when records flow through the storage IPC so that file:read /
// file:write succeed after an app restart without requiring a re-pick.
const FILE_HANDLE_STORE = 'fileHandles';
const approveFileHandleRecord = (record) => {
  if (!record || typeof record !== 'object') return;
  if (typeof record.handle === 'string') rememberApprovedPath(record.handle);
  if (typeof record.displayPath === 'string') rememberApprovedPath(record.displayPath);
};

// Get item from storage (like localStorage.getItem)
ipcMain.handle('storage:getItem', async (event, storeName, key) => {
  const data = await readStorage(storeName);
  const value = data[key] ?? null;
  if (storeName === FILE_HANDLE_STORE) approveFileHandleRecord(value);
  return value;
});

// Set item in storage (like localStorage.setItem)
ipcMain.handle('storage:setItem', async (event, storeName, key, value) => {
  const data = await readStorage(storeName);
  data[key] = value;
  if (storeName === FILE_HANDLE_STORE) approveFileHandleRecord(value);
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
  const data = await readStorage(storeName);
  if (storeName === FILE_HANDLE_STORE && data && typeof data === 'object') {
    for (const record of Object.values(data)) approveFileHandleRecord(record);
  }
  return data;
});

// Set all items in storage (bulk write)
ipcMain.handle('storage:setAll', async (event, storeName, data) => {
  if (storeName === FILE_HANDLE_STORE && data && typeof data === 'object') {
    for (const record of Object.values(data)) approveFileHandleRecord(record);
  }
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

// GitHub Device Flow — fully local, no OAuth server / no client_secret.
// Both endpoints live on github.com (not api.github.com) and do NOT send
// CORS headers, so the renderer can't call them directly. We proxy them
// from the main process and let the renderer drive the polling cadence.

async function githubFetchJSON(url, init) {
  const res = await fetch(url, {
    ...init,
    headers: {
      Accept: 'application/json',
      'User-Agent': 'Redstring-Electron',
      ...(init && init.headers ? init.headers : {})
    }
  });
  let body = null;
  try { body = await res.json(); } catch { body = null; }
  return { ok: res.ok, status: res.status, body };
}

ipcMain.handle('github:deviceFlow:requestCode', async (event, { clientId, scope }) => {
  if (!clientId) throw new Error('Missing GitHub client_id');
  const params = new URLSearchParams();
  params.set('client_id', clientId);
  if (scope) params.set('scope', scope);
  return githubFetchJSON('https://github.com/login/device/code', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString()
  });
});

ipcMain.handle('github:deviceFlow:pollToken', async (event, { clientId, deviceCode }) => {
  if (!clientId) throw new Error('Missing GitHub client_id');
  if (!deviceCode) throw new Error('Missing device_code');
  const params = new URLSearchParams();
  params.set('client_id', clientId);
  params.set('device_code', deviceCode);
  params.set('grant_type', 'urn:ietf:params:oauth:grant-type:device_code');
  return githubFetchJSON('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString()
  });
});

ipcMain.handle('shell:openExternal', async (event, url) => {
  if (typeof url !== 'string') return false;
  // Only allow http/https — never let the renderer trigger arbitrary protocols.
  if (!/^https?:\/\//i.test(url)) return false;
  await shell.openExternal(url);
  return true;
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

  // Initialize updater (handles preflight cleanup, event wiring, IPC, periodic recheck)
  updaterHandle = initUpdater({
    app,
    getMainWindow: () => mainWindow,
    isDev,
    stopAgentServer,
    sessionName
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

// Updater IPC handlers live in electron/updater.cjs (registered by initUpdater)

