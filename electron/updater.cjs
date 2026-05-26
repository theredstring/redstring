const { autoUpdater } = require('electron-updater');
const electronLog = require('electron-log');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const https = require('node:https');
const { execFileSync, spawn } = require('node:child_process');
const { ipcMain, shell } = require('electron');
const {
  parseShipItStateForBundlePath,
  computeInstallOutcome,
  splitLogTailSinceOffset
} = require('./updater-helpers.cjs');
const { verifyStagedBundle } = require('./updater-bundle-verify.cjs');
const {
  compareVersions,
  pickPreviousRelease,
  pickAssetForArch,
  buildSwapAndRelaunchScript,
  deriveTargetBundlePath
} = require('./updater-install-helpers.cjs');

const LOG_PREFIX = '[Updater]';
const RECHECK_INTERVAL_MS = 30 * 60 * 1000;
const MAX_DOWNLOAD_FAILS = 3;
const SHIPIT_TAIL_LINES = 40;

autoUpdater.autoDownload = true;
autoUpdater.autoInstallOnAppQuit = true;
autoUpdater.logger = electronLog;
autoUpdater.logger.transports.file.level = 'info';

function log(level, ...args) {
  const fn = electronLog[level] || electronLog.info;
  fn(LOG_PREFIX, ...args);
}

// ============================================================
// Mac paths
// ============================================================

function getMacPaths(app) {
  if (process.platform !== 'darwin') return null;
  const home = app.getPath('home');
  const shipItDir = path.join(home, 'Library/Caches/io.redstring.app.ShipIt');
  return {
    shipItDir,
    shipItStateFile: path.join(shipItDir, 'ShipItState.plist'),
    shipItStderrLog: path.join(shipItDir, 'ShipIt_stderr.log'),
    updaterCacheDir: path.join(home, 'Library/Caches/redstring-updater')
  };
}

// ============================================================
// State persistence (uses same JSON pattern as main.cjs storage)
// ============================================================

function getUpdaterStoragePath(app, sessionName) {
  const folderName = sessionName ? `RedstringData_${sessionName}` : 'RedstringData';
  return path.join(app.getPath('userData'), folderName, 'updater.json');
}

function readUpdaterStateSync(app, sessionName) {
  try {
    const filePath = getUpdaterStoragePath(app, sessionName);
    const content = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(content);
  } catch (error) {
    if (error.code !== 'ENOENT') {
      log('error', 'Failed to read updater.json:', error.message);
    }
    return {};
  }
}

function writeUpdaterStateSync(app, sessionName, data) {
  try {
    const filePath = getUpdaterStoragePath(app, sessionName);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
    return true;
  } catch (error) {
    log('error', 'Failed to write updater.json:', error.message);
    return false;
  }
}

// ============================================================
// Mac preflight: validate Squirrel state and clean if desynced
// ============================================================

function wipeStagedState(macPaths, reason) {
  log('warn', 'Preflight: clearing Squirrel + updater caches —', reason);
  try {
    fs.rmSync(macPaths.shipItDir, { recursive: true, force: true });
    fs.rmSync(macPaths.updaterCacheDir, { recursive: true, force: true });
    log('info', 'Preflight: cleaned both caches');
    return { ok: true };
  } catch (rmErr) {
    log('error', 'Preflight: cleanup failed:', rmErr.message);
    return { ok: false, error: rmErr.message };
  }
}

