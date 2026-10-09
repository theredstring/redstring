const {
  app, BrowserWindow, ipcMain, shell, dialog, clipboard, Menu, protocol, session, safeStorage, utilityProcess
} = require('electron');
const path = require('node:path');
const fs = require('node:fs').promises;
const fsSync = require('node:fs');
const crypto = require('node:crypto');
const { initUpdater } = require('./updater.cjs');
const {
  isTrustedSender,
  isAppUrl,
  isSafeExternalUrl,
  isValidStoreName,
  resolveStorePath,
  isWithin,
  createPathApprovals,
  APP_ORIGIN
} = require('./ipcGuards.cjs');
const { registerAppScheme, handleAppProtocol } = require('./appProtocol.cjs');
const { createSecretsStore } = require('./secretsStore.cjs');
const legacyMigration = require('./legacyMigration.cjs');
const { createDruidBridge, defaultBridgePath } = require('./druidBridge.cjs');

let updaterHandle = null;

const DIST = path.join(__dirname, '../dist');

// app://redstring must be registered as a privileged scheme before 'ready'.
registerAppScheme(protocol);

// Set app name for proper display in menu bar/dock
app.setName('Redstring');

// Development = running from source. Never trust NODE_ENV for this: an
// inherited NODE_ENV=development must not switch a packaged build into dev
// behaviour (dev-server origin trusted, DevTools, update simulator).
const isDev = !app.isPackaged;

// Development runs as the generic Electron binary, so it must not share the
// installed app's Keychain item ("Redstring Safe Storage"): whichever build
// creates that item is the only one macOS trusts with it, and the other then
// prompts on every launch. Dev gets its own item ("Redstring Dev Safe
// Storage", named after the app) and its own secrets folder, and keeps the
// shared data folder so linked universes stay linked.
if (isDev) {
  const sharedUserData = app.getPath('userData');
  app.setName('Redstring Dev');
  app.setPath('userData', sharedUserData);
}
const DEV_SERVER_URL = 'http://localhost:4001';
const DEV_ORIGINS = isDev ? [DEV_SERVER_URL, 'http://127.0.0.1:4001'] : [];
const APP_ENTRY_URL = `${APP_ORIGIN}/index.html`;

// DevTools: always in development; in a packaged build only when explicitly
// asked for (REDSTRING_ENABLE_DEVTOOLS=1) for field debugging.
const devToolsEnabled = isDev || process.env.REDSTRING_ENABLE_DEVTOOLS === '1';

// Check for --test flag in command-line arguments
const isTestMode = process.argv.includes('--test');
if (isTestMode) {
  console.log('[Electron] Test mode enabled via --test flag');
}

// Check for --session flag in command-line arguments (e.g. --session=mySession).
// The name becomes part of directory names, so it must be a plain identifier.
const sessionArg = process.argv.find(arg => arg.startsWith('--session='));
let sessionName = sessionArg ? sessionArg.split('=')[1] : null;
if (sessionName && !isValidStoreName(sessionName)) {
  console.warn('[Electron] Ignoring invalid --session name');
  sessionName = null;
}
if (sessionName) {
  console.log(`[Electron] Starting with isolated session: ${sessionName} `);
}
const partitionName = sessionName ? `persist:${sessionName}` : undefined;

const getAppSession = () => (partitionName ? session.fromPartition(partitionName) : session.defaultSession);

// Every IPC handler goes through here. Only the top frame of an app page
// (app://redstring, or the Vite dev server in development) may call main.
const isTrusted = (event) => isTrustedSender(event, { devOrigins: DEV_ORIGINS });
function handle(channel, fn) {
  ipcMain.handle(channel, (event, ...args) => {
    if (!isTrustedSender(event, { devOrigins: DEV_ORIGINS })) {
      console.warn(`[IPC] Refused ${channel} from untrusted sender`);
      throw new Error('Untrusted IPC sender');
    }
    return fn(event, ...args);
  });
}

// ============================================================
// Agent server (wizard backend) — Electron utility process
// ============================================================

// Local agent server auth (C-6): a fresh random token per launch, handed to the
// server through its environment and to the renderer through
// window.electron.agent.getConnection(). Nothing else learns it.
const agentToken = crypto.randomBytes(32).toString('hex');
const agentPort = (() => {
  const p = Number.parseInt(process.env.REDSTRING_AGENT_PORT || '', 10);
  return Number.isInteger(p) && p >= 1024 && p <= 65535 ? p : 3001;
})();

let agentServerProcess = null;

// Settles when the current agent server is listening (or has exited, or never
// started). agent:getConnection waits on it, so the renderer's first request
// doesn't race the server's startup and log ERR_CONNECTION_REFUSED.
let agentListening = Promise.resolve();
const AGENT_LISTEN_WAIT_MS = 15000;

// Start the agent server. A utility process (not child_process.fork with
// ELECTRON_RUN_AS_NODE) so the runAsNode fuse can stay off.
function startAgentServer() {
  if (agentServerProcess) {
    console.log('[Electron] Agent server already running');
    return;
  }

  // In production: use the pre-bundled CJS file from app.asar.unpacked/
  // (single file, no ESM/asar issues, no node_modules needed)
  // In dev: use the original ESM source
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

  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.NODE_OPTIONS;
  Object.assign(env, {
    AGENT_SERVER_MODE: 'true',
    NODE_ENV: isDev ? (process.env.NODE_ENV || 'development') : 'production',
    REDSTRING_AGENT_TOKEN: agentToken,
    REDSTRING_AGENT_PORT: String(agentPort),
    WIZARD_PORT: String(agentPort)
  });

  let child;
  try {
    child = utilityProcess.fork(agentServerPath, [], {
      cwd: agentCwd,
      stdio: 'pipe',
      serviceName: 'Redstring Agent Server',
      env
    });
  } catch (forkErr) {
    console.error('[Electron] Agent server fork failed:', forkErr.message);
    return;
  }
  agentServerProcess = child;
  agentListening = new Promise((resolve) => {
    child.on('message', (msg) => { if (msg?.type === 'agent-listening') resolve(); });
    child.once('exit', resolve);
  });

  child.once('spawn', () => {
    console.log('[Electron] Agent server started, pid:', child.pid);
  });

  if (child.stdout) {
    child.stdout.on('data', (data) => {
      console.log(`[AgentServer] ${data.toString().trim()}`);
    });
  }
  if (child.stderr) {
    child.stderr.on('data', (data) => {
      console.error(`[AgentServer] ${data.toString().trim()}`);
    });
  }

  child.on('error', (type, location) => {
    console.error('[Electron] Agent server error:', type, location || '');
  });

  child.on('exit', (code) => {
    console.log(`[Electron] Agent server exited with code ${code}`);
    if (agentServerProcess === child) agentServerProcess = null;
  });
}

