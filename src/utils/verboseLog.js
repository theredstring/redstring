/**
 * Routine startup/lifecycle chatter. Silent by default so the console stays
 * readable; turn it on with `localStorage.redstring_verbose_logs = '1'` (then
 * reload) or `RedstringDebug.verbose(true)`. Warnings and errors are never
 * gated: keep using console.warn / console.error for those.
 */
const KEY = 'redstring_verbose_logs';

const readFlag = () => {
  try {
    return typeof localStorage !== 'undefined' && localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
};

let enabled = readFlag();

export const isVerbose = () => enabled;

export const setVerbose = (on) => {
  enabled = !!on;
  try {
    if (typeof localStorage !== 'undefined') {
      if (enabled) localStorage.setItem(KEY, '1');
      else localStorage.removeItem(KEY);
    }
  } catch { /* storage unavailable */ }
  return enabled;
};

// Bound to console so the devtools source column points at the caller's tag,
// not this file.
export const vlog = (...args) => {
  if (enabled) console.log(...args);
};