function runMacPreflight(macPaths) {
  if (!macPaths) {
    return { outcome: 'skipped-not-mac' };
  }
  try {
    if (!fs.existsSync(macPaths.shipItStateFile)) {
      return { outcome: 'ok', detail: 'no state file' };
    }
    let parsedBundlePath = null;
    try {
      const json = execFileSync('plutil', ['-convert', 'json', '-o', '-', macPaths.shipItStateFile], {
        timeout: 2000,
        encoding: 'utf-8'
      });
      parsedBundlePath = parseShipItStateForBundlePath(json);
    } catch (parseErr) {
      log('warn', 'Preflight: failed to parse ShipItState.plist:', parseErr.message);
      try {
        fs.rmSync(macPaths.shipItDir, { recursive: true, force: true });
        log('info', 'Preflight: removed corrupted Squirrel state at', macPaths.shipItDir);
      } catch (rmErr) {
        log('error', 'Preflight: failed to remove corrupted Squirrel state:', rmErr.message);
      }
      return { outcome: 'error', detail: 'plist unparseable' };
    }

    if (!parsedBundlePath) {
      return { outcome: 'ok', detail: 'no updateBundleURL in plist' };
    }

    if (!fs.existsSync(parsedBundlePath)) {
      wipeStagedState(macPaths, 'staged bundle directory missing');
      return { outcome: 'cleaned', detail: 'staged bundle missing' };
    }

    // Bundle exists — verify it's actually a complete .app, not a half-extracted
    // husk from a hard refresh / force-kill during stage.
    const verification = verifyStagedBundle(parsedBundlePath);
    if (!verification.valid) {
      log('warn', 'Preflight: staged bundle is incomplete (' + verification.reason + ')');
      wipeStagedState(macPaths, 'incomplete bundle: ' + verification.reason);
      return { outcome: 'cleaned', detail: 'incomplete bundle: ' + verification.reason };
    }

    return { outcome: 'ok', detail: 'staged bundle valid (v' + verification.version + ')' };
  } catch (err) {
    log('error', 'Preflight: unexpected error:', err.message);
    return { outcome: 'error', detail: err.message };
  }
}

// ============================================================
// Mac cleanup: remove orphaned update.XXX dirs after a successful install
// ============================================================

function cleanupOrphanedUpdateDirs(macPaths) {
  if (!macPaths) return [];
  try {
    if (!fs.existsSync(macPaths.shipItDir)) return [];
    const entries = fs.readdirSync(macPaths.shipItDir, { withFileTypes: true });
    const removed = [];
    for (const entry of entries) {
      if (entry.isDirectory() && entry.name.startsWith('update.')) {
        const full = path.join(macPaths.shipItDir, entry.name);
        try {
          fs.rmSync(full, { recursive: true, force: true });
          removed.push(full);
        } catch (rmErr) {
          log('warn', 'Could not remove orphaned dir', full, ':', rmErr.message);
        }
      }
    }
    if (removed.length > 0) {
      log('info', 'Removed', removed.length, 'orphaned update dir(s)');
    }
    return removed;
  } catch (err) {
    log('warn', 'cleanupOrphanedUpdateDirs failed:', err.message);
    return [];
  }
}

// ============================================================
// Manual install: swap a staged .app bundle into place and relaunch
// (bypasses Squirrel.Mac/ShipIt — needed on macOS 26+ where the
// launchd XPC trigger to ShipIt is unreliable)
// ============================================================

function spawnDetachedSwapAndRelaunch({ stagedBundlePath, targetBundlePath, parentPid }) {
  const logPath = path.join(os.tmpdir(), 'redstring-installer.log');
  const script = buildSwapAndRelaunchScript({
    stagedBundlePath,
    targetBundlePath,
    parentPid,
    logPath
  });
  const child = spawn('/bin/bash', ['-c', script], {
    detached: true,
    stdio: 'ignore'
  });
  child.unref();
  return { logPath, childPid: child.pid };
}

function getTargetBundlePath(app) {
  return deriveTargetBundlePath(app.getPath('exe'));
}

// ============================================================
// Debug downgrade: download a previous GitHub release and swap it in
// ============================================================

const GITHUB_OWNER = 'theredstring';
const GITHUB_REPO = 'redstring';

function httpsGetJson(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: {
        'User-Agent': 'Redstring-Updater',
        'Accept': 'application/vnd.github+json'
      }
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        httpsGetJson(res.headers.location).then(resolve, reject);
        return;
      }
      if (res.statusCode !== 200) {
        reject(new Error('HTTP ' + res.statusCode + ' from ' + url));
        return;
      }
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf-8'))); }
        catch (err) { reject(err); }
      });
    });
    req.on('error', reject);
    req.setTimeout(15000, () => req.destroy(new Error('timeout')));
  });
}

