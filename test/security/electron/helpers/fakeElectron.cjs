// A stand-in `electron` module for loading electron/main.cjs and
// electron/preload.cjs in plain Node. Records every IPC registration, dialog,
// openExternal and utility-process fork so tests can drive the real handlers.

const path = require('node:path');
const Module = require('node:module');
const { EventEmitter } = require('node:events');

function createFakeElectron({ userData, documents, isPackaged = false, dialogResults = {} }) {
  const handlers = new Map();
  const listeners = new Map();
  const calls = { openExternal: [], forks: [], windows: [], dialogs: [], trash: [], clipboard: [] };

  const ipcMain = {
    handle: (channel, fn) => { handlers.set(channel, fn); },
    on: (channel, fn) => { listeners.set(channel, fn); },
    once: (channel, fn) => { listeners.set(channel, fn); },
    removeListener: (channel) => { listeners.delete(channel); }
  };

  const appEmitter = new EventEmitter();
  let readyResolve;
  const ready = new Promise((r) => { readyResolve = r; });
  const app = Object.assign(appEmitter, {
    isPackaged,
    name: 'Redstring',
    setName: () => {},
    setPath: (which, value) => { if (which === 'userData') userData = value; },
    getPath: (which) => {
      if (which === 'userData') return userData;
      if (which === 'documents') return documents;
      if (which === 'home') return path.dirname(userData);
      if (which === 'exe') return '/Applications/Redstring.app/Contents/MacOS/Redstring';
      return userData;
    },
    getVersion: () => '0.15.3',
    whenReady: () => ready,
    isReady: () => true,
    requestSingleInstanceLock: () => true,
    quit: () => {},
    exit: () => {}
  });

  const makeSession = () => {
    const s = {
      permissionRequestHandler: null,
      permissionCheckHandler: null,
      protocolHandlers: new Map(),
      setPermissionRequestHandler: (fn) => { s.permissionRequestHandler = fn; },
      setPermissionCheckHandler: (fn) => { s.permissionCheckHandler = fn; },
      setDevicePermissionHandler: () => {},
      protocol: { handle: (scheme, fn) => { s.protocolHandlers.set(scheme, fn); } }
    };
    return s;
  };
  const defaultSession = makeSession();

  class FakeWebContents extends EventEmitter {
    constructor() { super(); this.openHandler = null; this.sent = []; }
    setWindowOpenHandler(fn) { this.openHandler = fn; }
    getType() { return 'window'; }
    getURL() { return 'app://redstring/index.html'; }
    send(channel, payload) { this.sent.push([channel, payload]); }
    openDevTools() {}
    executeJavaScript() { return Promise.resolve('{}'); }
  }
  class BrowserWindow extends EventEmitter {
    constructor(opts) {
      super();
      this.opts = opts;
      this.webContents = new FakeWebContents();
      this.destroyed = false;
      calls.windows.push(this);
      appEmitter.emit('web-contents-created', {}, this.webContents);
    }
    loadURL(url) { this.loadedURL = url; return Promise.resolve(); }
    loadFile(file) { this.loadedFile = file; return Promise.resolve(); }
    once(...a) { return super.once(...a); }
    isDestroyed() { return this.destroyed; }
    destroy() { this.destroyed = true; }
    isVisible() { return true; }
    show() {}
    focus() {}
    static getAllWindows() { return calls.windows.filter((w) => !w.destroyed); }
    static getFocusedWindow() { return null; }
    static fromWebContents() { return null; }
  }

  const store = new Map();
  const safeStorage = {
    isEncryptionAvailable: () => true,
    getSelectedStorageBackend: () => 'keychain',
    encryptString: (s) => Buffer.from('ENC:' + Buffer.from(s, 'utf8').toString('base64')),
    decryptString: (b) => Buffer.from(String(b).slice(4), 'base64').toString('utf8'),
    _store: store
  };

  const utilityProcess = {
    fork: (modulePath, args, options) => {
      const child = new EventEmitter();
      child.pid = 4242;
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      child.kill = () => true;
      calls.forks.push({ modulePath, args, options, child });
      return child;
    }
  };

  const electron = {
    app,
    BrowserWindow,
    ipcMain,
    safeStorage,
    utilityProcess,
    shell: {
      openExternal: async (url) => { calls.openExternal.push(url); },
      trashItem: async (p) => { calls.trash.push(p); },
      showItemInFolder: () => true,
      openPath: async () => ''
    },
    dialog: {
      showOpenDialog: async (_win, opts) => {
        calls.dialogs.push(opts);
        const isFolder = (opts.properties || []).includes('openDirectory');
        const result = isFolder ? dialogResults.folder : dialogResults.open;
        return result ? { canceled: false, filePaths: [result] } : { canceled: true, filePaths: [] };
      },
      showSaveDialog: async (_win, opts) => {
        calls.dialogs.push(opts);
        return dialogResults.save ? { canceled: false, filePath: dialogResults.save } : { canceled: true };
      },
      showMessageBoxSync: () => 1
    },
    clipboard: { writeText: async (t) => { calls.clipboard.push(t); } },
    Menu: { buildFromTemplate: (t) => ({ template: t }), setApplicationMenu: (m) => { calls.menu = m; } },
    protocol: { registerSchemesAsPrivileged: (s) => { calls.schemes = s; } },
    session: { defaultSession, fromPartition: () => defaultSession },
    contextBridge: { exposeInMainWorld: (name, api) => { calls.exposed = { name, api }; } },
    ipcRenderer: {
      invoke: (...a) => { (calls.invokes = calls.invokes || []).push(a); return Promise.resolve(); },
      send: () => {},
      on: () => {}
    }
  };

  return {
    electron,
    handlers,
    listeners,
    calls,
    defaultSession,
    ready: () => readyResolve()
  };
}

// Load a CommonJS file with `require('electron')` (and optional extra module
// overrides) answered by fakes. Returns the module's exports.
function loadWithFakes(file, overrides) {
  const originalLoad = Module._load;
  Module._load = function (request, parent, isMain) {
    if (Object.prototype.hasOwnProperty.call(overrides, request)) return overrides[request];
    if (parent && parent.filename) {
      const resolved = path.resolve(path.dirname(parent.filename), request);
      for (const key of Object.keys(overrides)) {
        if (key.startsWith('/') && (resolved === key || resolved + '.cjs' === key)) return overrides[key];
      }
    }
    return originalLoad.apply(this, arguments);
  };
  try {
    delete require.cache[require.resolve(file)];
    return require(file);
  } finally {
    Module._load = originalLoad;
  }
}

// An IPC event as Electron would deliver it from a frame at `url`.
function ipcEvent(url, { subframe = false } = {}) {
  return {
    senderFrame: { url, parent: subframe ? { url } : null },
    sender: {}
  };
}

module.exports = { createFakeElectron, loadWithFakes, ipcEvent };
