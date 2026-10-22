/**
 * New Thing Group, from the plus sign's bubble: choose a Thing, then which of
 * its Webs opens (or a new one). The plus sign stays up meanwhile and morphs
 * into the Thing, which then opens in place (plusSign.js). The bubble opens
 * it; PromptsHost renders it (ThingGroupPrompt.jsx).
 */
import { create } from 'zustand';

export const useThingGroupPromptStore = create(() => ({
  prompt: null, // { step: 'thing' } | { step: 'web', prototypeId }
}));

export const openThingGroupPrompt = () => useThingGroupPromptStore.setState({ prompt: { step: 'thing' } });
export const showThingWebs = (prototypeId) => useThingGroupPromptStore.setState({ prompt: { step: 'web', prototypeId } });
export const closeThingGroupPrompt = () => useThingGroupPromptStore.setState({ prompt: null });

/** A Thing's Webs that exist, each with its index among its definitions. */
export const websOf = (prototype, graphs) => (prototype?.definitionGraphIds || [])
  .map((graphId, index) => ({ graphId, index }))
  .filter(({ graphId }) => graphs.has(graphId));
