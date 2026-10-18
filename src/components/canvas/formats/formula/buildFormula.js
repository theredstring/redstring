/**
 * Build a typed formula into a web, the way formulaChain.js reads one:
 * - each operand a Thing, in a row, left to right;
 * - each operation a connection between neighbours, defined by the operation's
 *   Thing (Addition, Multiplication, Exponentiation...), pointing the way it reads;
 * - each part in parentheses a Thing-group nested in place, its Thing named after
 *   its term and typed by what is applied to it (Square Root, Negation, sin), or
 *   untyped for plain parentheses;
 * - a group around the whole formula, named after it and shown as the formula.
 *
 * Names are references, as everywhere in Redstring: an operand, an operation or a
 * type that already exists by that name is placed again rather than duplicated.
 * A part's Thing is always new, since converting its group gives it a definition.
 */
import { v4 as uuidv4 } from 'uuid';
import useGraphStore from '../../../../store/graphStore.js';
import { NODE_DEFAULT_COLOR } from '../../../../constants.js';
import { getNodeDimensions } from '../../../../utils.js';
import { OPERATORS } from './formulaNotation.js';
import { chainFromText, chainText } from './formulaChain.js';

const OPERATOR_DESCRIPTIONS = {
  eq: 'States that its two sides are equal.',
  ne: 'States that its two sides are not equal.',
  lt: 'States that the left side is less than the right.',
  gt: 'States that the left side is greater than the right.',
  le: 'States that the left side is at most the right.',
  ge: 'States that the left side is at least the right.',
  approx: 'States that its two sides are approximately equal.',
  add: 'The sum of what it joins.',
  sub: 'The first less the second.',
  mul: 'The product of what it joins.',
  div: 'The first divided by the second.',
  neg: 'The opposite of its contents.',
  pow: 'The first raised to the power of the second.',
  sqrt: 'The number that, multiplied by itself, gives its contents.',
};

// Between terms: room for the operation's whole label on its connection (the
// label is drawn about this many canvas units per character, plus its pill and
// clearance from both Things), so "Multiplication" isn't cut to "Multi...".
const LABEL_UNITS_PER_CHAR = 26;
const LABEL_CLEARANCE = 170;
const gapFor = (opName) => Math.max(240, String(opName).length * LABEL_UNITS_PER_CHAR + LABEL_CLEARANCE);
const ARG_GAP = 240;  // between a function's arguments, which no connection joins
const PART_PAD = 70;  // a part's box around its contents

// Case matters for symbols (E is not e), not for words (Mass is mass).
const nameKey = (name) => {
  const s = String(name).trim();
  return s.length <= 3 ? s : s.toLowerCase();
};

/**
 * @param {string} text - e.g. "E = m * c^2"
 * @param {string} graphId - the web to build into
 * @param {{x: number, y: number}} at - canvas point for the middle of the formula
 * @param {object} [readOptions] - how the text is read: { convention, isKnownName } (see parseFormulaText)
 * @returns {{ instanceIds: string[], groupId: string|null, text: string }}
 * @throws {Error} when the text isn't a formula (message is short and user-facing)
 */
