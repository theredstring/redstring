/**
 * The app's own stand-in for the browser's alert() and confirm().
 *
 * A native popup is the browser's (or Electron's) chrome, not Redstring's, and
 * several of them used to show raw error text as their whole message. These two
 * calls ask the same things through the app's dialog family instead, from
 * anywhere: a service, a hook, a pie button builder, a component.
 *
 *   if (!(await askConfirm({ title: 'Delete Universe?', message: '...' }))) return;
 *   await showNotice({ title: 'Could Not Save', message: '...', details: error.message });
 *
 * Requests queue: two that arrive together are shown one after the other, each
 * resolving with its own answer. AppDialogHost (mounted once by App) renders the
 * front of the queue. With no host mounted (unit tests, before the app is up) a
 * confirm answers false, so a guarded action does not run, and a notice resolves
 * at once.
 */
import { create } from 'zustand';

export const useAppDialogStore = create(() => ({
  queue: [], // [{ id, kind: 'confirm'|'notice', title, message, details, confirmLabel, cancelLabel, variant, resolve }]
}));

let hostMounted = false;
export const setAppDialogHostMounted = (mounted) => { hostMounted = !!mounted; };
/** Whether a question asked now can be answered (false in tests and headless runs). */
export const hasAppDialogHost = () => hostMounted;

let nextId = 1;

function enqueue(kind, options, fallback) {
  if (!hostMounted) return Promise.resolve(fallback);
  return new Promise((resolve) => {
    const request = { id: nextId++, kind, ...options, resolve };
    useAppDialogStore.setState((s) => ({ queue: [...s.queue, request] }));
  });
}

/**
 * Ask a yes/no question.
 * @param {{ title: string, message?: string, details?: string, confirmLabel?: string,
 *   cancelLabel?: string, variant?: 'default'|'danger'|'warning'|'info', dismissed?: * }} options
 *   `dismissed` is the answer when the person closes it without choosing
 *   (Escape, the scrim): false unless the cancel button is a choice of its own.
 * @returns {Promise<boolean|*>} true on confirm; false on cancel; `dismissed` on Escape or the scrim.
 */
export function askConfirm({
  title,
  message = '',
  details,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  variant = 'default',
  dismissed = false,
} = {}) {
  return enqueue('confirm', { title, message, details, confirmLabel, cancelLabel, variant, dismissed }, false);
}

/**
 * Tell the person something; one button.
 * @param {{ title: string, message?: string, details?: string, buttonLabel?: string,
 *   variant?: 'info'|'error' }} options
 * @returns {Promise<void>} when it is dismissed.
 */
export function showNotice({
  title,
  message = '',
  details,
  buttonLabel = 'OK',
  variant = 'info',
} = {}) {
  return enqueue('notice', { title, message, details, confirmLabel: buttonLabel, variant }, undefined);
}

/** Passed by the host when a question is closed without a choice (Escape, the scrim). */
export const DISMISSED = Symbol('dismissed');

/** The host's buttons. Settles the request with this id and shows the next one. */
export function answerAppDialog(id, value) {
  const request = useAppDialogStore.getState().queue.find((r) => r.id === id);
  if (!request) return; // already answered (ConfirmDialog calls onClose after onConfirm)
  useAppDialogStore.setState((s) => ({ queue: s.queue.filter((r) => r.id !== id) }));
  if (request.kind !== 'confirm') request.resolve(undefined);
  // askConfirm always sets `dismissed` (false unless the caller chose another answer, null included).
  else request.resolve(value === DISMISSED ? request.dismissed : value === true);
}
