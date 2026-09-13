/**
 * Writing text to the OS clipboard, across the three shells Redstring runs in.
 *
 * Distinct from utils/clipboard.js, which is about Redstring's own copy/paste
 * payloads — the node and edge structures Cmd+C builds and Cmd+V reads. This
 * file is only ever about handing a string to the operating system.
 *
 * WHY THIS EXISTS RATHER THAN A navigator.clipboard CALL. On Capacitor Android
 * the modern API is present and useless. Probed against the live WebView on a
 * Retroid Pocket 6 (Android 13, Capacitor 7):
 *
 *   origin           https://localhost      ← a secure context, as required
 *   isSecureContext  true
 *   clipboard        object
 *   writeText        function
 *   writeText(...)   NotAllowedError: Write permission denied.
 *
 * So every guard a caller would think to write — `isSecureContext`, `?.` on
 * `navigator.clipboard`, `typeof writeText` — passes, and the call still fails.
 * Android WebView gates async clipboard writes behind an embedder permission
 * that Capacitor does not wire up, and there is no feature test that predicts
 * it: you only find out by awaiting the rejection. A caller that awaits inside
 * a try/catch and treats the catch as "nothing to do" therefore reports success
 * on a copy that never happened, or silently does nothing at all.
 *
 * `document.execCommand('copy')` is not gated the same way and returns true on
 * that same WebView, so it is the fallback rather than the legacy path. It is
 * deprecated, not removed, and it is the only thing that works here.
 *
 * The return value is the point: callers must be able to tell a real copy from
 * a failed one, so "Copied!" is never shown to someone holding an empty
 * clipboard. Nothing throws — check the boolean.
 */

/**
 * Synchronous clipboard write via a throwaway textarea.
 *
 * The element has to be in the document and genuinely selectable, so it is
 * positioned off in the corner at 1x1 and made transparent rather than hidden:
 * `display: none` and `visibility: hidden` both make the selection impossible
 * and the copy fail. `readonly` keeps a mobile keyboard from opening for the
 * frame it is focused. position: fixed keeps focus() from scrolling the page.
 */
const copyViaExecCommand = (text) => {
  if (typeof document === 'undefined' || !document.body) return false;

  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', '');
  textarea.style.cssText = 'position:fixed;top:0;left:0;width:1px;height:1px;padding:0;border:none;outline:none;opacity:0;';

  // Restore whatever the user had focused — the copy steals the selection and
  // leaving it stolen is visible on desktop.
  const previous = document.activeElement;

  document.body.appendChild(textarea);
  try {
    textarea.focus();
    textarea.select();
    // iOS ignores select() on a readonly field; the explicit range is what
    // actually selects there.
    textarea.setSelectionRange(0, text.length);
    return document.execCommand('copy');
  } catch {
    return false;
  } finally {
    textarea.remove();
    if (previous && typeof previous.focus === 'function') {
      try { previous.focus(); } catch { /* the old node may be gone */ }
    }
  }
};

/**
 * @param {string} text
 * @returns {Promise<boolean>} true only if the text actually reached the clipboard.
 */
export const copyText = async (text) => {
  if (typeof text !== 'string' || text.length === 0) return false;

  // Electron has a real native bridge; prefer it where it exists.
  if (typeof window !== 'undefined' && window.electron?.clipboard?.writeText) {
    try {
      await window.electron.clipboard.writeText(text);
      return true;
    } catch {
      // fall through
    }
  }

  // The correct API, and the one that works everywhere except Android WebView.
  // Tried before the fallback so desktop and iOS take the supported path; its
  // rejection is immediate, well inside the ~5s transient user activation that
  // execCommand then needs.
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Android WebView's NotAllowedError lands here.
    }
  }

  return copyViaExecCommand(text);
};

export default copyText;
