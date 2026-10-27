/**
 * Colors for what a formula makes new in a web, from what the web has
 * already: the palette its Things are in (ai/palettes.js), else its own
 * colors, else its Thing's. So a formula the wizard writes sits in the web
 * the way the Things it made beside it do, not in the default maroon. Things
 * a formula reuses (Pressure, already in the universe) keep their own color;
 * only what it makes new takes one of these.
 *
 * Pure: reads the state it is given.
 */
import { PALETTES } from '../../../../ai/palettes.js';

const hex = (c) => (typeof c === 'string' ? c.trim().toLowerCase() : '');

/** How many of the web's Things are each color: Map(color -> count). */
function colorsOf(state, graph) {
  const counts = new Map();
  for (const inst of graph?.instances?.values() || []) {
    const c = hex(state.nodePrototypes.get(inst.prototypeId)?.color);
    if (c) counts.set(c, (counts.get(c) || 0) + 1);
  }
  return counts;
}

/**
 * The palette most of the web is in, as its colors: two of its colors at
 * least (one color is a web in that color, not a palette), covering half its
 * Things or more. Else null.
 */
function paletteOf(counts) {
  const total = [...counts.values()].reduce((a, b) => a + b, 0);
  let best = null;
  let covered = 0;
  for (const p of Object.values(PALETTES)) {
    const colors = Object.values(p.colors).map(hex);
    const hits = colors.filter(c => counts.has(c));
    const n = hits.reduce((a, c) => a + counts.get(c), 0);
    if (hits.length >= 2 && n > covered) { best = colors; covered = n; }
  }
  return best && covered * 2 >= total ? best : null;
}

/**
 * A picker of colors for a formula built into `graphId`: `next()` is the
 * color for the next new Thing, or null when the web says nothing (the
 * builder's default then). In the web's palette, its least-used color first,
 * so the formula is of a piece with the web without all taking its main color.
 */
export function webColorPicker(state, graphId) {
  const graph = state?.graphs?.get(graphId);
  const counts = colorsOf(state, graph);
  if (!counts.size) {
    // An empty web: its Thing's color, as a web inside a Thing reads.
    const own = hex(state?.nodePrototypes?.get(graph?.definingNodeIds?.[0])?.color);
    return { next: () => own || null };
  }
  const choices = paletteOf(counts) || [...counts.keys()];
  const used = new Map(choices.map(c => [c, counts.get(c) || 0]));
  return {
    next() {
      let pick = choices[0];
      for (const c of choices) if (used.get(c) < used.get(pick)) pick = c;
      used.set(pick, used.get(pick) + 1);
      return pick;
    },
  };
}
