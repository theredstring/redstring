// Code-signature gate for the macOS manual installer (contract C-4).
//
// The manual swap in updater.cjs bypasses Squirrel.Mac/ShipIt, which is what
// normally refuses a bundle not signed by the running app's team. Without this
// check anything that landed in the updater cache (or ShipIt's staging dir)
// would be moved into /Applications with its quarantine stripped. So before a
// swap, the staged bundle must:
//   1. pass `codesign --verify --deep --strict` (intact, every nested binary),
//   2. satisfy a Developer ID requirement pinned to our team + bundle id,
//   3. pass Gatekeeper (`spctl --assess --type execute`, i.e. notarized).
//
// `exec(file, args)` is injectable so tests can script each tool's outcome. It
// resolves `{ code, stdout, stderr }` and never rejects for a non-zero exit.

const { execFile } = require('node:child_process');

const DEFAULT_TEAM_ID = '24MPFEY5BE';
const DEFAULT_BUNDLE_ID = 'io.redstring.app';
const TEAM_ID_RE = /^[A-Z0-9]{10}$/;
const BUNDLE_ID_RE = /^[A-Za-z0-9.-]{1,255}$/;

function defaultExec(file, args) {
  return new Promise((resolve) => {
    execFile(file, args, { timeout: 120000, maxBuffer: 4 * 1024 * 1024 }, (error, stdout, stderr) => {
      const code = error ? (typeof error.code === 'number' ? error.code : 1) : 0;
      resolve({ code, stdout: String(stdout || ''), stderr: String(stderr || (error && !stderr ? error.message : '')) });
    });
  });
}

// Developer ID Application, issued by Apple, for exactly our team and app.
function buildDesignatedRequirement(teamId, bundleId) {
  return [
    'anchor apple generic',
    `identifier "${bundleId}"`,
    'certificate 1[field.1.2.840.113635.100.6.2.6] exists',
    'certificate leaf[field.1.2.840.113635.100.6.1.13] exists',
    `certificate leaf[subject.OU] = "${teamId}"`
  ].join(' and ');
}

function firstLine(text) {
  return String(text || '').split('\n').map((l) => l.trim()).filter(Boolean)[0] || '';
}

async function verifyBundleSignature(bundlePath, { teamId = DEFAULT_TEAM_ID, bundleId = DEFAULT_BUNDLE_ID, exec = defaultExec } = {}) {
  if (typeof bundlePath !== 'string' || !bundlePath.startsWith('/') || !bundlePath.endsWith('.app')) {
    return { ok: false, reason: 'invalid bundle path' };
  }
  // Both values end up inside a requirement string; refuse anything that could
  // change its meaning.
  if (!TEAM_ID_RE.test(teamId)) return { ok: false, reason: 'invalid team id' };
  if (!BUNDLE_ID_RE.test(bundleId)) return { ok: false, reason: 'invalid bundle id' };

  try {
    const integrity = await exec('/usr/bin/codesign', ['--verify', '--deep', '--strict', '--verbose=2', bundlePath]);
    if (!integrity || integrity.code !== 0) {
      return { ok: false, reason: 'codesign verify failed: ' + firstLine(integrity && integrity.stderr) };
    }

    const requirement = buildDesignatedRequirement(teamId, bundleId);
    // "-R" "=<text>": a leading "=" means inline requirement text, not a file.
    const pinned = await exec('/usr/bin/codesign', ['--verify', '--deep', '--strict', '-R', `=${requirement}`, bundlePath]);
    if (!pinned || pinned.code !== 0) {
      return { ok: false, reason: 'signature does not match team ' + teamId + ' / ' + bundleId + ': ' + firstLine(pinned && pinned.stderr) };
    }

    const gatekeeper = await exec('/usr/sbin/spctl', ['--assess', '--type', 'execute', '--verbose=2', bundlePath]);
    if (!gatekeeper || gatekeeper.code !== 0) {
      return { ok: false, reason: 'Gatekeeper rejected bundle: ' + firstLine(gatekeeper && gatekeeper.stderr) };
    }

    return { ok: true, reason: null };
  } catch (err) {
    return { ok: false, reason: 'signature check threw: ' + (err && err.message ? err.message : String(err)) };
  }
}

module.exports = {
  verifyBundleSignature,
  buildDesignatedRequirement,
  DEFAULT_TEAM_ID,
  DEFAULT_BUNDLE_ID
};
