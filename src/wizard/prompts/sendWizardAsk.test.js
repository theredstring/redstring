import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { sendWizardAsk, resolveIncludeInstructions } from './sendWizardAsk.js';

const built = {
  message: 'the full rich prompt the model receives',
  summary: 'Refine connection: "A" → "B"',
  action: 'refine-connections',
  subjectLabel: '"A" → "B"'
};

describe('resolveIncludeInstructions', () => {
  afterEach(() => { delete window.__rs_wizardConversationHasAction; });

  it('always sends full instructions to a new conversation', () => {
    window.__rs_wizardConversationHasAction = () => true;
    expect(resolveIncludeInstructions('refine-connections', true)).toBe('full');
  });

  it('shortens only when this conversation already carried the same kind of ask', () => {
    window.__rs_wizardConversationHasAction = (a) => a === 'refine-connections';
    expect(resolveIncludeInstructions('refine-connections', false)).toBe('short');
    // A different intent has its own bucket: a short reminder pointing back at an
    // instruction block that was never sent is worse than repeating it.
    expect(resolveIncludeInstructions('define-node', false)).toBe('full');
  });

  it('falls back to full when the lookup is absent or throws', () => {
    expect(resolveIncludeInstructions('define-node', false)).toBe('full');
    window.__rs_wizardConversationHasAction = () => { throw new Error('boom'); };
    expect(resolveIncludeInstructions('define-node', false)).toBe('full');
  });
});

describe('sendWizardAsk', () => {
  let events;
  beforeEach(() => {
    events = [];
    vi.spyOn(window, 'dispatchEvent').mockImplementation((e) => {
      events.push({ type: e.type, detail: e.detail });
      return true;
    });
  });
  afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

  it('sends the full prompt to the model but a short chip to the user', () => {
    sendWizardAsk(built, { newConversation: false });
    expect(events).toHaveLength(1);
    const { type, detail } = events[0];
    expect(type).toBe('rs-send-wizard-message');
    expect(detail.message).toBe(built.message);
    expect(detail.displayContent).toBe(built.summary);
    expect(detail.replayContent).toBe(built.summary);
    expect(detail.displayMetadata).toMatchObject({
      kind: 'wizard-action-chip',
      action: 'refine-connections',
      label: '"A" → "B"'
    });
  });

  it('attaches a tool policy only when one is given', () => {
    sendWizardAsk(built, { newConversation: false });
    expect(events[0].detail.toolPolicy).toBeUndefined();
    events.length = 0;
    sendWizardAsk(built, { newConversation: false, toolPolicy: 'readonly' });
    expect(events[0].detail.toolPolicy).toBe('readonly');
  });

  it('opens a new tab first and defers the send so the tab exists to receive it', () => {
    vi.useFakeTimers();
    sendWizardAsk(built, { newConversation: true });
    expect(events.map(e => e.type)).toEqual(['rs-new-wizard-tab']);
    vi.runAllTimers();
    expect(events.map(e => e.type)).toEqual(['rs-new-wizard-tab', 'rs-send-wizard-message']);
  });

  it('sends nothing for a builder that bailed', () => {
    sendWizardAsk(null, { newConversation: false });
    sendWizardAsk({}, { newConversation: false });
    expect(events).toHaveLength(0);
  });
});
