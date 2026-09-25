/**
 * "Ask The Wizard" from the canvas (P5.06b, moved from NodeCanvas): the intent
 * picker's state, the sticky destination, the API-key gate and the openers each
 * entry point uses. None of it needs the canvas: the openers read the stores
 * when they run, so they are plain functions here, and `WizardHost` renders the
 * picker and listens for the window events that ask for it.
 */
import { useEffect, useState } from 'react';
import { create } from 'zustand';
import useGraphStore from '../../../store/graphStore.js';
import useCanvasUIStore from '../../../store/canvasUIStore.js';
import apiKeyManager from '../../../services/apiKeyManager.js';
import debugConfig from '../../../utils/debugConfig.js';
import {
  buildWizardConnectionPrompt,
  buildWizardNodeDefinitionPrompt,
  buildWizardAbstractionPrompt,
  buildWizardGrowGraphPrompt,
  sendWizardAsk,
  resolveIncludeInstructions,
} from '../../../wizard/prompts/index.js';
import { shouldSkipPicker, defaultIntentForSurface } from '../../../wizard/prompts/intents.js';
import { dispatchWizardIntent } from '../actions/wizardIntent.js';

/**
 * The intent picker, `{ surface, facts, subjectLabel, payload }` or null. One
 * piece of state for every entry point: Connection, Thing, Web and abstraction
 * ladder all open the same modal, which asks WHAT you want to ask rather than
 * merely where the answer should land.
 *
 * `destination` is where the next ask goes. Sticky rather than a per-element
 * tri-state with an "ask me" option: the modal always opens now, so there is
 * nothing left for an "ask me" setting to trigger.
 */
export const useCanvasWizardStore = create(() => ({
  picker: null,
  destination: (() => {
    try { return debugConfig.getWizardDestination(); } catch { return 'new'; }
  })(),
}));

export const setAskWizardPicker = (picker) => useCanvasWizardStore.setState({ picker });

export function chooseWizardDestination(value) {
  useCanvasWizardStore.setState({ destination: value });
  try { debugConfig.setWizardDestination(value); } catch { }
}

/** Whether the Wizard is switched on (Settings), following changes. */
export function useWizardEnabled() {
  const [wizardEnabled, setWizardEnabled] = useState(() => {
    try { return debugConfig.isWizardEnabled(); } catch { return false; }
  });
  useEffect(() => {
    const handler = (newConfig) => {
      setWizardEnabled(!!newConfig?.enableWizard);
    };
    const unsubscribe = debugConfig.addListener(handler);
    return unsubscribe;
  }, []);
  return wizardEnabled;
}

// Gate for every "Ask The Wizard" entry point: if no AI API key is configured,
// open Settings directly to the AI & API Keys section instead of invoking the wizard.
// Returns true if a key exists (caller may proceed), false if it opened settings.
export async function ensureWizardApiKey() {
  try {
    if (await apiKeyManager.hasAPIKey()) return true;
  } catch (err) {
    console.error('[NodeCanvas] API key check failed:', err);
  }
  try {
    window.dispatchEvent(new CustomEvent('openSettingsModal', { detail: { section: 'ai' } }));
  } catch { }
  return false;
}

// The prompt builders live in src/wizard/prompts/. They were always pure over
// useGraphStore.getState(), so what remains here is only the part that belongs
// to the canvas: the API-key gate, opening the AI panel, and clearing whatever
// selection the ask consumed.
export async function openWizardAsk(build, { newConversation, afterSend, toolPolicy } = {}) {
  if (!(await ensureWizardApiKey())) return;
  // Build BEFORE opening the panel. Three of the four openers used to do this the
  // other way round, which left the panel expanded over nothing when a builder
  // bailed on missing state.
  const built = build();
  if (!built || !built.message) return;
  try {
    useGraphStore.getState().setLeftPanelExpanded(true);
  } catch { }
  useCanvasUIStore.getState().openLeftPanelView('ai');
  sendWizardAsk(built, { newConversation, toolPolicy });
  afterSend?.();
}

export async function openWizardWithPrompt(edges, { newConversation }) {
  if (!edges || edges.length === 0) return;
  await openWizardAsk(
    () => buildWizardConnectionPrompt(edges, {
      includeInstructions: resolveIncludeInstructions('refine-connections', newConversation)
    }),
    {
      newConversation,
      afterSend: () => {
        try {
          useGraphStore.getState().setSelectedEdgeId(null);
          useGraphStore.getState().setSelectedEdgeIds(new Set());
        } catch { }
      }
    }
  );
}

export async function openNodeWizardWithPrompt(prototype, { newConversation }) {
  if (!prototype) return;
  await openWizardAsk(
    () => buildWizardNodeDefinitionPrompt(prototype, {
      includeInstructions: resolveIncludeInstructions('define-node', newConversation)
    }),
    { newConversation, afterSend: () => useCanvasUIStore.getState().setSelectedInstanceIds(new Set()) }
  );
}

export async function openAbstractionWizardWithPrompt(prototype, dimension, { newConversation }) {
  if (!prototype || !dimension) return;
  await openWizardAsk(
    () => buildWizardAbstractionPrompt(prototype, dimension, {
      includeInstructions: resolveIncludeInstructions('refine-abstraction', newConversation)
    }),
    { newConversation }
  );
}

export async function openGrowGraphWizardWithPrompt({ newConversation }) {
  if (!useGraphStore.getState().activeGraphId) return;
  await openWizardAsk(
    () => buildWizardGrowGraphPrompt({
      includeInstructions: resolveIncludeInstructions('grow-graph', newConversation)
    }),
    { newConversation }
  );
}

// Run whichever intent the picker settled on.
//
// Routing is by intent id, not by surface: a Thing has five different asks and
// they are not interchangeable. The four original openers keep their own paths
// because they carry per-ask side effects (clearing the selection) and the
// full/short instruction dedupe; everything else goes through one branch.
export function runWizardIntent(a0) {
  return dispatchWizardIntent(a0, {
    openAbstractionWizardWithPrompt, openGrowGraphWizardWithPrompt, openNodeWizardWithPrompt, openWizardAsk, openWizardWithPrompt,
  });
}

// The single entry point every Ask The Wizard button now goes through.
//
// Opens the picker — except on a surface with only one thing to ask, where a
// picker would be a confirm dialog wearing a costume. That is the abstraction
// ladder today, and the rule maintains itself: give the ladder a second ask and
// its picker reappears without anything here changing.
export function openWizardPicker(surface, payload, { facts, subjectLabel }) {
  if (shouldSkipPicker(surface, facts)) {
    const intent = defaultIntentForSurface(surface, facts);
    if (intent) runWizardIntent({ intent, destination: useCanvasWizardStore.getState().destination, payload });
    return;
  }
  setAskWizardPicker({ surface, facts, subjectLabel, payload });
}
