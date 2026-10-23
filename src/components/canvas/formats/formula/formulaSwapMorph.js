/**
 * An equation shown the other way (as its formula, as its Things) morphs one
 * into the other. The two wear the same outline: a band in the equation's
 * color with its title on it, a ground inside. So the band, the ground and the
 * title run between the Thing-group's box and the formula's.
 *
 * Each Thing runs between where it stands and its token: a copy of its own
 * drawing (captureThings) moves to the token, shrinking to its height and
 * fading as the token comes in, or grows back out of it. Its connections and
 * the groups inside fade with it.
 *
 * To its formula: the box as it was drawn, and the Things in it, are where the
 * formula's entrance grows from (formulaSpawn's `from`).
 *
 * To its Things: the formula plays its exit into the box (`into`). The box,
 * its Things and their connections are held hidden until the band and the
 * copies are exactly on them, then shown at once under them, and the formula
 * fades off them; the connections draw themselves in from there.
 *
 * The formula's own drawing plays both (FormulaObjectsLayer), as it does
 * opening out of its Thing and combining into it.
 */
import useGraphStore from '../../../../store/graphStore.js';
import { projectGraphView } from '../../../../core/openDefinitions.js';
import { markFormulaSpawn, markFormulaLeaving } from './formulaSpawn.js';
import { detachedCopy } from '../../groups/boxMorph.js';
import { storeNodeRect } from '../../groups/boxMorphConnections.js';

// Frames to wait for the box to be drawn after the write.
const MAX_WAIT_FRAMES = 12;

