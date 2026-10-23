/**
 * Where a box opening in place goes: centred on its node, or the nearest spot to
 * that where it overlaps nothing else on the canvas.
 *
 * Worked out before the store write, from the layout the canvas will draw: the view
 * is projected with the box open at its default offset, laid out by the same pass
 * NodeCanvas runs (computeGroupLayouts), and the box's drawn bounds are slid to the
 * nearest free spot. A box's layout only translates with its offset, so one layout
 * answers for every candidate. The box morph and the camera then head straight
 * there; the node rides under the box's title (anchorFlush), so it closes there too.
 */
import useGraphStore from '../../../store/graphStore.js';
import { projectGraphView, initialOpenOffset, openGroupId, mapOpenDefinitions } from '../../../core/openDefinitions.js';
import { getNodeDimensions } from '../../../utils.js';
import { measureTextWidth } from '../../../services/textMeasurement.js';
import {
  buildGroupsByMemberIdIndex, buildChildGroupIdsIndex, computeGroupDepths,
} from '../../../services/groupLayout.js';
import { computeGroupLayouts } from './groupLayouts.js';

const CLEARANCE = 48;   // world px kept clear between the box and anything else
const STEP = 40;        // search grid, world px
const MAX_RINGS = 60;   // how far out to look (MAX_RINGS * STEP) before settling for the centre
const PLACEHOLDER_DEF_ID = '__open-placement__';

const overlaps = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/**
 * Nearest translation to `want` (both `{ x, y }`) at which `box` clears every
 * rect in `obstacles`, searched on a grid around `want`. Falls back to `want`.
 */
export function nearestFreeShift(box, obstacles, want) {
  const reach = MAX_RINGS * STEP;
  const near = obstacles.filter(o => overlaps(o, {
    x: box.x + want.x - reach, y: box.y + want.y - reach, w: box.w + 2 * reach, h: box.h + 2 * reach,
  }));
  const freeAt = (dx, dy) => {
    const r = { x: box.x + dx, y: box.y + dy, w: box.w, h: box.h };
    for (let i = 0; i < near.length; i++) if (overlaps(r, near[i])) return false;
    return true;
  };
  let best = null;
  let bestDist = Infinity;
  for (let ring = 0; ring <= MAX_RINGS; ring++) {
    // Ring `ring` holds nothing nearer than ring * STEP, so once a hit beats that, stop.
    if (ring * STEP >= bestDist) break;
    for (let i = -ring; i <= ring; i++) {
      for (let j = -ring; j <= ring; j++) {
        if (Math.max(Math.abs(i), Math.abs(j)) !== ring) continue;
        const dist = Math.hypot(i, j) * STEP;
        if (dist >= bestDist) continue;
        if (freeAt(want.x + i * STEP, want.y + j * STEP)) {
          best = { x: want.x + i * STEP, y: want.y + j * STEP };
          bestDist = dist;
        }
      }
    }
  }
  return best || want;
}

/**
 * The `openDefinition.offset` to open `instanceId` with, or null to keep the
 * default placement (nothing to measure).
 */
