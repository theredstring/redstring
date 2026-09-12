/**
 * Dispatching an Ask The Wizard prompt into the AI panel.
 *
 * Replaces the tail half of four near-identical openers in NodeCanvas.jsx
 * (openWizardWithPrompt / openNodeWizardWithPrompt / openAbstractionWizardWithPrompt
 * / openGrowGraphWizardWithPrompt), whose `send()` closures were byte-for-byte
 * identical. What actually differed between them — the guard, the builder, and
 * what to clear from the canvas selection afterwards — stays at the call site.
 */

/**
 * Should this ask carry the full instruction block, or the short reminder?
 *
 * A new conversation always gets the full block: there is nothing behind it to
 * refer back to. "Add to current" gets the short form only once this conversation
 * has already carried an ask of the same kind, since the instructions are
 * per-kind and a short reminder pointing at an instruction block that was never
 * sent is worse than repeating it.
 *
 * `action` is the dedupe bucket, and it has to be specific to the kind of ask —
 * two different intents sharing one bucket means the second ships a truncated
 * block written for the first.
 */
export function resolveIncludeInstructions(action, newConversation) {
  if (newConversation) return 'full';
  try {
    return (typeof window !== 'undefined' && window.__rs_wizardConversationHasAction?.(action))
      ? 'short'
      : 'full';
  } catch {
    return 'full';
  }
}

/**
 * Send a built prompt to the wizard panel.
 *
 * The user sees `summary` as a compact chip, and the model receives the full
 * `message` — the rich prompt is never rendered as chat. `replayContent` is what
 * later turns replay in place of the full text, so a conversation with several
 * asks in it does not re-upload every prompt it has ever sent.
 *
 * @param {Object} built              a prompt builder's return value
 * @param {Object} options
 * @param {boolean} options.newConversation open a fresh tab first
 * @param {string} [options.toolPolicy]     restrict this ask's toolset (wizard/toolPolicy.js)
 */
export function sendWizardAsk(built, { newConversation, toolPolicy } = {}) {
  if (!built || !built.message) return;
  const { message, summary, action, subjectLabel } = built;

  const send = () => {
    try {
      const detail = { message };
      if (summary) {
        detail.displayContent = summary;
        detail.replayContent = summary;
        detail.displayMetadata = {
          kind: 'wizard-action-chip',
          action,
          label: subjectLabel,
          fullPrompt: message
        };
      }
      if (toolPolicy) detail.toolPolicy = toolPolicy;
      window.dispatchEvent(new CustomEvent('rs-send-wizard-message', { detail }));
    } catch (err) {
      console.error('[wizard] Failed to dispatch wizard message:', err);
    }
  };

  if (newConversation) {
    try {
      window.dispatchEvent(new CustomEvent('rs-new-wizard-tab'));
    } catch (err) {
      console.error('[wizard] Failed to dispatch new wizard tab event:', err);
    }
    // Let LeftAIView's handleNewConversation run before the message arrives.
    setTimeout(send, 0);
  } else {
    send();
  }
}
