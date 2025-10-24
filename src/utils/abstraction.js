// Utility helpers for abstraction/carousel flows

/**
 * Returns the stable prototype ID for a carousel or canvas item.
 * Prefers item.prototypeId when present (canvas instance or enriched item),
 * otherwise falls back to item.id (prototype items in the carousel).
 */
export const getPrototypeIdFromItem = (item) => {
  if (!item) return null;
  return item.prototypeId || item.id || null;
};