// Stop the agent server. SIGTERM first, SIGKILL if it lingers — a surviving
// child holds the wizard port and breaks the next launch. (Utility processes
// are also torn down by Chromium when the main process exits.)
function stopAgentServer() {
  if (agentServerProcess) {
    console.log('[Electron] Stopping agent server...');
    const child = agentServerProcess;
    agentServerProcess = null;
    const pid = child.pid;
    try { child.kill(); } catch {}
    if (pid) {
      const killTimer = setTimeout(() => {
        try { process.kill(pid, 'SIGKILL'); } catch {}
      }, 2000);
      if (killTimer.unref) killTimer.unref();
      child.once('exit', () => clearTimeout(killTimer));
    }
  }
}

let mainWindow = null;
// Startup can open and destroy a hidden window (the legacy-origin export in
// runOriginMigration) before the app window exists. Electron reports that as
// window-all-closed; quitting on it ended every Windows/Linux launch that had
// legacy storage to migrate, before the app window was ever shown.
let appWindowOpened = false;

// ============================================================
// Directories
// ============================================================

// Renderer-facing key/value stores (storage:*): <userData>/RedstringData
const getRedstringDataPath = () => {
  const folderName = sessionName ? `RedstringData_${sessionName}` : 'RedstringData';
  return path.join(app.getPath('userData'), folderName);
};

// The default documents folder for user files (a file-IPC root)
const getRedstringDocumentsPath = () => {
  const folderName = sessionName ? `Redstring_${sessionName}` : 'Redstring';
  return path.join(app.getPath('documents'), folderName);
};

// A dedicated app-data folder the renderer may use through file IPC (a
// file-IPC root). Deliberately NOT all of userData, which holds the approvals
// file, secrets, Chromium's storage and the updater state.
const getRedstringFilesPath = () => path.join(getRedstringDataPath(), 'files');

// Main-only state: approved paths and migration markers. Reachable by no IPC.
const getMainOwnedPath = () => {
  const folderName = sessionName ? `RedstringMain_${sessionName}` : 'RedstringMain';
  return path.join(app.getPath('userData'), folderName);
};

// safeStorage-encrypted secrets (C-7). Reachable only through secrets:*.
const getSecretsPath = () => {
  // Dev encrypts with its own Keychain item (see isDev above), so its secrets
  // live apart from the installed app's.
  const base = isDev ? 'secrets-dev' : 'secrets';
  const folderName = sessionName ? `${base}_${sessionName}` : base;
  return path.join(app.getPath('userData'), folderName);
};

let approvals = null;
let secretsStore = null;

// Ensure directories exist
const ensureDirectories = async () => {
  const dataPath = getRedstringDataPath();
  const docsPath = getRedstringDocumentsPath();

  try {
    await fs.mkdir(dataPath, { recursive: true });
    await fs.mkdir(getRedstringFilesPath(), { recursive: true });
    await fs.mkdir(docsPath, { recursive: true });
    await fs.mkdir(getMainOwnedPath(), { recursive: true, mode: 0o700 });
    console.log('[Electron] Data directory:', dataPath);
    console.log('[Electron] Documents directory:', docsPath);
  } catch (error) {
    console.error('[Electron] Failed to create directories:', error);
  }
};

// ── File IPC path guard ───────────────────────────────────────
// The renderer is sandboxed (contextIsolation on), but a single XSS in a
// node-content render could turn `file:read`/`write`/`delete` into arbitrary
// filesystem access. Files are reachable only if (a) they live under one of
// the two Redstring file roots, or (b) main approved them from a system
// open/save dialog result (see ipcGuards.createPathApprovals). The renderer has
// no way to add an approval.
const initApprovals = () => {
  approvals = createPathApprovals({ persistPath: path.join(getMainOwnedPath(), 'approved-paths.json') });
  try {
    const { loaded } = approvals.load();
    console.log(`[FileIPC] Loaded ${loaded} approved path(s)`);
  } catch (err) {
    console.error('[FileIPC] Could not load approved paths:', err.message);
  }
  migrateFileHandleApprovals();
};

// One time, on the first launch of a version with main-owned approvals:
// approve the universe files recorded in fileHandles.json. The user picked
// those under the previous version, whose approvals were rebuilt from this
// file on every launch; without this step every linked universe would need a
// re-pick. Read here, in main, from disk — never from renderer IPC — and never
// again after the marker is written, so records the renderer writes later are
// not approved.
const migrateFileHandleApprovals = () => {
  const markerPath = path.join(getMainOwnedPath(), 'filehandles-approvals-migrated.json');
  if (fsSync.existsSync(markerPath)) return;
  let approved = 0;
  try {
    const raw = fsSync.readFileSync(path.join(getRedstringDataPath(), 'fileHandles.json'), 'utf-8');
    const records = JSON.parse(raw);
    if (records && typeof records === 'object') {
      for (const record of Object.values(records)) {
        if (!record || typeof record !== 'object') continue;
        // Only ABSOLUTE paths (approve() refuses relative ones): a relative
        // "1.redstring" handle resolved against main's CWD once reached an
        // unrelated file in the launch directory.
        if (approvals.approve(record.handle)) approved++;
        if (approvals.approve(record.displayPath)) approved++;
      }
    }
  } catch (err) {
    if (err.code !== 'ENOENT') {
      // Unreadable/corrupt: leave the marker unwritten so the next launch
      // retries rather than silently unlinking everything.
      console.error('[FileIPC] Could not migrate file-handle approvals:', err.message);
      return;
    }
  }
  try {
    approvals.save();
    fsSync.writeFileSync(markerPath, JSON.stringify({ version: 1, approved, at: new Date().toISOString() }), { mode: 0o600 });
    console.log(`[FileIPC] Migrated ${approved} approved path(s) from fileHandles.json`);
  } catch (err) {
    console.error('[FileIPC] Could not persist migrated approvals:', err.message);
  }
};