function httpsDownloadToFile(url, destPath) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(destPath);
    const handleResponse = (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        https.get(res.headers.location, {
          headers: { 'User-Agent': 'Redstring-Updater' }
        }, handleResponse).on('error', reject);
        return;
      }
      if (res.statusCode !== 200) {
        reject(new Error('HTTP ' + res.statusCode + ' from ' + url));
        return;
      }
      res.pipe(file);
      file.on('finish', () => file.close(() => resolve()));
      file.on('error', reject);
    };
    https.get(url, { headers: { 'User-Agent': 'Redstring-Updater' } }, handleResponse).on('error', reject);
  });
}

async function findPreviousRelease(currentVersion) {
  const releases = await httpsGetJson(`https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases?per_page=30`);
  if (!Array.isArray(releases)) throw new Error('GitHub releases response was not an array');
  const prev = pickPreviousRelease(releases, currentVersion);
  if (!prev) throw new Error('No older release found on GitHub');
  return prev;
}

// ============================================================
// Mac ShipIt stderr forwarding: tail new bytes into electron-log
// ============================================================

function forwardShipItStderr(macPaths, lastOffset) {
  if (!macPaths) return { newOffset: lastOffset || 0, forwarded: 0 };
  try {
    if (!fs.existsSync(macPaths.shipItStderrLog)) {
      return { newOffset: 0, forwarded: 0 };
    }
    const stat = fs.statSync(macPaths.shipItStderrLog);
    let startOffset = typeof lastOffset === 'number' ? lastOffset : 0;
    if (stat.size < startOffset) {
      startOffset = 0;
    }
    if (stat.size === startOffset) {
      return { newOffset: stat.size, forwarded: 0 };
    }
    const fd = fs.openSync(macPaths.shipItStderrLog, 'r');
    try {
      const buf = Buffer.alloc(stat.size - startOffset);
      fs.readSync(fd, buf, 0, buf.length, startOffset);
      const { lines, newOffset } = splitLogTailSinceOffset(buf, startOffset);
      for (const line of lines) {
        electronLog.info('[ShipIt]', line);
      }
      return { newOffset, forwarded: lines.length };
    } finally {
      fs.closeSync(fd);
    }
  } catch (err) {
    log('warn', 'forwardShipItStderr failed:', err.message);
    return { newOffset: lastOffset || 0, forwarded: 0 };
  }
}

function readShipItStderrTail(macPaths, lineCount) {
  if (!macPaths || !fs.existsSync(macPaths.shipItStderrLog)) return [];
  try {
    const content = fs.readFileSync(macPaths.shipItStderrLog, 'utf-8');
    const lines = content.split('\n').filter((line) => line.length > 0);
    return lines.slice(-Math.max(1, lineCount));
  } catch {
    return [];
  }
}

// ============================================================
// Main init
// ============================================================

