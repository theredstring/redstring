/**
 * Comparing universes as their file holds them, for the shared-universe
 * tests and scripts/shared-universe-soak.mjs. No store import, so it runs in
 * plain Node as well as under vitest.
 */
import { importFromRedstring, exportToRedstring } from '../../src/formats/redstringFormat.js';
import { serializeRedstring } from '../../src/formats/universeBytes.js';
import { deepEqual } from '../../src/formats/syncMerge.js';
import { createHash } from 'node:crypto';


export const fileText = (state) => new TextDecoder().decode(serializeRedstring(exportToRedstring(state)));
export const fromFile = (text) => importFromRedstring(JSON.parse(text)).storeState;
export const asFile = (state) => fromFile(fileText(state));

const DOC = ['graphs', 'nodePrototypes', 'edges', 'edgePrototypes'];
const withoutCameras = (graphs) => new Map([...graphs].map(([id, { panOffset, zoomLevel, ...g }]) => [id, g]));
/**
 * Which picture a Thing shows. Saving to Git moves a picture out of the file
 * and leaves a ref (sha256 of its bytes), so the person who added it holds it
 * inline and everyone else holds the ref: the same picture.
 */
const pictureOf = ({ imageSrc, imageRef }) => {
  const inline = typeof imageSrc === 'string' && imageSrc.match(/^data:[^;,]+;base64,(.*)$/);
  if (inline) return `sha256:${createHash('sha256').update(Buffer.from(inline[1], 'base64')).digest('hex')}`;
  return imageRef || imageSrc || null;
};
const byPicture = (prototypes) => new Map([...prototypes].map(([id, { imageSrc, thumbnailSrc, imageRef, imageRefExt, ...rest }]) => {
  const picture = pictureOf({ imageSrc, imageRef });
  return [id, picture ? { ...rest, picture } : rest];
}));
const docOf = (state) => {
  const f = asFile(state);
  return {
    ...Object.fromEntries(DOC.map((k) => [k, f[k] || new Map()])),
    graphs: withoutCameras(f.graphs || new Map()),
    nodePrototypes: byPicture(f.nodePrototypes || new Map()),
    // Shared too, outside the entity maps: "not the same Thing" rulings.
    rulings: new Map(Object.entries(f.mergeDismissals || {}))
  };
};
const COMPARED = [...DOC, 'rulings'];

/** The same shared universe? Compared as each would be saved; cameras and personal state aside. */
export function sameDocument(a, b) {
  const [x, y] = [docOf(a), docOf(b)];
  return COMPARED.every((k) => deepEqual(x[k], y[k]));
}

/** Where two universes differ, briefly, for a failure message. */
export function describeDifference(a, b) {
  const [x, y] = [docOf(a), docOf(b)];
  const lines = [];
  for (const k of COMPARED) {
    const ids = new Set([...x[k].keys(), ...y[k].keys()]);
    for (const id of ids) {
      const [ea, eb] = [x[k].get(id), y[k].get(id)];
      if (deepEqual(ea, eb)) continue;
      if (!ea || !eb) { lines.push(`${k} ${id}: only in ${ea ? 'first' : 'second'} (${(ea || eb)?.name ?? ''})`); continue; }
      const show = (v) => JSON.stringify(v, (_, val) => (val instanceof Map ? Object.fromEntries(val) : val instanceof Set ? [...val] : val))?.slice(0, 200);
      const diff = (x, y, path) => {
        if (deepEqual(x, y)) return [];
        const kids = (v) => (v instanceof Map ? Object.fromEntries(v) : v);
        const [px, py] = [kids(x), kids(y)];
        if (px && py && typeof px === 'object' && typeof py === 'object' && !Array.isArray(px) && path.split('.').length < 5) {
          return [...new Set([...Object.keys(px), ...Object.keys(py)])].flatMap((f) => diff(px[f], py[f], `${path}.${f}`));
        }
        return [`${path} ${show(x)} vs ${show(y)}`];
      };
      lines.push(`${k} ${id}: ${diff(ea, eb, '').join('; ')}`);
    }
  }
  return lines.slice(0, 12).join('\n') || '(no difference)';
}

/** Connections pointing at Things that aren't there, and the like. */
export function brokenReferences(state) {
  const problems = [];
  const f = asFile(state);
  for (const [gid, g] of f.graphs) {
    for (const [iid, inst] of g.instances || []) if (!f.nodePrototypes.has(inst.prototypeId)) problems.push(`${gid}/${iid} -> missing Thing ${inst.prototypeId}`);
    for (const eid of g.edgeIds || []) if (!f.edges.has(eid)) problems.push(`${gid} lists missing connection ${eid}`);
  }
  for (const [eid, e] of f.edges) {
    const has = (iid) => [...f.graphs.values()].some((g) => g.instances?.has(iid));
    if (!has(e.sourceId) || !has(e.destinationId)) problems.push(`connection ${eid} has a missing end`);
  }
  return problems;
}