const approveFromDialog = (filePath, kind) => {
  if (approvals.approve(filePath, { kind })) {
    try {
      approvals.save();
    } catch (err) {
      console.error('[FileIPC] Could not persist approval:', err.message);
    }
  }
};

const isInAllowedRoot = (resolved) => {
  const roots = [getRedstringDocumentsPath(), getRedstringFilesPath()];
  return roots.some((root) => isWithin(root, resolved));
};

const assertAccessAllowed = (filePath, action) => {
  if (typeof filePath !== 'string' || !filePath) {
    throw new Error(`Invalid file path for ${action}`);
  }
  // Reject relative paths outright. `path.resolve` on a relative path silently
  // anchors it to the main-process CWD, which is how a persisted "1.redstring"
  // handle ended up reading/writing/deleting a file in the launch directory.
  // A universe file must always be referenced by its absolute path.
  if (!path.isAbsolute(filePath)) {
    console.warn(`[FileIPC] Blocked ${action} for relative path:`, filePath);
    throw new Error(`File access denied for relative path (absolute path required): ${filePath}`);
  }
  const resolved = path.resolve(filePath);
  if (isInAllowedRoot(resolved)) return resolved;
  if (approvals && approvals.isApproved(resolved)) return resolved;
  console.warn(`[FileIPC] Blocked ${action} for unapproved path:`, resolved);
  throw new Error(`File access denied for path not approved by user: ${resolved}`);
};

// ============================================================
// Persistent Storage - replaces localStorage/IndexedDB in Electron
// ============================================================

// Stores main itself keeps in the data directory; not writable over IPC.
const RESERVED_STORES = new Set(['updater']);

const getStoragePath = (storeName) => resolveStorePath(getRedstringDataPath(), storeName);

const assertRendererStore = (storeName) => {
  if (!isValidStoreName(storeName) || RESERVED_STORES.has(storeName)) {
    throw new Error('Invalid storage name');
  }
};

// Read storage file
const readStorage = async (storeName) => {
  const filePath = getStoragePath(storeName);
  let content;
  try {
    content = await fs.readFile(filePath, 'utf-8');
  } catch (error) {
    if (error.code !== 'ENOENT') {
      console.error(`[Electron] Failed to read storage ${storeName}: `, error);
    }
    return {};
  }
  try {
    return JSON.parse(content);
  } catch (error) {
    // A truncated/corrupt store would otherwise read as {} and make the app
    // look freshly installed. Preserve the bad file for recovery and scream.
    console.error(`[Electron] Storage ${storeName} is corrupt (${error.message}) — backing up to ${storeName}.json.corrupt`);
    try {
      await fs.copyFile(filePath, `${filePath}.corrupt`);
    } catch (backupError) {
      console.error(`[Electron] Could not back up corrupt storage ${storeName}: `, backupError);
    }
    return {};
  }
};

// Write storage file atomically (temp file + rename) so a hard exit or a
// concurrent writer can never leave a truncated JSON file behind.
const writeStorage = async (storeName, data) => {
  try {
    const filePath = getStoragePath(storeName);
    const tmpPath = `${filePath}.${process.pid}.tmp`;
    await fs.writeFile(tmpPath, JSON.stringify(data, null, 2), 'utf-8');
    await fs.rename(tmpPath, filePath);
    return true;
  } catch (error) {
    console.error(`[Electron] Failed to write storage ${storeName}: `, error);
    return false;
  }
};

// ============================================================
// Session hardening
// ============================================================

// Permissions the app demonstrably uses; everything else is denied.
//   clipboard-sanitized-write — navigator.clipboard.writeText (copy buttons)
//   fullscreen / pointerLock  — canvas presentation + drag interactions
//   local-network-*           — fetches from app://redstring to the local
//                               agent server on 127.0.0.1 (Local Network Access)
const ALLOWED_PERMISSIONS = new Set([
  'clipboard-sanitized-write',
  'fullscreen',
  'pointerLock',
  'local-network-access',
  'local-network',
  'loopback-network'
]);

const isAppOriginUrl = (url) => isAppUrl(url, { devOrigins: DEV_ORIGINS });

function hardenSession(ses) {
  ses.setPermissionRequestHandler((webContents, permission, callback, details) => {
    const requestingUrl = (details && details.requestingUrl) || (webContents && webContents.getURL()) || '';
    const allowed = ALLOWED_PERMISSIONS.has(permission) && isAppOriginUrl(requestingUrl);
    if (!allowed) console.warn(`[Permissions] Denied ${permission} for ${requestingUrl}`);
    callback(allowed);
  });
  ses.setPermissionCheckHandler((webContents, permission, requestingOrigin) => {
    return ALLOWED_PERMISSIONS.has(permission) && isAppOriginUrl(requestingOrigin || '');
  });
  ses.setDevicePermissionHandler(() => false);
  handleAppProtocol(ses, { distDir: DIST });
}

