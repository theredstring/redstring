// Pure functions extracted from updater.cjs so they can be unit-tested
// without loading electron / electron-updater.

function parseShipItStateForBundlePath(plistJsonString) {
  if (typeof plistJsonString !== 'string' || plistJsonString.length === 0) {
    return null;
  }
  let parsed;
  try {
    parsed = JSON.parse(plistJsonString);
  } catch {
    return null;
  }
  const url = parsed && typeof parsed.updateBundleURL === 'string' ? parsed.updateBundleURL : null;
  if (!url) return null;
  const stripped = url.startsWith('file://') ? url.slice('file://'.length) : url;
  try {
    return decodeURIComponent(stripped);
  } catch {
    return stripped;
  }
}

function computeInstallOutcome({ currentVersion, lastDownloadedVersion, failedInstallCount }) {
  const counts = { ...(failedInstallCount || {}) };
  if (!lastDownloadedVersion) {
    return { action: 'noop', nextState: { failedInstallCount: counts, clearLastDownloaded: false } };
  }
  if (currentVersion === lastDownloadedVersion) {
    delete counts[lastDownloadedVersion];
    return { action: 'clear', nextState: { failedInstallCount: counts, clearLastDownloaded: true } };
  }
  counts[lastDownloadedVersion] = (counts[lastDownloadedVersion] || 0) + 1;
  return { action: 'increment', nextState: { failedInstallCount: counts, clearLastDownloaded: false } };
}

function splitLogTailSinceOffset(buffer, offset) {
  const text = buffer.toString('utf-8');
  const lines = text.split('\n').filter((line) => line.length > 0);
  return { lines, newOffset: offset + buffer.length };
}

module.exports = {
  parseShipItStateForBundlePath,
  computeInstallOutcome,
  splitLogTailSinceOffset
};
