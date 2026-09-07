import { useCallback, useEffect, useState } from 'react';
import {
  readWizardMode,
  writeWizardMode,
  WIZARD_MODE_CHANGED_EVENT
} from '../wizard/wizardMode.js';

/**
 * The Wizard's mode ('plan' | 'goal') as React state, kept in step across every
 * control that shows it. The header button in the AI panel and the row in AI
 * settings both use this; a change in either is reflected in the other at once
 * because the write dispatches a window event that every instance listens for.
 *
 * @returns {[string, (mode: string) => void]}
 */
export function useWizardMode() {
  const [mode, setModeState] = useState(() => readWizardMode());

  useEffect(() => {
    const onChange = () => setModeState(readWizardMode());
    window.addEventListener(WIZARD_MODE_CHANGED_EVENT, onChange);
    // Another tab of the app writing the key.
    window.addEventListener('storage', onChange);
    return () => {
      window.removeEventListener(WIZARD_MODE_CHANGED_EVENT, onChange);
      window.removeEventListener('storage', onChange);
    };
  }, []);

  const setMode = useCallback((next) => {
    setModeState(writeWizardMode(next));
  }, []);

  return [mode, setMode];
}

export default useWizardMode;