export function openBoxOffset({ viewGraphId, instanceId, definitionIndex = 0 }) {
  const state = useGraphStore.getState();
  const { graphs, nodePrototypes, edges, textSettings } = state;
  const ownerGraphId = mapOpenDefinitions(graphs, nodePrototypes, viewGraphId).owners.get(instanceId)?.graphId || viewGraphId;
  const ownerGraph = graphs.get(ownerGraphId);
  const instance = ownerGraph?.instances?.get(instanceId);
  const prototype = instance ? nodePrototypes.get(instance.prototypeId) : null;
  if (!prototype) return null;
  const restingView = projectGraphView(state, viewGraphId)?.instances?.get(instanceId);
  if (!restingView) return null;

  // The state as it will be once open at the default offset. A definition that
  // doesn't exist yet opens empty, so stand one in.
  let defGraphId = prototype.definitionGraphIds?.[definitionIndex];
  const hypoGraphs = new Map(graphs);
  let hypoPrototypes = nodePrototypes;
  if (!defGraphId || !graphs.has(defGraphId)) {
    defGraphId = PLACEHOLDER_DEF_ID;
    hypoGraphs.set(defGraphId, { id: defGraphId, name: prototype.name, instances: new Map(), groups: new Map(), edgeIds: [] });
    const ids = [...(prototype.definitionGraphIds || [])];
    ids[definitionIndex] = defGraphId;
    hypoPrototypes = new Map(nodePrototypes).set(prototype.id, { ...prototype, definitionGraphIds: ids });
    definitionIndex = ids.indexOf(defGraphId);
  }
  const defaultOffset = initialOpenOffset(instance, hypoGraphs.get(defGraphId));
  hypoGraphs.set(ownerGraphId, {
    ...ownerGraph,
    instances: new Map(ownerGraph.instances).set(instanceId, {
      ...instance, openDefinition: { index: definitionIndex, offset: defaultOffset },
    }),
  });
  const view = projectGraphView({ graphs: hypoGraphs, nodePrototypes: hypoPrototypes, edges }, viewGraphId);
  if (!view?.instances) return null;

  // Laid out as NodeCanvas lays it out.
  const hydratedNodes = [];
  const baseDimsById = new Map();
  view.instances.forEach((inst, id) => {
    const proto = hypoPrototypes.get(inst.prototypeId);
    if (!proto) return;
    const node = { ...proto, ...inst, id };
    hydratedNodes.push(node);
    baseDimsById.set(id, getNodeDimensions(node, false, null));
  });
  const groupsById = view.groups || new Map();
  const groupsByNodeId = buildGroupsByMemberIdIndex(groupsById);
  const childGroupIds = buildChildGroupIdsIndex(groupsById, groupsByNodeId);
  const groupStructure = {
    groupsByNodeId, childGroupIds,
    groupDepths: computeGroupDepths(groupsById, groupsByNodeId, childGroupIds),
  };
  const layouts = computeGroupLayouts({
    graphData: view, groupStructure, hydratedNodes, textSettings, editingGroupId: null, tempGroupName: '',
    nodePrototypesMap: hypoPrototypes, baseDimsById, gridSize: state.gridSettings?.size || 200,
    getTextWidth: measureTextWidth,
  });
  const boxId = openGroupId(instanceId);
  const boxEntry = layouts.entries.find(e => e.group.id === boxId);
  const vb = boxEntry?.layout?.visualBounds;
  if (!vb) return null;

  // Everything the box must clear: other Things, and other boxes and groups, less
  // what is inside this box and the groups this node already sits in (it opens
  // inside those, and they grow around it).
  const inside = new Set(boxEntry.group.memberInstanceIds || []);
  inside.add(instanceId);
  const obstacles = [];
  const pad = (x, y, w, h) => obstacles.push({ x: x - CLEARANCE, y: y - CLEARANCE, w: w + 2 * CLEARANCE, h: h + 2 * CLEARANCE });
  for (const node of hydratedNodes) {
    if (inside.has(node.id) || node.isGroupAnchor) continue;
    const dims = baseDimsById.get(node.id);
    pad(node.x, node.y, dims.currentWidth, dims.currentHeight);
  }
  for (const { group, layout } of layouts.entries) {
    if (group.id === boxId) continue;
    const members = group.memberInstanceIds || [];
    if (members.includes(instanceId)) continue; // an ancestor of the box
    if (group.anchorInstanceId && inside.has(group.anchorInstanceId)) continue; // nested inside it
    if (members.length && members.every(id => inside.has(id))) continue;
    const b = layout.visualBounds;
    if (b) pad(b.x, b.y, b.w, b.h);
  }

  // Centred on the node as it rests (where the preview card is centred too).
  const restingDims = getNodeDimensions({ ...prototype, ...instance, ...restingView }, false, null);
  const want = {
    x: restingView.x + restingDims.currentWidth / 2 - (vb.x + vb.w / 2),
    y: restingView.y + restingDims.currentHeight / 2 - (vb.y + vb.h / 2),
  };
  const shift = nearestFreeShift(vb, obstacles, want);
  return { x: defaultOffset.x + shift.x, y: defaultOffset.y + shift.y };
}