// Applies to every webContents the app ever creates.
app.on('web-contents-created', (_event, contents) => {
  // No <webview>, ever.
  contents.on('will-attach-webview', (event) => {
    event.preventDefault();
  });

  // New windows are never opened in-app; safe links go to the browser.
  contents.setWindowOpenHandler(({ url }) => {
    if (isSafeExternalUrl(url)) {
      shell.openExternal(url).catch((err) => console.warn('[Electron] openExternal failed:', err.message));
    } else {
      console.warn('[Electron] Blocked window.open for unsafe URL');
    }
    return { action: 'deny' };
  });

  if (contents.getType() !== 'window') return;

  // The top-level page may only ever be the app itself.
  contents.on('will-navigate', (details) => {
    if (isAppOriginUrl(details.url)) return;
    if (devToolsEnabled && String(details.url).startsWith('devtools://')) return;
    details.preventDefault();
    console.warn('[Electron] Blocked navigation away from the app:', details.url);
    if (isSafeExternalUrl(details.url)) {
      shell.openExternal(details.url).catch(() => {});
    }
  });
  contents.on('will-redirect', (details) => {
    if (!details.isMainFrame || isAppOriginUrl(details.url)) return;
    details.preventDefault();
    console.warn('[Electron] Blocked redirect away from the app:', details.url);
  });
  // No subframe may load anything but the app origin (CSP frame-src 'none'
  // already blocks this in the renderer; this is the main-side backstop).
  contents.on('will-frame-navigate', (details) => {
    if (details.isMainFrame) return;
    if (isAppOriginUrl(details.url) || details.url === 'about:blank') return;
    details.preventDefault();
    console.warn('[Electron] Blocked subframe navigation:', details.url);
  });
});

function createWindow() {
  const additionalArguments = [];
  if (isDev) additionalArguments.push('--redstring-dev');
  if (isDev || process.env.REDSTRING_ENABLE_DEBUG_DOWNGRADE === '1') {
    additionalArguments.push('--redstring-debug-downgrade');
  }

  appWindowOpened = true;
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    show: false, // Don't show until ready to prevent flash
    icon: path.join(__dirname, 'icon.png'), // App icon for dev mode
    webPreferences: {
      partition: partitionName,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      webviewTag: false,
      navigateOnDragDrop: false,
      devTools: devToolsEnabled,
      preload: path.join(__dirname, 'preload.cjs'),
      additionalArguments
    },
    title: "Redstring",
  });

  // Show window when ready to prevent white flash
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    mainWindow.focus();
  });

  // Quit-flush handshake. SaveCoordinator debounces writes by ~3s, so a
  // Cmd+Q right after an edit would silently drop it. Intercept the first
  // close, ask the renderer to flush pending saves, then destroy the window
  // once it confirms (or after a timeout so a hung renderer can't block quit).
  //
  // With autosave off and changes unsaved, the renderer asks "Save changes?"
  // first. It sends app:close-hold while the question is up (no deadline:
  // the person is deciding, and then maybe saving a big file), and
  // app:close-cancel if they cancel, which keeps the window open.
  let flushCompleted = false;
  let closeInFlight = null;
  mainWindow.on('close', (event) => {
    if (flushCompleted) return;
    event.preventDefault();
    const win = mainWindow;
    // Already asked. A renderer that has crashed since can't answer.
    if (closeInFlight) {
      if (win.webContents.isCrashed?.()) closeInFlight.finish();
      return;
    }
    let timeoutId = null;
    const trusted = (ipcEvent) => isTrustedSender(ipcEvent, { devOrigins: DEV_ORIGINS });
    const stopWaiting = () => {
      clearTimeout(timeoutId);
      ipcMain.removeListener('app:flush-complete', onFlushComplete);
      ipcMain.removeListener('app:close-hold', onHold);
      ipcMain.removeListener('app:close-cancel', onCancel);
      closeInFlight = null;
    };
    const finish = () => {
      stopWaiting();
      flushCompleted = true;
      if (win && !win.isDestroyed()) {
        win.destroy();
      }
    };
    timeoutId = setTimeout(() => {
      console.warn('[Electron] Quit flush timed out — closing anyway');
      finish();
    }, 5000);
    const onFlushComplete = (ipcEvent) => {
      if (!trusted(ipcEvent)) return;
      finish();
    };
    const onHold = (ipcEvent) => {
      if (!trusted(ipcEvent)) return;
      clearTimeout(timeoutId);
    };
    const onCancel = (ipcEvent) => {
      if (!trusted(ipcEvent)) return;
      stopWaiting();
    };
    ipcMain.on('app:flush-complete', onFlushComplete);
    ipcMain.on('app:close-hold', onHold);
    ipcMain.on('app:close-cancel', onCancel);
    closeInFlight = { finish };
    try {
      win.webContents.send('app:flush-before-quit');
    } catch (sendError) {
      console.warn('[Electron] Could not request quit flush:', sendError.message);
      finish();
    }
  });

  const params = [];
  if (isTestMode) params.push('test=true');
  if (sessionName) params.push(`session=${encodeURIComponent(sessionName)}`);
  const query = params.length > 0 ? '?' + params.join('&') : '';

  if (isDev) {
    // Wait for Vite to be ready (handled by script usually, but good to have fallback)
    // The port 4001 is from the existing vite.config.js
    const devUrl = DEV_SERVER_URL + query;

    // Mirror renderer console output into this terminal. Chromium's own
    // warnings (tile memory, raster) already land here, so forwarding the app's
    // logs puts both in one copy-pasteable stream — which is what makes
    // window.__diag output shareable. Dev only.
    mainWindow.webContents.on('console-message', (details) => {
      const { level, message, lineNumber, sourceId } = details;
      // Skip Vite's HMR chatter; keep everything the app actually says.
      if (typeof sourceId === 'string' && sourceId.includes('/@vite/')) return;
      const levelTag = { info: 'LOG', warning: 'WARN', error: 'ERROR', debug: 'DEBUG' }[level] || 'LOG';
      const where = sourceId ? ` (${String(sourceId).split('/').pop()}:${lineNumber})` : '';
      console.log(`[renderer:${levelTag}]${where} ${message}`);
    });

    mainWindow.loadURL(devUrl);
    mainWindow.webContents.openDevTools();
  } else {
    // In production, load the built app from app://redstring (C-5).
    const entryUrl = APP_ENTRY_URL + query;
    console.log('[Electron] Loading production app:', entryUrl);

    mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL) => {
      console.error('[Electron] Failed to load:', { errorCode, errorDescription, validatedURL });
    });

    mainWindow.loadURL(entryUrl).catch(err => {
      console.error('[Electron] loadURL error:', err);
    });
  }

  // Fallback: show the window after 5s even if ready-to-show hasn't fired
  setTimeout(() => {
    if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.isVisible()) {
      console.warn('[Electron] ready-to-show did not fire, showing window anyway');
      mainWindow.show();
    }
  }, 5000);
}

