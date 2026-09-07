/**
 * wizardMode — which contract ends a Wizard turn.
 *
 *   'plan'  Plan Based (default). The Wizard writes a step plan with `planTask`
 *           and the turn ends when every step is settled. This is the loop as it
 *           has always run; selecting it changes nothing.
 *
 *   'goal'  Goal Based. The Wizard declares a goal with `declareGoal` before it
 *           builds — what it wants, what would count as satisfying it, and what
 *           would count as failing — and the turn ends on a verdict, not on a
 *           checklist. An open goal outlives the turn: it carries into the next
 *           ask until the Wizard judges it or the user changes it.
 *
 * The mode is a per-browser preference (localStorage), read fresh on every ask
 * and threaded through apiConfig.settings → buildLlmConfig → runAgent. This
 * module is imported by the agent loop, so it must stay free of React and safe
 * to load where `localStorage` does not exist.
 */

export const WIZARD_MODE_PLAN = 'plan';
export const WIZARD_MODE_GOAL = 'goal';
export const WIZARD_MODES = [WIZARD_MODE_PLAN, WIZARD_MODE_GOAL];
export const DEFAULT_WIZARD_MODE = WIZARD_MODE_PLAN;

export const WIZARD_MODE_STORAGE_KEY = 'rs.wizard.mode';
/** window event fired after a write, so every mode control re-reads. */
export const WIZARD_MODE_CHANGED_EVENT = 'rs-wizard-mode-changed';

export const WIZARD_MODE_OPTIONS = [
  { value: WIZARD_MODE_PLAN, label: 'Plan Based' },
  { value: WIZARD_MODE_GOAL, label: 'Goal Based' }
];

/** Anything that is not exactly 'goal' is the default. */
export function normalizeWizardMode(value) {
  return value === WIZARD_MODE_GOAL ? WIZARD_MODE_GOAL : WIZARD_MODE_PLAN;
}

export function readWizardMode() {
  try {
    if (typeof localStorage === 'undefined') return DEFAULT_WIZARD_MODE;
    return normalizeWizardMode(localStorage.getItem(WIZARD_MODE_STORAGE_KEY));
  } catch {
    return DEFAULT_WIZARD_MODE;
  }
}

export function writeWizardMode(value) {
  const mode = normalizeWizardMode(value);
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(WIZARD_MODE_STORAGE_KEY, mode);
  } catch {
    // Storage unavailable (private window, quota) — the in-memory state of
    // whichever control wrote it still updates via the event below.
  }
  try {
    if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
      window.dispatchEvent(new CustomEvent(WIZARD_MODE_CHANGED_EVENT, { detail: { mode } }));
    }
  } catch {
    // No window (tests, workers).
  }
  return mode;
}

export function wizardModeLabel(value) {
  const mode = normalizeWizardMode(value);
  return WIZARD_MODE_OPTIONS.find(o => o.value === mode)?.label || 'Plan Based';
}
