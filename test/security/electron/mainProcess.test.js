// @vitest-environment node
// electron/main.cjs loaded against a fake `electron`, driving its real IPC
// handlers: S-20 (approvals only from dialogs, persisted + one-time migration),
// S-21 (store names), S-22 (openExternal), S-23 (trusted senders, navigation,
// permissions), S-26 (utility process, app:// origin), S-29 (dev detection,
// DevTools menu), C-6 (agent token), C-7 (secrets).
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createFakeElectron, loadWithFakes, ipcEvent } = require('./helpers/fakeElectron.cjs');

const MAIN = path.resolve(__dirname, '../../../electron/main.cjs');
const UPDATER = path.resolve(__dirname, '../../../electron/updater.cjs');
const APP = 'app://redstring/index.html';

async function boot({ isPackaged = false, seedFileHandles = null, dialogResults = {} } = {}) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rs-main-'));
  const userData = path.join(tmp, 'userData');
  const documents = path.join(tmp, 'Documents');
  fs.mkdirSync(userData, { recursive: true });
  if (seedFileHandles) {
    fs.mkdirSync(path.join(userData, 'RedstringData'), { recursive: true });
    fs.writeFileSync(path.join(userData, 'RedstringData', 'fileHandles.json'), JSON.stringify(seedFileHandles));
  }
  const fake = createFakeElectron({ userData, documents, isPackaged, dialogResults });
  const updaterCalls = [];
  loadWithFakes(MAIN, {
    electron: fake.electron,
    [UPDATER]: { initUpdater: (opts) => { updaterCalls.push(opts); return { openDiagnostics() {} }; } }
  });
  fake.ready();
  await new Promise((r) => setTimeout(r, 50));
  const invoke = (channel, event, ...args) => {
    const fn = fake.handlers.get(channel);
    if (!fn) throw new Error('no handler ' + channel);
    return fn(event, ...args);
  };
  return { tmp, userData, documents, fake, invoke, updaterCalls };
}