/**
 * Hand a menu selection to the renderer, which owns every history in the app.
 * Addressed to the focused window so it still lands with more than one open.
 */
function sendMenuCommand(command) {
  const target = BrowserWindow.getFocusedWindow() || mainWindow;
  if (target && !target.isDestroyed()) {
    target.webContents.send('menu:command', command);
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
          // The header's + by keyboard. It lives here mainly for the
          // accelerator: browsers keep Cmd/Ctrl+N for themselves and never hand
          // the keydown to the page, so the desktop app is where this shortcut
          // can actually exist. The renderer opens the selector.
          label: 'New Thing',
          accelerator: 'CmdOrCtrl+N',
          click: () => sendMenuCommand('new-web')
        },
        {
          // Saves now, autosave on or off (SaveCoordinator.saveNow).
          label: 'Save',
          accelerator: 'CmdOrCtrl+S',
          click: () => sendMenuCommand('save')
        },
        { type: 'separator' },
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
        // NOT `role: 'undo'`/`'redo'`. Those are Chromium's text-field history:
        // with the canvas focused they do nothing at all, which made the only
        // visible Undo in the desktop app a no-op on the user's actual work.
        // The renderer takes it from here and picks the right history — a text
        // field still gets the native behaviour these roles used to provide.
        {
          label: 'Undo',
          accelerator: 'CmdOrCtrl+Z',
          click: () => sendMenuCommand('undo')
        },
        {
          label: 'Redo',
          accelerator: 'CmdOrCtrl+Shift+Z',
          click: () => sendMenuCommand('redo')
        },
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
        // DevTools only where they are enabled (development, or explicitly).
        ...(devToolsEnabled ? [{ role: 'toggleDevTools' }] : []),
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
        // Was "Learn More", pointing at electronjs.org — boilerplate from the
        // template this menu was scaffolded from. It opens Redstring's own
        // guide now, the same one the header's help button raises.
        {
          label: 'Redstring Guide',
          click: () => sendMenuCommand('help')
        },
        {
          label: 'Show Welcome Screen',
          click: () => sendMenuCommand('welcome')
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

// Dialog options the renderer may influence. Everything else (properties,
// security-scoped bookmarks, …) is decided here.
const pickDialogOptions = (options) => {
  const out = {};
  if (!options || typeof options !== 'object') return out;
  if (typeof options.title === 'string') out.title = options.title.slice(0, 200);
  if (typeof options.buttonLabel === 'string') out.buttonLabel = options.buttonLabel.slice(0, 100);
  if (typeof options.message === 'string') out.message = options.message.slice(0, 500);
  if (typeof options.defaultPath === 'string' && options.defaultPath.length < 4096) out.defaultPath = options.defaultPath;
  return out;
};

const dialogParent = (event) => BrowserWindow.fromWebContents(event.sender) || mainWindow;

// File System IPC Handlers
handle('file:pick', async (event, options = {}) => {
  const safeOptions = pickDialogOptions(options);
  // Default to Redstring documents folder
  const defaultPath = safeOptions.defaultPath || getRedstringDocumentsPath();

  const result = await dialog.showOpenDialog(dialogParent(event), {
    ...safeOptions,
    properties: ['openFile'],
    defaultPath: defaultPath,
    filters: [
      { name: 'Redstring Files', extensions: ['redstring'] },
      { name: 'JSON Files', extensions: ['json'] },
      { name: 'All Files', extensions: ['*'] }
    ]
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

  approveFromDialog(filePath, 'file');
  return filePath;
});

handle('file:pickFolder', async (event, options = {}) => {
  const safeOptions = pickDialogOptions(options);
  const result = await dialog.showOpenDialog(dialogParent(event), {
    ...safeOptions,
    properties: ['openDirectory', 'createDirectory'],
    defaultPath: safeOptions.defaultPath || getRedstringDocumentsPath()
  });

  if (result.canceled) {
    return null; // Return null on cancellation consistent with expectation
  }

  const folderPath = result.filePaths[0];
  // The user chose this folder: its contents are theirs to work in (the
  // workspace folder creates universe files inside it).
  approveFromDialog(folderPath, 'folder');
  return folderPath;
});

handle('file:saveAs', async (event, options = {}) => {
  const suggestedName = typeof options?.suggestedName === 'string'
    ? path.basename(options.suggestedName)
    : null;
  const safeOptions = pickDialogOptions(options);
  // Default to Redstring documents folder with suggested name
  const defaultPath = safeOptions.defaultPath ||
    path.join(getRedstringDocumentsPath(), suggestedName || 'untitled.redstring');

  const result = await dialog.showSaveDialog(dialogParent(event), {
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

  approveFromDialog(filePath, 'file');
  return filePath;
});

handle('file:read', async (event, filePath) => {
  try {
    const safePath = assertAccessAllowed(filePath, 'file:read');
    const content = await fs.readFile(safePath, 'utf-8');
    return { content, path: safePath };
  } catch (error) {
    throw new Error(`Failed to read file: ${error.message} `);
  }
});

// The file as bytes, never as text: a universe file can be bigger than the
// longest string JavaScript can hold (about 536 million characters), and long
// before that a window can't hold one. The renderer parses the bytes a slice
// at a time (src/formats/universeBytes.js).
handle('file:readBytes', async (event, filePath) => {
  try {
    const safePath = assertAccessAllowed(filePath, 'file:readBytes');
    const buffer = await fs.readFile(safePath);
    return { bytes: new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength), path: safePath };
  } catch (error) {
    throw new Error(`Failed to read file: ${error.message} `);
  }
});

// Serialize writes per target path. Two concurrent writes to the same file
// (autosave racing a force-save) would otherwise interleave truncation, and
// an out-of-order completion could leave an older snapshot as the final
// content. The chain guarantees writes land in call order.
const fileWriteChains = new Map();

handle('file:write', async (event, filePath, content) => {
  const safePath = assertAccessAllowed(filePath, 'file:write');
  // Text, or UTF-8 bytes: autosave sends bytes, which cross IPC as one copy of
  // a buffer instead of a string the renderer has to serialize (hundreds of
  // milliseconds of a frozen window for a big universe).
  const isBytes = content instanceof Uint8Array;
  if (typeof content !== 'string' && !isBytes) {
    throw new Error('Failed to write file: content must be a string or bytes');
  }
  const prior = fileWriteChains.get(safePath) || Promise.resolve();
  const writeOp = prior.catch(() => { /* prior failure doesn't block this write */ }).then(async () => {
    // Atomic write: temp file + rename, same pattern as writeStorage. A crash
    // or power loss mid-write can never leave a truncated .redstring behind —
    // the original survives until the rename. Before renaming, rotate the
    // current file to .bak so every save leaves one recovery point.
    const tmpPath = `${safePath}.${process.pid}.tmp`;
    await fs.writeFile(tmpPath, content, isBytes ? undefined : 'utf-8');
    try {
      await fs.copyFile(safePath, `${safePath}.bak`);
    } catch (bakError) {
      if (bakError.code !== 'ENOENT') {
        console.warn('[file:write] Could not rotate backup for', safePath, bakError.message);
      }
    }
    await fs.rename(tmpPath, safePath);
    return { success: true, path: safePath };
  });
  fileWriteChains.set(safePath, writeOp);
  try {
    return await writeOp;
  } catch (error) {
    throw new Error(`Failed to write file: ${error.message} `);
  } finally {
    if (fileWriteChains.get(safePath) === writeOp) {
      fileWriteChains.delete(safePath);
    }
  }
});

handle('file:delete', async (event, filePath) => {
  try {
    const safePath = assertAccessAllowed(filePath, 'file:delete');
    // Trash, don't unlink — a wrong-target delete (or a user who clicked the
    // wrong dialog button) must be recoverable.
    await shell.trashItem(safePath);
    return true;
  } catch (err) {
    console.error('[file:delete] Failed to delete file:', filePath, err);
    throw err;
  }
});

handle('file:exists', async (event, filePath) => {
  try {
    const safePath = assertAccessAllowed(filePath, 'file:exists');
    await fs.access(safePath, fsSync.constants.F_OK);
    return true;
  } catch {
    return false;
  }
});

handle('file:folderExists', async (event, folderPath) => {
  try {
    const safePath = assertAccessAllowed(folderPath, 'file:folderExists');
    const stats = await fs.stat(safePath);
    return stats.isDirectory();
  } catch {
    return false;
  }
});

handle('file:getPathParent', async (event, filePath) => {
  try {
    // Only reveal the parent of a path the user is already allowed to touch,
    // and only one step up. The returned parent is NOT approved, so it can't
    // be fed back in to climb further toward the filesystem root unless it
    // independently lives under an allowed root.
    const resolved = assertAccessAllowed(filePath, 'file:getPathParent');
    return path.dirname(resolved);
  } catch {
    return null;
  }
});

handle('file:mkdir', async (event, folderPath) => {
  try {
    const safePath = assertAccessAllowed(folderPath, 'file:mkdir');
    await fs.mkdir(safePath, { recursive: true });
    return true;
  } catch (error) {
    throw new Error(`Failed to create directory: ${error.message} `);
  }
});

handle('file:showInFolder', async (event, filePath) => {
  try {
    if (!filePath) {
      throw new Error('File path is required');
    }
    const safePath = assertAccessAllowed(filePath, 'file:showInFolder');
    console.log('[Electron] Showing file in folder:', safePath);
    const result = shell.showItemInFolder(safePath);
    console.log('[Electron] showItemInFolder result:', result);
    return true;
  } catch (error) {
    console.error('[Electron] showItemInFolder error:', error);
    throw new Error(`Failed to show file in folder: ${error.message}`);
  }
});

// Clipboard IPC Handler (Electron 44: clipboard writes are async)
handle('clipboard:write', async (event, text) => {
  if (typeof text !== 'string' || text.length > 20 * 1024 * 1024) return false;
  await clipboard.writeText(text);
  return true;
});

// ============================================================
// Persistent Storage IPC Handlers (replaces localStorage/IndexedDB)
// ============================================================

// Get default paths
handle('storage:getPaths', async () => {
  return {
    data: getRedstringDataPath(),
    documents: getRedstringDocumentsPath(),
    files: getRedstringFilesPath(),
    userData: app.getPath('userData')
  };
});

// Serialize read-modify-write storage mutations per store. setItem/removeItem
// do read → mutate → write; two concurrent calls (e.g. two universes writing
// their fileHandles metadata during restore) could interleave at the awaits so
// the second read predates the first write, silently dropping one record —
// which presented as "universe unlinked after restart".
const storeMutationChains = new Map();
const withStoreLock = (storeName, mutator) => {
  const prior = storeMutationChains.get(storeName) || Promise.resolve();
  const next = prior.catch(() => {}).then(mutator);
  storeMutationChains.set(storeName, next);
  // Prevent unbounded chain retention once settled.
  next.finally(() => {
    if (storeMutationChains.get(storeName) === next) storeMutationChains.delete(storeName);
  });
  return next;
};

const assertStorageKey = (key) => {
  if (typeof key !== 'string' || key.length === 0 || key.length > 1024 || key === '__proto__') {
    throw new Error('Invalid storage key');
  }
};

// Storage is data only. Records in the fileHandles store are NOT approvals:
// a path becomes reachable through file IPC only via a dialog in main.

// Get item from storage (like localStorage.getItem)
handle('storage:getItem', async (event, storeName, key) => {
  assertRendererStore(storeName);
  assertStorageKey(key);
  const data = await readStorage(storeName);
  return Object.prototype.hasOwnProperty.call(data, key) ? data[key] ?? null : null;
});

// Set item in storage (like localStorage.setItem)
handle('storage:setItem', async (event, storeName, key, value) => {
  assertRendererStore(storeName);
  assertStorageKey(key);
  return withStoreLock(storeName, async () => {
    const data = await readStorage(storeName);
    data[key] = value;
    return await writeStorage(storeName, data);
  });
});

// Remove item from storage (like localStorage.removeItem)
handle('storage:removeItem', async (event, storeName, key) => {
  assertRendererStore(storeName);
  assertStorageKey(key);
  return withStoreLock(storeName, async () => {
    const data = await readStorage(storeName);
    delete data[key];
    return await writeStorage(storeName, data);
  });
});

// Get all items from storage (like getting all keys from localStorage)
handle('storage:getAll', async (event, storeName) => {
  assertRendererStore(storeName);
  return readStorage(storeName);
});

// Set all items in storage (bulk write)
handle('storage:setAll', async (event, storeName, data) => {
  assertRendererStore(storeName);
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Invalid storage data');
  return withStoreLock(storeName, () => writeStorage(storeName, data));
});

// Clear storage (like localStorage.clear for a specific store)
handle('storage:clear', async (event, storeName) => {
  assertRendererStore(storeName);
  return withStoreLock(storeName, () => writeStorage(storeName, {}));
});

// ============================================================
// Secrets at rest (C-7) — safeStorage, <userData>/secrets/
// ============================================================

const requireSecrets = () => {
  if (!secretsStore) throw new Error('Secure storage not ready');
  return secretsStore;
};
handle('secrets:isAvailable', async () => !!secretsStore && secretsStore.isAvailable());
handle('secrets:get', async (event, key) => (secretsStore ? secretsStore.get(key) : null));
handle('secrets:set', async (event, key, value) => requireSecrets().set(key, value));
handle('secrets:delete', async (event, key) => requireSecrets().delete(key));

// ============================================================
// file:// → app://redstring storage migration (C-5)
// ============================================================

// Payload waiting for the renderer (see electron/legacyMigration.cjs). Null
// when there is nothing to import or it has been imported.
let legacyHandoff = null;
const getOriginMigrationMarker = () => path.join(getMainOwnedPath(), 'app-origin-migration.json');

const writeOriginMigrationMarker = (details) => {
  const marker = getOriginMigrationMarker();
  const tmp = `${marker}.${process.pid}.tmp`;
  fsSync.writeFileSync(tmp, JSON.stringify({ version: 1, at: new Date().toISOString(), ...details }, null, 2), { mode: 0o600 });
  fsSync.renameSync(tmp, marker);
};

// Returns 'quit' when the user chose to quit instead of continuing.
async function runOriginMigration() {
  if (fsSync.existsSync(getOriginMigrationMarker())) return 'done';

  // With the grantFileProtocolExtraPrivileges fuse off, file:// is Chromium's
  // plain file handler, which can't read inside app.asar — so the page ships
  // unpacked (electron-builder asarUnpack: electron/migration/**).
  const pagePath = path.join(__dirname, 'migration', 'legacy-origin.html')
    .replace(`${path.sep}app.asar${path.sep}`, `${path.sep}app.asar.unpacked${path.sep}`);

  let legacyState;
  try {
    legacyState = await legacyMigration.runLegacyExport({
      BrowserWindow,
      pagePath,
      partition: partitionName,
      userDataDir: app.getPath('userData'),
      timeoutMs: 120000
    });
  } catch (err) {
    console.error('[Migration] Could not read storage from the previous version:', err.message);
    const choice = dialog.showMessageBoxSync({
      type: 'warning',
      buttons: ['Quit and Try Again', 'Continue Anyway'],
      defaultId: 0,
      cancelId: 0,
      message: 'Redstring couldn’t carry your settings over from the previous version.',
      detail: 'Nothing has been changed or removed. Quitting and reopening Redstring will try again. ' +
        'If you continue, the app opens without your saved settings, API keys and GitHub connection for now; your universe files are untouched.'
    });
    return choice === 0 ? 'quit' : 'continue';
  }

  // Decrypted secrets travel as `rsplain:v1:` values; the renderer's
  // secureStore moves them into window.electron.secrets (safeStorage) on first
  // read and scrubs them from localStorage.
  const handoff = legacyMigration.buildHandoffPayload(legacyState);
  console.log('[Migration] Legacy storage exported:', JSON.stringify(handoff.summary));

  if (handoff.isEmpty) {
    try {
      writeOriginMigrationMarker({ result: 'nothing-to-migrate', summary: handoff.summary });
    } catch (err) {
      console.error('[Migration] Could not write marker:', err.message);
    }
    return 'done';
  }
  legacyHandoff = { payload: handoff.payload, summary: handoff.summary };
  return 'pending';
}

handle('migration:takeLegacyState', async () => (legacyHandoff ? legacyHandoff.payload : null));

handle('migration:complete', async (event, result) => {
  if (!legacyHandoff) return false;
  if (result && result.ok === true) {
    try {
      writeOriginMigrationMarker({ result: 'imported', summary: legacyHandoff.summary, counts: result.counts || null });
      console.log('[Migration] Legacy storage imported into app://redstring:', JSON.stringify(result.counts || {}));
      legacyHandoff = null;
      return true;
    } catch (err) {
      console.error('[Migration] Could not write marker:', err.message);
      return false;
    }
  }
  console.error('[Migration] Renderer import failed; legacy data kept, will retry next launch:', result && result.error);
  return false;
});

// ============================================================
// GitHub Device Flow — fully local, no OAuth server / no client_secret.
// Both endpoints live on github.com (not api.github.com) and do NOT send
// CORS headers, so the renderer can't call them directly. We proxy them
// from the main process and let the renderer drive the polling cadence.
// ============================================================

const GITHUB_CLIENT_ID_RE = /^[A-Za-z0-9._-]{1,100}$/;

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

handle('github:deviceFlow:requestCode', async (event, { clientId, scope } = {}) => {
  if (!clientId || !GITHUB_CLIENT_ID_RE.test(String(clientId))) throw new Error('Missing GitHub client_id');
  const params = new URLSearchParams();
  params.set('client_id', clientId);
  if (typeof scope === 'string' && scope) params.set('scope', scope.slice(0, 500));
  return githubFetchJSON('https://github.com/login/device/code', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString()
  });
});

handle('github:deviceFlow:pollToken', async (event, { clientId, deviceCode } = {}) => {
  if (!clientId || !GITHUB_CLIENT_ID_RE.test(String(clientId))) throw new Error('Missing GitHub client_id');
  if (!deviceCode || typeof deviceCode !== 'string' || deviceCode.length > 512) throw new Error('Missing device_code');
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

handle('shell:openExternal', async (event, url) => {
  // https/http/mailto only — never let the renderer trigger file:, smb:, or
  // another app's custom scheme.
  if (!isSafeExternalUrl(url)) return false;
  await shell.openExternal(url);
  return true;
});

// ============================================================
// Agent server IPC
// ============================================================

handle('agent:status', async () => {
  return {
    running: agentServerProcess !== null,
    pid: agentServerProcess?.pid || null
  };
});

handle('agent:restart', async () => {
  stopAgentServer();
  // Small delay to ensure clean shutdown
  await new Promise(resolve => setTimeout(resolve, 500));
  startAgentServer();
  return { success: true };
});

// C-6: where the local agent server listens, and the token it requires.
// Answered once the server is listening; capped, so a server that hangs on
// startup still gets the ordinary failed-request path rather than a stuck page.
handle('agent:getConnection', async () => {
  await Promise.race([agentListening, new Promise(r => setTimeout(r, AGENT_LISTEN_WAIT_MS))]);
  return { baseUrl: `http://127.0.0.1:${agentPort}`, token: agentToken };
});

// ============================================================
// The Druid's local models (Settings › Debug › The Druid)
// ============================================================

let druidBridge = null;
const getDruidBridge = () => (druidBridge ||= createDruidBridge({ executable: defaultBridgePath(app.getAppPath()) }));

// Development only for now: the helper is built in a checkout, not shipped.
if (isDev) {
  handle('druid:afm', async (event, request) => getDruidBridge().afm(request));
  handle('druid:chat', async (event, { endpoint, body } = {}) => getDruidBridge().chat(endpoint, body));
}

// Second-launch attempts are forwarded here by the single-instance lock.
app.on('second-instance', () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  } else if (app.isReady() && BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

app.whenReady().then(async () => {
  // Prevent multiple instances on ALL platforms. macOS needs this too:
  // LaunchServices only dedupes launches of the same bundle path, so a copy
  // in the DMG, an updater relaunch racing a user relaunch, or a delayed
  // ShipIt spawn can all start a second instance sharing the same userData.
  // --session instances are intentionally isolated (own data dir + partition),
  // so they skip the lock — it's keyed on the shared userData path.
  if (!sessionName) {
    const gotTheLock = app.requestSingleInstanceLock();
    if (!gotTheLock) {
      app.quit();
      return;
    }
  }

  // Create Redstring directories
  await ensureDirectories();
  initApprovals();
  secretsStore = createSecretsStore({ dir: getSecretsPath(), safeStorage });
  // Settle Keychain access now, before anything is on a clock. On macOS the
  // first use of the encryption key can show a Keychain prompt, and the
  // storage migration below would otherwise wait on it until it timed out.
  // This call blocks until the prompt (if any) is answered.
  secretsStore.unlock();

  hardenSession(getAppSession());

  // Packaged builds moved from file:// to app://redstring; carry the old
  // origin's storage across before the app window exists.
  if (!isDev) {
    const outcome = await runOriginMigration();
    if (outcome === 'quit') {
      app.quit();
      return;
    }
  }

  // Start the agent server (AI backend)
  startAgentServer();

  createWindow();
  createMenu();

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });

  // Initialize updater (handles preflight cleanup, event wiring, IPC, periodic recheck).
  // REDSTRING_DISABLE_UPDATER=1 skips it entirely — for smoke-testing a local
  // build without touching the installed app's shared ShipIt/updater caches.
  if (process.env.REDSTRING_DISABLE_UPDATER === '1') {
    console.log('[Electron] Updater disabled by REDSTRING_DISABLE_UPDATER');
    return;
  }
  updaterHandle = initUpdater({
    app,
    getMainWindow: () => mainWindow,
    isDev,
    isTrustedSender: isTrusted,
    stopAgentServer,
    sessionName
  });
});

app.on('window-all-closed', function () {
  if (!appWindowOpened) return;
  if (process.platform !== 'darwin') app.quit();
});

// Clean up agent server when app is quitting
app.on('will-quit', () => {
  stopAgentServer();
  druidBridge?.close();
});

// Also handle before-quit for macOS
app.on('before-quit', () => {
  stopAgentServer();
});

// Updater IPC handlers live in electron/updater.cjs (registered by initUpdater)