function initUpdater({ app, getMainWindow, isDev, stopAgentServer, sessionName }) {
  const macPaths = getMacPaths(app);
  const send = (channel, payload) => {
    const win = getMainWindow();
    if (win && !win.isDestroyed()) {
      win.webContents.send(channel, payload);
    }
  };

  // Mutable runtime state
  let state = readUpdaterStateSync(app, sessionName);
  let availableUpdateInfo = null;
  let pendingUpdateInfo = null;
  let downloadInProgress = false;
  let downloadFailCountThisSession = 0;
  let rechecksTimer = null;

  const currentVersion = app.getVersion();

  // Step 1: detect outcome of last attempt
  const { action, nextState } = computeInstallOutcome({
    currentVersion,
    lastDownloadedVersion: state.lastDownloadedVersion,
    failedInstallCount: state.failedInstallCount
  });
  state.failedInstallCount = nextState.failedInstallCount;
  if (nextState.clearLastDownloaded) {
    log('info', 'Detected successful install of', state.lastDownloadedVersion);
    state.lastDownloadedVersion = null;
    state.lastDownloadedAt = null;
    cleanupOrphanedUpdateDirs(macPaths);
  } else if (action === 'increment') {
    log('warn', 'Detected failed install of', state.lastDownloadedVersion,
      '(attempt', state.failedInstallCount[state.lastDownloadedVersion], ')');
  }

  // Step 2: preflight (skip if we're mid-transition, i.e. last-launched != current)
  // This guards against deleting Squirrel state while another instance is mid-stage.
  const safeForPreflight = !state.lastLaunchedVersion || state.lastLaunchedVersion === currentVersion;
  let preflightResult;
  if (safeForPreflight) {
    preflightResult = runMacPreflight(macPaths);
  } else {
    preflightResult = { outcome: 'skipped-transition', detail: 'version changed since last launch' };
    log('info', 'Preflight skipped:', preflightResult.detail);
  }
  state.lastPreflightOutcome = preflightResult.outcome;
  state.lastPreflightAt = new Date().toISOString();

  // Step 3: forward new ShipIt stderr
  const forward = forwardShipItStderr(macPaths, state.lastSeenShipItOffset);
  state.lastSeenShipItOffset = forward.newOffset;

  // Step 4: update lastLaunchedVersion and persist
  state.lastLaunchedVersion = currentVersion;
  writeUpdaterStateSync(app, sessionName, state);

  // ----- autoUpdater event wiring -----
  autoUpdater.on('checking-for-update', () => {
    log('info', 'Checking for update');
  });

  autoUpdater.on('update-available', (info) => {
    log('info', 'Update available:', info.version);
    availableUpdateInfo = { version: info.version, releaseName: info.releaseName || '' };
    downloadInProgress = true;
    send('updater:update-available', availableUpdateInfo);
  });

  autoUpdater.on('update-not-available', (info) => {
    log('info', 'No update available (current:', currentVersion, ')');
    send('updater:update-not-available', { currentVersion });
  });

  autoUpdater.on('download-progress', (p) => {
    send('updater:download-progress', {
      percent: typeof p?.percent === 'number' ? p.percent : 0
    });
  });

  autoUpdater.on('update-downloaded', (info) => {
    log('info', 'Update downloaded:', info.version);
    pendingUpdateInfo = { version: info.version, releaseName: info.releaseName || '' };
    downloadInProgress = false;
    downloadFailCountThisSession = 0;

    // Persist BEFORE notifying renderer — next launch can detect failed install.
    state.lastDownloadedVersion = info.version;
    state.lastDownloadedAt = new Date().toISOString();
    writeUpdaterStateSync(app, sessionName, state);

    const failsForThisVersion = state.failedInstallCount?.[info.version] || 0;
    send('updater:update-ready', {
      ...pendingUpdateInfo,
      failedInstallCount: failsForThisVersion
    });
  });

  autoUpdater.on('error', (err) => {
    const message = err && err.message ? err.message : String(err);
    const phase = downloadInProgress ? 'download' : 'check';
    log('error', 'autoUpdater error (' + phase + '):', message);

    if (phase === 'download') {
      downloadFailCountThisSession += 1;
      send('updater:error', {
        phase,
        message,
        downloadFails: downloadFailCountThisSession,
        escalated: downloadFailCountThisSession >= MAX_DOWNLOAD_FAILS
      });
    } else {
      send('updater:error', { phase, message });
    }
  });

  // ----- IPC handlers -----
  ipcMain.on('updater:install', () => {
    log('info', 'install requested — manual swap (bypassing Squirrel/ShipIt)');
    if (process.platform !== 'darwin') {
      // Other platforms: fall back to the standard flow
      try { if (typeof stopAgentServer === 'function') stopAgentServer(); } catch {}
      autoUpdater.quitAndInstall(false, true);
      return;
    }

    // macOS: do the swap ourselves. Squirrel.Mac's ShipIt is unreliable on
    // macOS 26+ (launchd never spawns it), so we read the bundle path it
    // already staged for us and move it into place from a detached helper.
    let stagedBundlePath = null;
    try {
      if (fs.existsSync(macPaths.shipItStateFile)) {
        const json = execFileSync('plutil', ['-convert', 'json', '-o', '-', macPaths.shipItStateFile], {
          timeout: 2000, encoding: 'utf-8'
        });
        stagedBundlePath = parseShipItStateForBundlePath(json);
      }
    } catch (err) {
      log('warn', 'Could not read ShipItState.plist:', err.message);
    }
    if (!stagedBundlePath) {
      log('error', 'No staged bundle path — cannot install');
      send('updater:error', {
        phase: 'install',
        message: 'No staged update found — try clearing the cache and re-downloading'
      });
      return;
    }
    const verification = verifyStagedBundle(stagedBundlePath);
    if (!verification.valid) {
      log('error', 'Staged bundle is invalid:', verification.reason);
      send('updater:error', {
        phase: 'install',
        message: 'Staged update is invalid (' + verification.reason + ') — clear cache and re-download'
      });
      return;
    }
    const targetBundlePath = getTargetBundlePath(app);
    log('info', 'Spawning detached installer:');
    log('info', '  staged: ' + stagedBundlePath);
    log('info', '  target: ' + targetBundlePath);
    try {
      const { logPath, childPid } = spawnDetachedSwapAndRelaunch({
        stagedBundlePath,
        targetBundlePath,
        parentPid: process.pid
      });
      log('info', 'Installer pid=' + childPid + ' log=' + logPath);
    } catch (err) {
      log('error', 'Failed to spawn installer:', err.message);
      send('updater:error', { phase: 'install', message: 'Could not start installer: ' + err.message });
      return;
    }

    try { if (typeof stopAgentServer === 'function') stopAgentServer(); } catch (err) {
      log('warn', 'stopAgentServer threw:', err.message);
    }
    // Give the renderer a tick to handle UI dismissal, then exit.
    app.removeAllListeners('window-all-closed');
    setTimeout(() => app.exit(0), 250);
  });

  ipcMain.handle('updater:check-pending', () => {
    if (pendingUpdateInfo) {
      const failsForThisVersion = state.failedInstallCount?.[pendingUpdateInfo.version] || 0;
      return {
        ...pendingUpdateInfo,
        status: 'downloaded',
        failedInstallCount: failsForThisVersion
      };
    }
    if (availableUpdateInfo) {
      return { ...availableUpdateInfo, status: 'available' };
    }
    return null;
  });

  ipcMain.handle('updater:open-releases', () => {
    shell.openExternal('https://github.com/theredstring/redstring/releases/latest');
  });

  ipcMain.handle('updater:check-now', async () => {
    try {
      if (downloadInProgress) {
        return { ok: false, error: 'download in progress' };
      }
      log('info', 'Manual check-for-update triggered');
      await autoUpdater.checkForUpdates();
      return { ok: true };
    } catch (err) {
      log('error', 'Manual check failed:', err.message);
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('updater:clear-cache', async () => {
    if (downloadInProgress) {
      return { ok: false, error: 'download in progress' };
    }
    const removed = [];
    try {
      if (macPaths) {
        if (fs.existsSync(macPaths.shipItDir)) {
          fs.rmSync(macPaths.shipItDir, { recursive: true, force: true });
          removed.push(macPaths.shipItDir);
        }
        if (fs.existsSync(macPaths.updaterCacheDir)) {
          fs.rmSync(macPaths.updaterCacheDir, { recursive: true, force: true });
          removed.push(macPaths.updaterCacheDir);
        }
      }
      state.lastDownloadedVersion = null;
      state.lastDownloadedAt = null;
      state.failedInstallCount = {};
      state.lastSeenShipItOffset = 0;
      writeUpdaterStateSync(app, sessionName, state);
      pendingUpdateInfo = null;
      availableUpdateInfo = null;
      log('info', 'Cache cleared:', removed.join(', ') || '(nothing to remove)');
      send('updater:diagnostics-updated', buildDiagnostics());
      return { ok: true, removedPaths: removed };
    } catch (err) {
      log('error', 'clear-cache failed:', err.message);
      return { ok: false, error: err.message, removedPaths: removed };
    }
  });

  ipcMain.handle('updater:open-log', async () => {
    try {
      const logPath = electronLog.transports.file.getFile().path;
      const result = await shell.openPath(logPath);
      if (result) {
        return { ok: false, error: result };
      }
      return { ok: true, path: logPath };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  // Debug downgrade: fetch the previous GitHub release and install it via
  // the same manual-swap path used by updater:install. Lets us reproduce the
  // auto-update flow on a packaged build without shipping anything.
  ipcMain.handle('updater:debug-downgrade', async () => {
    if (process.platform !== 'darwin') {
      return { ok: false, error: 'Downgrade is only supported on macOS' };
    }
    if (!app.isPackaged) {
      return { ok: false, error: 'Downgrade only works in packaged builds' };
    }
    try {
      log('info', 'Debug downgrade requested (current ' + currentVersion + ')');
      const prev = await findPreviousRelease(currentVersion);
      log('info', 'Previous release: ' + prev.tag);

      const asset = pickAssetForArch(prev, process.arch);
      if (!asset) {
        const arch = process.arch === 'arm64' ? 'arm64' : 'x64';
        return { ok: false, error: 'No Redstring-mac-' + arch + '.zip asset on ' + prev.tag };
      }

      const workDir = path.join(macPaths.updaterCacheDir, 'debug-downgrade', prev.tag);
      fs.rmSync(workDir, { recursive: true, force: true });
      fs.mkdirSync(workDir, { recursive: true });
      const zipPath = path.join(workDir, asset.name);

      log('info', 'Downloading ' + asset.browser_download_url);
      send('updater:diagnostics-updated', null);
      await httpsDownloadToFile(asset.browser_download_url, zipPath);
      log('info', 'Downloaded, extracting');

      // Use ditto to preserve macOS metadata + code signature
      execFileSync('/usr/bin/ditto', ['-x', '-k', zipPath, workDir], { stdio: 'pipe' });

      // Find the .app inside workDir
      const entries = fs.readdirSync(workDir);
      const appDirName = entries.find((n) => n.endsWith('.app'));
      if (!appDirName) {
        return { ok: false, error: 'No .app found inside downloaded zip' };
      }
      const stagedBundlePath = path.join(workDir, appDirName);
      const verification = verifyStagedBundle(stagedBundlePath);
      if (!verification.valid) {
        return { ok: false, error: 'Downloaded bundle invalid: ' + verification.reason };
      }
      log('info', 'Bundle verified as v' + verification.version);

      const targetBundlePath = getTargetBundlePath(app);
      log('info', 'Spawning installer: ' + stagedBundlePath + ' -> ' + targetBundlePath);
      const { logPath, childPid } = spawnDetachedSwapAndRelaunch({
        stagedBundlePath,
        targetBundlePath,
        parentPid: process.pid
      });
      log('info', 'Installer pid=' + childPid + ' log=' + logPath);

      try { if (typeof stopAgentServer === 'function') stopAgentServer(); } catch {}
      app.removeAllListeners('window-all-closed');
      setTimeout(() => app.exit(0), 500);
      return { ok: true, version: verification.version, tag: prev.tag };
    } catch (err) {
      log('error', 'Debug downgrade failed:', err.message);
      return { ok: false, error: err.message };
    }
  });

  function buildDiagnostics() {
    const squirrel = macPaths ? {
      stateFileExists: fs.existsSync(macPaths.shipItStateFile),
      stateFilePath: macPaths.shipItStateFile,
      parsedUpdateBundleURL: null,
      updateBundleExists: false,
      cacheDirExists: fs.existsSync(macPaths.shipItDir),
      cacheDirPath: macPaths.shipItDir
    } : null;

    if (squirrel && squirrel.stateFileExists) {
      try {
        const json = execFileSync('plutil', ['-convert', 'json', '-o', '-', macPaths.shipItStateFile], {
          timeout: 2000,
          encoding: 'utf-8'
        });
        squirrel.parsedUpdateBundleURL = parseShipItStateForBundlePath(json);
        squirrel.updateBundleExists = squirrel.parsedUpdateBundleURL
          ? fs.existsSync(squirrel.parsedUpdateBundleURL)
          : false;
        if (squirrel.updateBundleExists) {
          const verification = verifyStagedBundle(squirrel.parsedUpdateBundleURL);
          squirrel.bundleValid = verification.valid;
          squirrel.bundleReason = verification.valid ? null : verification.reason;
          squirrel.bundleVersion = verification.valid ? verification.version : null;
        } else {
          squirrel.bundleValid = false;
          squirrel.bundleReason = 'directory missing';
          squirrel.bundleVersion = null;
        }
      } catch {
        squirrel.parsedUpdateBundleURL = '(unparseable)';
        squirrel.bundleValid = false;
        squirrel.bundleReason = 'plist unparseable';
        squirrel.bundleVersion = null;
      }
    }

    return {
      appVersion: currentVersion,
      platform: process.platform,
      isPackaged: app.isPackaged,
      availableUpdateInfo,
      pendingUpdateInfo,
      persistedState: state,
      squirrel,
      updaterCacheDirExists: macPaths ? fs.existsSync(macPaths.updaterCacheDir) : false,
      updaterCacheDirPath: macPaths ? macPaths.updaterCacheDir : null,
      logFilePath: electronLog.transports.file.getFile().path,
      shipItStderrTail: readShipItStderrTail(macPaths, SHIPIT_TAIL_LINES)
    };
  }

  ipcMain.handle('updater:get-diagnostics', () => buildDiagnostics());

  // ----- Dev-only simulator -----
  // Lets you exercise every toast/card state from devtools console without
  // a real GitHub release. Only registered in dev mode.
  //
  // Usage from renderer devtools:
  //   await window.electron.updater.__devSimulate('update-available', { version: '0.9.9' })
  //   await window.electron.updater.__devSimulate('download-progress', { percent: 42 })
  //   await window.electron.updater.__devSimulate('update-downloaded', { version: '0.9.9', failedInstallCount: 0 })
  //   await window.electron.updater.__devSimulate('error', { phase: 'download', downloadFails: 3, escalated: true, message: 'fake' })
  //   await window.electron.updater.__devSimulate('error', { phase: 'install', message: 'fake install fail' })
  //   await window.electron.updater.__devSimulate('update-not-available')
  //   await window.electron.updater.__devSimulate('reset')   // clears in-memory state
  if (isDev) {
    log('info', 'Dev simulator IPC handler registered — use window.electron.updater.__devSimulate(...)');
    ipcMain.handle('updater:__dev:simulate', (_event, kind, payload) => {
      const data = payload || {};
      switch (kind) {
        case 'update-available':
          availableUpdateInfo = { version: data.version || '0.9.9', releaseName: data.releaseName || '' };
          downloadInProgress = true;
          send('updater:update-available', availableUpdateInfo);
          return { ok: true };
        case 'update-not-available':
          send('updater:update-not-available', { currentVersion });
          return { ok: true };
        case 'download-progress':
          send('updater:download-progress', { percent: typeof data.percent === 'number' ? data.percent : 50 });
          return { ok: true };
        case 'update-downloaded':
          pendingUpdateInfo = { version: data.version || '0.9.9', releaseName: data.releaseName || '' };
          downloadInProgress = false;
          send('updater:update-ready', {
            ...pendingUpdateInfo,
            failedInstallCount: typeof data.failedInstallCount === 'number' ? data.failedInstallCount : 0
          });
          return { ok: true };
        case 'error':
          send('updater:error', {
            phase: data.phase || 'download',
            message: data.message || 'simulated error',
            downloadFails: typeof data.downloadFails === 'number' ? data.downloadFails : 1,
            escalated: !!data.escalated
          });
          return { ok: true };
        case 'reset':
          availableUpdateInfo = null;
          pendingUpdateInfo = null;
          downloadInProgress = false;
          downloadFailCountThisSession = 0;
          return { ok: true };
        default:
          return { ok: false, error: `unknown simulate kind: ${kind}` };
      }
    });
  }

  // ----- Start checks -----
  if (!isDev) {
    try {
      autoUpdater.checkForUpdates();
    } catch (err) {
      log('error', 'initial checkForUpdates threw:', err.message);
    }
    rechecksTimer = setInterval(() => {
      if (downloadInProgress) return;
      try {
        autoUpdater.checkForUpdates();
      } catch (err) {
        log('warn', 'periodic checkForUpdates threw:', err.message);
      }
    }, RECHECK_INTERVAL_MS);
  } else {
    log('info', 'Dev mode — auto-updater idle');
  }

  return {
    openDiagnostics: () => send('updater:open-diagnostics', null),
    shutdown: () => {
      if (rechecksTimer) clearInterval(rechecksTimer);
    }
  };
}

module.exports = {
  initUpdater,
  // Exported for unit tests
  parseShipItStateForBundlePath,
  computeInstallOutcome,
  splitLogTailSinceOffset
};