export function buildFormulaInWeb(text, graphId, at, readOptions) {
  const chain = chainFromText(text, readOptions);
  const store = useGraphStore.getState();
  if (!store.graphs.get(graphId)) throw new Error('No web to add it to');

  // Prototypes by name: operands, operations and types are reused.
  const protoByName = new Map();
  const prototypeNamed = (name, description = '') => {
    const key = nameKey(name);
    if (protoByName.has(key)) return protoByName.get(key);
    let proto = null;
    for (const p of useGraphStore.getState().nodePrototypes.values()) {
      if (!p.isOrbitCatalog && nameKey(p.name || '') === key) { proto = p; break; }
    }
    if (!proto) {
      proto = { id: uuidv4(), name: String(name), color: NODE_DEFAULT_COLOR, description, typeNodeId: null, definitionGraphIds: [] };
      store.addNodePrototype(proto);
    }
    protoByName.set(key, proto);
    return proto;
  };

  // Widths, inside out.
  const termWidth = (term) => {
    if (term.kind === 'thing') {
      term._w = getNodeDimensions({ name: term.name }, false, null).currentWidth;
      return term._w;
    }
    term.args.forEach(chainWidth);
    term._w = term.args.reduce((sum, a) => sum + a._w, 0) + ARG_GAP * (term.args.length - 1) + PART_PAD * 2;
    return term._w;
  };
  const chainWidth = (c) => {
    c._w = c.items.reduce((sum, item) => sum + (item.kind === 'op' ? gapFor(item.name) : termWidth(item)), 0);
    return c._w;
  };
  chainWidth(chain);

  // Build one chain from x: its parts first (each becomes a Thing-group), then
  // its own Things and the operations between its terms. Returns every
  // instance inside it.
  const buildChain = (c, left) => {
    let x = left;
    const placed = [];
    const nodes = [];
    const inside = [];
    for (const item of c.items) {
      if (item.kind === 'op') { x += gapFor(item.name); placed.push(null); continue; }
      if (item.kind === 'thing') {
        const proto = prototypeNamed(item.name);
        const id = uuidv4();
        const h = getNodeDimensions({ name: item.name }, false, null).currentHeight;
        nodes.push({ instanceId: id, prototypeId: proto.id, x, y: at.y - h / 2, scale: 1 });
        placed.push(id);
        inside.push(id);
      } else {
        const { anchorId, ids } = buildPart(item, x);
        placed.push(anchorId);
        inside.push(...ids);
      }
      x += item._w;
    }
    const edges = [];
    c.items.forEach((item, i) => {
      if (item.kind !== 'op') return;
      const from = placed[i - 1];
      const to = placed[i + 1];
      if (!from || !to) return;
      const opProto = prototypeNamed(item.name, OPERATOR_DESCRIPTIONS[item.key] || '');
      edges.push({
        id: uuidv4(), sourceId: from, destinationId: to, name: '',
        typeNodeId: 'base-connection-prototype', definitionNodeIds: [opProto.id],
        directionality: { arrowsToward: new Set([to]) },
      });
    });
    useGraphStore.getState().pasteNodesAndEdges(graphId, nodes, edges);
    return { inside };
  };

  const buildPart = (part, left) => {
    let x = left + PART_PAD;
    const ids = [];
    part.args.forEach((arg) => {
      ids.push(...buildChain(arg, x).inside);
      x += arg._w + ARG_GAP;
    });
    const st = useGraphStore.getState();
    const groupId = st.createGroup(graphId, { name: part.name, color: NODE_DEFAULT_COLOR, memberInstanceIds: ids });
    // The part's Thing: named after its term, typed by what is applied to it.
    let typeNodeId = null;
    if (part.apply === 'neg' || part.apply === 'sqrt') {
      typeNodeId = prototypeNamed(OPERATORS[part.apply].name, OPERATOR_DESCRIPTIONS[part.apply]).id;
    } else if (part.apply === 'fn') {
      typeNodeId = prototypeNamed(part.fnName).id;
    }
    const thing = { id: uuidv4(), name: part.name, color: NODE_DEFAULT_COLOR, description: '', typeNodeId, definitionGraphIds: [] };
    st.addNodePrototype(thing);
    st.convertGroupToNodeGroup(graphId, groupId, thing.id, false);
    const anchorId = useGraphStore.getState().graphs.get(graphId)?.groups?.get(groupId)?.anchorInstanceId;
    if (!anchorId) throw new Error('Could not make a part of the formula');
    return { anchorId, ids: [...ids, anchorId] };
  };

  const { inside } = buildChain(chain, at.x - chain._w / 2);
  const name = chainText(chain);
  const groupId = useGraphStore.getState().createGroup(graphId, {
    name, color: NODE_DEFAULT_COLOR, memberInstanceIds: inside, format: 'formula',
  });
  return { instanceIds: inside, groupId, text: name };
}