describe('electron/main.cjs', () => {
  let ctx;
  afterEach(() => {
    if (ctx) fs.rmSync(ctx.tmp, { recursive: true, force: true });
    ctx = null;
  });

  describe('trusted senders (S-23)', () => {
    beforeEach(async () => { ctx = await boot(); });

    it('refuses every handler from a foreign page or a subframe', async () => {
      const evil = ipcEvent('https://evil.example/');
      const sub = ipcEvent(APP, { subframe: true });
      for (const channel of ctx.fake.handlers.keys()) {
        await expect(async () => ctx.invoke(channel, evil), channel).rejects.toThrow(/Untrusted/);
        await expect(async () => ctx.invoke(channel, sub), channel).rejects.toThrow(/Untrusted/);
      }
    });

    it('registered handlers include the new surfaces and not oauth:start', () => {
      const channels = [...ctx.fake.handlers.keys()];
      expect(channels).toEqual(expect.arrayContaining([
        'secrets:get', 'secrets:set', 'secrets:delete', 'secrets:isAvailable',
        'agent:getConnection', 'migration:takeLegacyState', 'migration:complete'
      ]));
      expect(channels).not.toContain('oauth:start');
    });
  });

  describe('storage IPC (S-20, S-21)', () => {
    beforeEach(async () => { ctx = await boot(); });

    it('a fileHandles record written by the renderer does not approve its path', async () => {
      const ev = ipcEvent(APP);
      const secret = path.join(ctx.tmp, 'outside', 'secret.txt');
      fs.mkdirSync(path.dirname(secret), { recursive: true });
      fs.writeFileSync(secret, 'top secret');
      await ctx.invoke('storage:setItem', ev, 'fileHandles', 'evil', { handle: secret, displayPath: secret });
      await ctx.invoke('storage:setAll', ev, 'fileHandles', { evil: { handle: secret } });
      await ctx.invoke('storage:getAll', ev, 'fileHandles');
      await ctx.invoke('storage:getItem', ev, 'fileHandles', 'evil');
      await expect(ctx.invoke('file:read', ev, secret)).rejects.toThrow(/not approved/);
    });

    it('rejects traversal and reserved store names', async () => {
      const ev = ipcEvent(APP);
      await expect(ctx.invoke('storage:setItem', ev, '../../evil', 'k', 'v')).rejects.toThrow(/Invalid storage name/);
      await expect(ctx.invoke('storage:getAll', ev, 'a/b')).rejects.toThrow(/Invalid storage name/);
      await expect(ctx.invoke('storage:setAll', ev, 'updater', {})).rejects.toThrow(/Invalid storage name/);
      expect(fs.existsSync(path.join(ctx.userData, 'evil.json'))).toBe(false);
    });

    it('file IPC cannot reach userData (approvals, secrets, Chromium storage)', async () => {
      const ev = ipcEvent(APP);
      const approvalsFile = path.join(ctx.userData, 'RedstringMain', 'approved-paths.json');
      await expect(ctx.invoke('file:write', ev, approvalsFile, '{"files":["/etc/passwd"]}')).rejects.toThrow(/not approved/);
      await expect(ctx.invoke('file:write', ev, path.join(ctx.userData, 'RedstringData', 'fileHandles.json'), '{}')).rejects.toThrow(/not approved/);
      await expect(ctx.invoke('file:read', ev, path.join(ctx.userData, 'secrets', 'x.secret'))).rejects.toThrow(/not approved/);
    });

    it('the documents folder and the dedicated files folder stay writable', async () => {
      const ev = ipcEvent(APP);
      const inDocs = path.join(ctx.documents, 'Redstring', 'u.redstring');
      await ctx.invoke('file:write', ev, inDocs, '{"ok":1}');
      expect((await ctx.invoke('file:read', ev, inDocs)).content).toBe('{"ok":1}');
      const paths = await ctx.invoke('storage:getPaths', ev);
      await ctx.invoke('file:write', ev, path.join(paths.files, 'x.json'), '1');
    });
  });

  describe('dialog approvals (S-20)', () => {
    it('a picked file is approved and survives a restart; a picked folder covers its contents', async () => {
      const tmpOut = fs.mkdtempSync(path.join(os.tmpdir(), 'rs-picked-'));
      const picked = path.join(tmpOut, 'Picked.redstring');
      const folder = path.join(tmpOut, 'Workspace');
      fs.mkdirSync(folder);
      fs.writeFileSync(picked, 'P');
      try {
        ctx = await boot({ dialogResults: { open: picked, folder } });
        const ev = ipcEvent(APP);
        await expect(ctx.invoke('file:read', ev, picked)).rejects.toThrow();
        expect(await ctx.invoke('file:pick', ev, { properties: ['openDirectory'], defaultPath: '/' })).toBe(picked);
        // The renderer can't widen the dialog: properties are decided by main.
        expect(ctx.fake.calls.dialogs[0].properties).toEqual(['openFile']);
        expect((await ctx.invoke('file:read', ev, picked)).content).toBe('P');
        expect(await ctx.invoke('file:pickFolder', ev, {})).toBe(folder);
        await ctx.invoke('file:write', ev, path.join(folder, 'new.redstring'), 'N');

        const persisted = JSON.parse(fs.readFileSync(path.join(ctx.userData, 'RedstringMain', 'approved-paths.json'), 'utf-8'));
        expect(persisted.files).toContain(picked);
        expect(persisted.folders).toContain(folder);
      } finally {
        fs.rmSync(tmpOut, { recursive: true, force: true });
      }
    });

    it('migrates existing fileHandles.json records exactly once, absolute paths only', async () => {
      const abs = path.join(os.tmpdir(), 'rs-existing-' + Date.now() + '.redstring');
      fs.writeFileSync(abs, 'E');
      try {
        ctx = await boot({ seedFileHandles: { u1: { handle: abs, displayPath: abs }, rel: { handle: '1.redstring' } } });
        const ev = ipcEvent(APP);
        expect((await ctx.invoke('file:read', ev, abs)).content).toBe('E');
        const approvals = JSON.parse(fs.readFileSync(path.join(ctx.userData, 'RedstringMain', 'approved-paths.json'), 'utf-8'));
        expect(approvals.files).toEqual([abs]);
        expect(fs.existsSync(path.join(ctx.userData, 'RedstringMain', 'filehandles-approvals-migrated.json'))).toBe(true);
      } finally {
        fs.rmSync(abs, { force: true });
      }
    });
  });

  describe('external URLs (S-22)', () => {
    beforeEach(async () => { ctx = await boot(); });

    it('shell:openExternal passes only http(s)/mailto', async () => {
      const ev = ipcEvent(APP);
      expect(await ctx.invoke('shell:openExternal', ev, 'file:///etc/passwd')).toBe(false);
      expect(await ctx.invoke('shell:openExternal', ev, 'smb://evil/x')).toBe(false);
      expect(await ctx.invoke('shell:openExternal', ev, 'https://github.com/login/device')).toBe(true);
      expect(ctx.fake.calls.openExternal).toEqual(['https://github.com/login/device']);
    });

    it('window.open never opens a window and only hands safe URLs to the OS', () => {
      const wc = ctx.fake.calls.windows[0].webContents;
      expect(wc.openHandler({ url: 'javascript:alert(1)' })).toEqual({ action: 'deny' });
      expect(wc.openHandler({ url: 'file:///Applications/Calculator.app' })).toEqual({ action: 'deny' });
      expect(wc.openHandler({ url: 'https://wikidata.org/wiki/Q1' })).toEqual({ action: 'deny' });
      expect(ctx.fake.calls.openExternal).toEqual(['https://wikidata.org/wiki/Q1']);
    });
  });

  describe('navigation and permissions (S-23)', () => {
    beforeEach(async () => { ctx = await boot({ isPackaged: true }); });

    it('the window may not navigate or redirect off the app origin', () => {
      const wc = ctx.fake.calls.windows.find((w) => w.loadedURL).webContents;
      const nav = (event, url, extra = {}) => {
        let prevented = false;
        wc.emit(event, { url, isMainFrame: true, preventDefault: () => { prevented = true; }, ...extra });
        return prevented;
      };
      expect(nav('will-navigate', 'app://redstring/index.html?x=1')).toBe(false);
      expect(nav('will-navigate', 'https://evil.example/')).toBe(true);
      expect(nav('will-navigate', 'file:///etc/passwd')).toBe(true);
      expect(nav('will-redirect', 'https://evil.example/')).toBe(true);
      expect(nav('will-frame-navigate', 'https://evil.example/', { isMainFrame: false })).toBe(true);
      expect(nav('will-navigate', 'http://localhost:4001/')).toBe(true); // dev server is not trusted when packaged
    });

    it('denies permissions the app does not use, and any permission to foreign origins', () => {
      const ses = ctx.fake.defaultSession;
      const ask = (permission, url) => new Promise((r) => ses.permissionRequestHandler(null, permission, r, { requestingUrl: url }));
      return Promise.all([
        ask('clipboard-sanitized-write', APP).then((v) => expect(v).toBe(true)),
        ask('local-network-access', APP).then((v) => expect(v).toBe(true)),
        ask('media', APP).then((v) => expect(v).toBe(false)),
        ask('geolocation', APP).then((v) => expect(v).toBe(false)),
        ask('openExternal', APP).then((v) => expect(v).toBe(false)),
        ask('clipboard-sanitized-write', 'https://evil.example/').then((v) => expect(v).toBe(false))
      ]).then(() => {
        expect(ses.permissionCheckHandler(null, 'media', 'app://redstring')).toBe(false);
        expect(ses.permissionCheckHandler(null, 'clipboard-sanitized-write', 'app://redstring')).toBe(true);
      });
    });

    it('loads the packaged app from app://redstring, never file://', () => {
      const win = ctx.fake.calls.windows.find((w) => w.loadedURL);
      expect(win.loadedURL).toBe('app://redstring/index.html');
      expect(win.opts.webPreferences.sandbox).toBe(true);
      expect(win.opts.webPreferences.contextIsolation).toBe(true);
      expect(win.opts.webPreferences.nodeIntegration).toBe(false);
      expect(win.opts.webPreferences.webviewTag).toBe(false);
      expect(win.opts.webPreferences.devTools).toBe(false);
      expect(ctx.fake.defaultSession.protocolHandlers.has('app')).toBe(true);
      expect(ctx.fake.calls.schemes[0]).toMatchObject({ scheme: 'app', privileges: { standard: true, secure: true } });
    });

    it('packaged: no DevTools in the menu, no debug args to the preload', () => {
      const view = ctx.fake.calls.menu.template.find((m) => m.label === 'View');
      expect(view.submenu.some((i) => i.role === 'toggleDevTools')).toBe(false);
      const win = ctx.fake.calls.windows.find((w) => w.loadedURL);
      expect(win.opts.webPreferences.additionalArguments).toEqual([]);
      expect(ctx.updaterCalls[0].isDev).toBe(false);
    });

    it('an empty legacy origin writes the migration marker', () => {
      const marker = path.join(ctx.userData, 'RedstringMain', 'app-origin-migration.json');
      expect(JSON.parse(fs.readFileSync(marker, 'utf-8')).result).toBe('nothing-to-migrate');
    });
  });

  describe('agent server + secrets (S-26, C-6, C-7)', () => {
    beforeEach(async () => { ctx = await boot(); });

    it('forks a utility process with a per-launch token and no run-as-node', async () => {
      expect(ctx.fake.calls.forks).toHaveLength(1);
      const { options } = ctx.fake.calls.forks[0];
      expect(options.env.ELECTRON_RUN_AS_NODE).toBeUndefined();
      expect(options.env.REDSTRING_AGENT_TOKEN).toMatch(/^[0-9a-f]{64}$/);
      const conn = await ctx.invoke('agent:getConnection', ipcEvent(APP));
      expect(conn).toEqual({ baseUrl: `http://127.0.0.1:${options.env.REDSTRING_AGENT_PORT}`, token: options.env.REDSTRING_AGENT_TOKEN });
    });

    it('secrets round-trip through safeStorage into <userData>/secrets, never in plaintext', async () => {
      const ev = ipcEvent(APP);
      expect(await ctx.invoke('secrets:isAvailable', ev)).toBe(true);
      await ctx.invoke('secrets:set', ev, 'github_access_token', 'gho_example');
      expect(await ctx.invoke('secrets:get', ev, 'github_access_token')).toBe('gho_example');
      expect(await ctx.invoke('secrets:get', ev, 'missing')).toBe(null);
      const dir = path.join(ctx.userData, 'secrets');
      const files = fs.readdirSync(dir);
      expect(files).toHaveLength(1);
      expect(files[0]).not.toContain('github');
      expect(fs.readFileSync(path.join(dir, files[0]), 'utf-8')).not.toContain('gho_example');
      await ctx.invoke('secrets:delete', ev, 'github_access_token');
      expect(await ctx.invoke('secrets:get', ev, 'github_access_token')).toBe(null);
      await expect(ctx.invoke('secrets:set', ev, '../x', 'v')).rejects.toThrow();
    });
  });
});