const esc = (value) => (typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(value) : String(value).replace(/["\\]/g, '\\$&'));
const reducedMotion = () => { try { return !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches; } catch { return false; } };

/** The name a group's title shows. */
function titleTextOf(graphId, groupId) {
  const st = useGraphStore.getState();
  const group = projectGraphView(st, graphId)?.groups?.get(groupId);
  if (!group) return '';
  return (group.linkedNodePrototypeId && st.nodePrototypes.get(group.linkedNodePrototypeId)?.name) || group.name || '';
}

/**
 * A Thing-group's title as drawn (groupElements' label text): its middle, its
 * size and its lines ({ x, y, fontSize, lines, lineHeight }), or null.
 */
function groupTitleOf(groupId) {
  const text = document.querySelector(`svg.canvas .node-group-title[data-group-id="${esc(groupId)}"] g.group-label > text`);
  if (!text) return null;
  const n = (el, a) => parseFloat(el.getAttribute(a));
  // Its lines (tspans placed at x), each read as written, vector marks and all (data-label).
  const spans = [...text.querySelectorAll(':scope > tspan[x]')];
  const x = n(text, 'x');
  const y = n(text, 'y');
  const fontSize = n(text, 'font-size');
  if (![x, y, fontSize].every(Number.isFinite)) return null;
  return {
    x, y, fontSize,
    lines: spans.length ? spans.map(t => t.dataset.label ?? t.textContent) : [text.dataset.label ?? text.textContent],
    lineHeight: spans.length > 1 ? n(spans[1], 'dy') || fontSize : fontSize,
  };
}

/**
 * A Thing-group's box as drawn, in canvas coordinates: its band
 * ({ x, y, w, h, r, color }), its ground (`inner`: { x, y, w, h, r }) and its
 * title (`title`: groupTitleOf, or its middle on the band above the ground at
 * the formula's size when it can't be read), or null when it isn't drawn.
 */
export function groupBoxOf(groupId) {
  if (typeof document === 'undefined' || !groupId) return null;
  const inner = document.querySelector(`svg.canvas .node-group-bg[data-group-id="${esc(groupId)}"] > rect.node-group-interior`);
  const band = inner?.previousElementSibling;
  if (!band || band.tagName !== 'rect') return null;
  const read = (el) => {
    const n = (a) => parseFloat(el.getAttribute(a)) || 0;
    return { x: n('x'), y: n('y'), w: n('width'), h: n('height'), r: n('rx') };
  };
  const b = read(band);
  const i = read(inner);
  if (b.w <= 0 || b.h <= 0) return null;
  const title = groupTitleOf(groupId) || { x: b.x + b.w / 2, y: (b.y + i.y) / 2, fontSize: null, lines: null, lineHeight: null };
  return { ...b, color: band.getAttribute('fill'), inner: i, title };
}

/**
 * The group's Things as they are drawn now, to carry to and from their tokens:
 * `things`, a copy of each Thing's own drawing with where it stands
 * ({ id, copy, rect }); `fades`, copies of what goes with them (the groups
 * inside it, and with `connections`, the connections touching them) to fade;
 * `edgeIds`, those connections.
 */
function captureThings(graphId, groupId, { connections = true } = {}) {
  const view = projectGraphView(useGraphStore.getState(), graphId);
  const group = view?.groups?.get(groupId);
  if (!group || typeof document === 'undefined') return null;
  const members = new Set(group.memberInstanceIds || []);
  const scene = document.querySelector('svg.canvas');
  if (!scene) return null;
  const things = [];
  members.forEach((id) => {
    const el = scene.querySelector(`g.node[data-instance-id="${esc(id)}"]`);
    const rect = storeNodeRect(graphId, id);
    if (el && rect) things.push({ id, copy: detachedCopy(el), rect });
  });
  const fades = [];
  view.groups.forEach((g) => {
    if (g.id === groupId || !(g.memberInstanceIds?.length) || !g.memberInstanceIds.every(id => members.has(id))) return;
    if (g.anchorInstanceId) members.add(g.anchorInstanceId);
    scene.querySelectorAll(`.node-group-bg[data-group-id="${esc(g.id)}"], .node-group-title[data-group-id="${esc(g.id)}"]`)
      .forEach(el => fades.push(detachedCopy(el)));
  });
  const edgeIds = [];
  (view.edgeIds || []).forEach((id) => {
    const e = useGraphStore.getState().edges.get(id);
    if (!e || !(members.has(e.sourceId) || members.has(e.destinationId))) return;
    edgeIds.push(id);
    if (connections) scene.querySelectorAll(`[data-edge-id="${esc(id)}"]`).forEach(el => fades.push(detachedCopy(el)));
  });
  return { things, fades, edgeIds };
}

/**
 * What showing a group as its Things brings back, as one CSS selector: the
 * group and the groups inside it, its Things, and the connections touching
 * them.
 */
function revealSelectorOf(graphId, groupId) {
  const view = projectGraphView(useGraphStore.getState(), graphId);
  const group = view?.groups?.get(groupId);
  if (!group) return null;
  const members = new Set(group.memberInstanceIds || []);
  if (group.anchorInstanceId) members.add(group.anchorInstanceId);
  const groupIds = [groupId];
  view.groups.forEach((g) => {
    if (g.id === groupId || !(g.memberInstanceIds?.length)) return;
    if (g.memberInstanceIds.every(id => members.has(id))) {
      groupIds.push(g.id);
      if (g.anchorInstanceId) members.add(g.anchorInstanceId);
    }
  });
  const edgeIds = [];
  (view.edgeIds || []).forEach((id) => {
    const e = useGraphStore.getState().edges.get(id);
    if (e && (members.has(e.sourceId) || members.has(e.destinationId))) edgeIds.push(id);
  });
  return [
    ...groupIds.map(id => `svg.canvas [data-group-id="${esc(id)}"]`),
    ...[...members].map(id => `svg.canvas g.node[data-instance-id="${esc(id)}"]`),
    ...edgeIds.map(id => `svg.canvas [data-edge-id="${esc(id)}"]`),
  ].join(',');
}

/**
 * Show a Thing-group as its formula, its box shrinking into the formula's band.
 * `write` makes the store change.
 */
export function withToFormulaMorph(graphId, groupId, write) {
  const from = reducedMotion() ? null : groupBoxOf(groupId);
  // Taken before the write, which stops drawing them.
  const ghosts = from ? captureThings(graphId, groupId) : null;
  const result = write();
  if (from) markFormulaSpawn(groupId, { ...from, ghosts, titleText: from.title.lines?.join(' ') || titleTextOf(graphId, groupId) });
  return result;
}

/**
 * Show a formula as its Things, its band growing into the Thing-group's box.
 * `drawn`: the formula as it is drawn now (formulaObjects); `write` makes the
 * store change.
 */
export function withToThingsMorph(graphId, groupId, drawn, write) {
  if (!drawn || reducedMotion() || typeof requestAnimationFrame !== 'function') return write();
  const reveal = revealSelectorOf(graphId, groupId);
  // Kept from before the write, so the drawing never misses a frame; aimed once the box is drawn.
  const leaving = markFormulaLeaving(drawn, { reveal });
  const result = write();
  const titleText = titleTextOf(graphId, groupId);
  let frames = 0;
  const aim = () => {
    const box = groupBoxOf(groupId);
    // Drawn by now (held hidden until the formula is on them): copied to grow
    // out of their tokens. Their connections draw themselves in once the
    // Things have landed (FormulaObjectsLayer), as a drawn connection does.
    if (box) leaving?.into({ ...box, ghosts: captureThings(graphId, groupId, { connections: false }), titleText: box.title.lines?.join(' ') || titleText });
    else if (frames++ < MAX_WAIT_FRAMES) requestAnimationFrame(aim);
  };
  requestAnimationFrame(aim);
  return result;
}
