/**
 * Build a formula into a web from text: one Thing per token, connections from
 * each operator to its operands, laid out as a tree (operator above, operands
 * below it left to right, which is the order the formula reads them back in),
 * and a group around the whole thing named after the formula, shown as the
 * formula.
 *
 * Names are references, the way they are everywhere else in Redstring: a Thing
 * that already exists by that name is placed again rather than duplicated, so
 * every formula's "+" is the same Addition and every "c" the same c.
 */
import { v4 as uuidv4 } from 'uuid';
import useGraphStore from '../../../../store/graphStore.js';
import { NODE_DEFAULT_COLOR } from '../../../../constants.js';
import { getNodeDimensions } from '../../../../utils.js';
import { parseFormulaText, formulaToText } from './formulaNotation.js';

const OPERATOR_DESCRIPTIONS = {
  eq: 'States that its two sides are equal.',
  ne: 'States that its two sides are not equal.',
  lt: 'States that the left side is less than the right.',
  gt: 'States that the left side is greater than the right.',
  le: 'States that the left side is at most the right.',
  ge: 'States that the left side is at least the right.',
  approx: 'States that its two sides are approximately equal.',
  add: 'The sum of its operands.',
  sub: 'The first operand less the second.',
  mul: 'The product of its operands.',
  div: 'The first operand divided by the second.',
  neg: 'The opposite of its operand.',
  pow: 'The base raised to the power of the exponent.',
  sqrt: 'The number that, multiplied by itself, gives its operand.',
};

const H_GAP = 50;
const V_GAP = 110;

// Case matters for symbols (E is not e), not for words (Mass is mass).
const nameKey = (name) => {
  const s = String(name).trim();
  return s.length <= 3 ? s : s.toLowerCase();
};

function findPrototypeByName(prototypes, name) {
  const want = nameKey(name);
  for (const proto of prototypes.values()) {
    if (proto.isOrbitCatalog) continue;
    if (nameKey(proto.name || '') === want) return proto;
  }
  return null;
}

/**
 * @param {string} text - e.g. "E = m * c^2"
 * @param {string} graphId - the web to build into
 * @param {{x: number, y: number}} at - canvas point for the middle of the formula
 * @returns {{ instanceIds: string[], groupId: string|null, text: string }}
 * @throws {Error} when the text isn't a formula (message is short and user-facing)
 */
export function buildFormulaInWeb(text, graphId, at) {
  const tree = parseFormulaText(text);
  const store = useGraphStore.getState();
  if (!store.graphs.get(graphId)) throw new Error('No web to add it to');

  // Prototypes: reuse by name, create what's missing (one per name, even if
  // the formula uses it twice).
  const protoByName = new Map();
  const protoFor = (node) => {
    const key = nameKey(node.name);
    if (protoByName.has(key)) return protoByName.get(key);
    let proto = findPrototypeByName(useGraphStore.getState().nodePrototypes, node.name);
    if (!proto) {
      proto = {
        id: uuidv4(),
        name: String(node.name),
        color: NODE_DEFAULT_COLOR,
        description: node.kind === 'op' ? (OPERATOR_DESCRIPTIONS[node.op.key] || '') : '',
        typeNodeId: null,
        definitionGraphIds: [],
      };
      store.addNodePrototype(proto);
    }
    protoByName.set(key, proto);
    return proto;
  };

  // Tidy tree layout: every subtree gets the width of its widest row of leaves.
  const measure = (node) => {
    const dims = getNodeDimensions({ name: String(node.name) }, false, null);
    node._w = dims.currentWidth;
    node._h = dims.currentHeight;
    if (!node.children?.length) { node._span = node._w; return; }
    node.children.forEach(measure);
    const childSpan = node.children.reduce((sum, c) => sum + c._span, 0) + H_GAP * (node.children.length - 1);
    node._span = Math.max(node._w, childSpan);
  };
  measure(tree);

  const nodes = [];
  const edges = [];
  const place = (node, left, top) => {
    const proto = protoFor(node);
    const instanceId = uuidv4();
    const centerX = left + node._span / 2;
    nodes.push({ instanceId, prototypeId: proto.id, x: centerX - node._w / 2, y: top, scale: 1 });
    if (node.children?.length) {
      const childSpan = node.children.reduce((sum, c) => sum + c._span, 0) + H_GAP * (node.children.length - 1);
      let x = centerX - childSpan / 2;
      for (const child of node.children) {
        const childId = place(child, x, top + node._h + V_GAP);
        edges.push({
          id: uuidv4(),
          sourceId: instanceId,
          destinationId: childId,
          name: '',
          typeNodeId: 'base-connection-prototype',
          definitionNodeIds: [],
          directionality: { arrowsToward: new Set([childId]) },
        });
        x += child._span + H_GAP;
      }
    }
    return instanceId;
  };
  // Centred on the point asked for, so the formula shown in place (centred on
  // its Things) lands where the person clicked.
  const depth = (node) => 1 + Math.max(0, ...(node.children || []).map(depth));
  const levels = depth(tree);
  const rowH = tree._h + V_GAP;
  place(tree, at.x - tree._span / 2, at.y - ((levels - 1) * rowH + tree._h) / 2);

  store.pasteNodesAndEdges(graphId, nodes, edges);
  const instanceIds = nodes.map(n => n.instanceId);
  const name = formulaToText(tree);
  const groupId = store.createGroup(graphId, { name, color: NODE_DEFAULT_COLOR, memberInstanceIds: instanceIds, format: 'formula' });
  return { instanceIds, groupId, text: name };
}
