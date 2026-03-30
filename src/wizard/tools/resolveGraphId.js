/**
 * resolveGraphId - Resolve a graph ID from either an actual ID or a graph name.
 * Tries exact ID match first, then case-insensitive name match.
 *
 * @param {string} idOrName - Graph ID or name from the LLM
 * @param {Array} graphs - Array of graph objects with .id and .name
 * @returns {string|null} The resolved graph ID, or null if not found
 */
export function resolveGraphId(idOrName, graphs) {
  if (!idOrName || !Array.isArray(graphs)) return idOrName;

  // Try ID match first
  if (graphs.some(g => g.id === idOrName)) return idOrName;

  // Fall back to name-based lookup
  const nameLower = String(idOrName).toLowerCase().trim();
  const match = graphs.find(g =>
    String(g.name || '').toLowerCase().trim() === nameLower
  ) || graphs.find(g =>
    String(g.name || '').toLowerCase().trim().includes(nameLower)
  );

  return match ? match.id : idOrName;
}
