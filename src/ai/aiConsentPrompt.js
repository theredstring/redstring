/**
 * The renderer half of the one-time AI consent (src/services/aiConsent.js):
 * the dialog, and the side effect that installs the gate in front of every
 * provider request.
 *
 * Imported for its side effect by the key setup UI (APIKeySetup, which the
 * Panel loads with the Wizard view, and the AI settings section), so the gate
 * is in place before the Wizard can send anything. Kept out of every module
 * Node imports: it pulls in React.
 */

import React from 'react';
import { createRoot } from 'react-dom/client';
import ConfirmDialog from '../components/shared/ConfirmDialog.jsx';
import { installAIConsentGate } from '../services/aiConsent.js';

/**
 * Show the consent dialog (the app's standard ConfirmDialog, on its own root
 * so it works whichever view triggered the request). Resolves true on
 * Continue, false on Not now / dismiss.
 */
export function showAIConsentDialog(description, copy) {
  if (typeof document === 'undefined') return Promise.resolve(false);
  return new Promise((resolve) => {
    const container = document.createElement('div');
    container.setAttribute('data-redstring-ai-consent', description.key);
    document.body.appendChild(container);
    const root = createRoot(container);
    let settled = false;
    const finish = (accepted) => {
      if (settled) return;
      settled = true;
      resolve(accepted);
      // Unmount after the click handler has returned.
      setTimeout(() => {
        try { root.unmount(); } catch { /* already gone */ }
        container.remove();
      }, 0);
    };

    root.render(React.createElement(ConfirmDialog, {
      isOpen: true,
      title: copy.title,
      message: copy.message,
      details: copy.details,
      confirmLabel: copy.confirmLabel,
      cancelLabel: copy.cancelLabel,
      variant: 'info',
      onConfirm: () => finish(true),
      // ConfirmDialog calls onClose after onConfirm too; `settled` keeps the
      // first answer.
      onClose: () => finish(false)
    }));
  });
}

// Unit tests drive streamLLM with mocked fetches and no one to click.
if (typeof window !== 'undefined' && import.meta.env?.MODE !== 'test') {
  installAIConsentGate({ ask: showAIConsentDialog });
}
