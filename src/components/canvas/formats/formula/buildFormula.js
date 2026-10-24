/**
 * Build a formula into a web, the way formulaChain.js reads one:
 * - each operand a Thing, in a row, left to right;
 * - each operation a connection between neighbours, defined by the operation's
 *   Thing (Addition, Multiplication, Exponentiation...), pointing the way it reads;
 * - each part in parentheses a Thing-group nested in place, its Thing named after
 *   its term and typed by what is applied to it (Square Root, Negation, Natural
 *   Logarithm, sin), or untyped for plain parentheses;
 * - the whole equation a Thing-group too, shown as its formula: its Thing is the
 *   equation (its title, or its text while it has none), so its definition web
 *   holds its Things and each of them is a Component Of it.
 *
 * Which Thing a symbol stands for:
 * - bound (an equation from the bank): the concept's Thing, named for what it is
 *   (Pressure) and written in formulas by its symbol (labels.formula = 'P'). It is
 *   found again by where it came from, never by name, so a Thing of the user's
 *   that happens to be called Pressure is never taken over. Written here some
 *   other way than its Thing is (q₁ and q₂ for Electric Charge, written q; the
 *   bank's p for a Thing labelled P), the instance carries its own label;
 * - a bare symbol (x, P, θ): a new Thing named just that, one per formula, since
 *   the same letter means different things in different formulas. It is drawn as
 *   plain text until it is given a meaning;
 * - a number, a whole word (mass), an operation or a function: the Thing by that
 *   name, reused, since those mean the same everywhere.
 *
 * Built from the bank, the equation's section (Thermodynamics) gains it too,
 * placed in the section's web, and the section is placed in its discipline's
 * (Physics); without a section, the discipline's web holds it. Those webs only
 * ever get added to.
 */
import { v4 as uuidv4 } from 'uuid';
import useGraphStore from '../../../../store/graphStore.js';
import { NODE_DEFAULT_COLOR } from '../../../../constants.js';
import { getNodeDimensions } from '../../../../utils.js';
import { canonicalizeLink, LINK_STATES } from '../../../../formats/linkState.js';
import { OPERATORS } from './formulaNotation.js';
import { chainFromText, chainText, isSymbolText, formulaLabelOf, readFormulaGroup } from './formulaChain.js';
import { projectGraphView } from '../../../../core/openDefinitions.js';
import { markFormulaSpawn } from './formulaSpawn.js';
import {
  BANK_AGENT, bankConcept, conceptOrigin, equationOrigin, disciplineOrigin, STARTER_ORIGIN,
} from './bank/formulaBank.js';
import { itemIri } from './bank/population/sources.js';
import { equationOf } from './formulaSnapshot.js';

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
  log: 'The power the first must be raised to to give the second.',
  ln: 'The power e must be raised to to give its contents.',
  log10: 'The power 10 must be raised to to give its contents.',
  dot: 'Of two vectors: the number made by multiplying them along each other, the size of one times the size of the other in its direction.',
  cross: 'Of two vectors: the vector at right angles to both, as long as the area they span.',
  diff: 'An amount of its contents too small to see: how much it changes over an instant.',
  deriv: 'How fast the first changes as the second does: the change in it over a change in the second too small to see.',
  pderiv: 'How fast the first changes as the second does, everything else it depends on held still.',
  integral: 'Its first summed over the second, piece by piece too small to see: from where to where, or over what, when it says.',
  lineint: 'Along a path, its first summed in the direction of each step too small to see: what a field does along a path.',
  sum: 'Its first added up, once for each value of the second: from where to where, when it says.',
  lim: 'The value its first approaches as the second approaches the third.',
};

// What each function a formula can apply is, for its Thing (sin, ln...).
const FUNCTION_DESCRIPTIONS = {
  sin: 'Sine: for an angle in a right triangle, the opposite side over the hypotenuse.',
  cos: 'Cosine: for an angle in a right triangle, the adjacent side over the hypotenuse.',
  tan: 'Tangent: for an angle in a right triangle, the opposite side over the adjacent; sine over cosine.',
  sec: 'Secant: one over the cosine of an angle.',
  csc: 'Cosecant: one over the sine of an angle.',
  cot: 'Cotangent: one over the tangent of an angle; cosine over sine.',
  arcsin: 'Arcsine: the angle whose sine is its argument.',
  arccos: 'Arccosine: the angle whose cosine is its argument.',
  arctan: 'Arctangent: the angle whose tangent is its argument.',
  sinh: 'Hyperbolic sine: half the difference of e to the argument and e to its negative.',
  cosh: 'Hyperbolic cosine: half the sum of e to the argument and e to its negative.',
  tanh: 'Hyperbolic tangent: the hyperbolic sine over the hyperbolic cosine.',
  coth: 'Hyperbolic cotangent: the hyperbolic cosine over the hyperbolic sine.',
  sech: 'Hyperbolic secant: one over the hyperbolic cosine.',
  csch: 'Hyperbolic cosecant: one over the hyperbolic sine.',
  arcsinh: 'Inverse hyperbolic sine: the number whose hyperbolic sine is its argument.',
  arccosh: 'Inverse hyperbolic cosine: the number whose hyperbolic cosine is its argument.',
  arctanh: 'Inverse hyperbolic tangent: the number whose hyperbolic tangent is its argument.',
  tr: 'Trace: the sum of the entries on a square matrix\'s main diagonal.',
  Tr: 'Trace: the sum of the entries on a square matrix\'s main diagonal.',
  sgn: 'Sign: 1 for a positive argument, −1 for a negative one, 0 for zero.',
  erf: 'Error function: the chance a normal value with standard deviation 1/√2 lands within its argument of the mean.',
  erfc: 'Complementary error function: one minus the error function.',
  arg: 'Argument: the angle a complex number makes with the positive real axis.',
  lg: 'The logarithm to base 10 (base 2 in some computing texts).',
  exp: 'The exponential function: e raised to its argument.',
  abs: 'Absolute value: how far its argument is from zero, never negative.',
  max: 'Maximum: the largest of its arguments.',
  min: 'Minimum: the smallest of its arguments.',
  floor: 'Floor: the largest whole number not above its argument.',
  ceil: 'Ceiling: the smallest whole number not below its argument.',
  gcd: 'Greatest common divisor: the largest whole number dividing all of its arguments.',
  lcm: 'Least common multiple: the smallest whole number all of its arguments divide.',
  det: 'Determinant: the number a square matrix scales areas or volumes by.',
  lim: 'Limit: the value its expression approaches.',
};

// Between terms: room for the operation's whole label on its connection (the
// label is drawn about this many canvas units per character, plus its pill and
// clearance from both Things), so "Multiplication" isn't cut to "Multi...".
const LABEL_UNITS_PER_CHAR = 26;
const LABEL_CLEARANCE = 170;
const gapFor = (opName) => Math.max(240, String(opName).length * LABEL_UNITS_PER_CHAR + LABEL_CLEARANCE);
const ARG_GAP = 240;  // between a function's arguments, which no connection joins
const PART_PAD = 70;  // a part's box around its contents
const DISCIPLINE_COLUMNS = 4;
const DISCIPLINE_CELL = { w: 560, h: 320 };

// Case matters for symbols (E is not e), not for words (Mass is mass).
const nameKey = (name) => {
  const s = String(name).trim();
  return s.length <= 3 ? s : s.toLowerCase();
};
// A number, or ∞: the same everywhere, so the Thing by that name is reused.
const isNumber = (name) => /^\d+(\.\d+)?$/.test(String(name)) || String(name) === '∞';

/**
 * The key a Thing is found again by, by its name, when it is one the builder
 * reuses by name (a number, a whole word, an operation, a function or a type),
 * else null: a symbol is a Thing of its own in each formula. The formula
 * starter matches its Things to the universe's by the same rule.
 */
export const reusedNameKey = (name) => (isNumber(name) || !isSymbolText(String(name)) ? nameKey(name) : null);

/**
 * What a chain is made of: its operations, and each Thing in it by its id
 * (`protoOf(term)`), each part by what is applied to what it holds. Two parts
 * made of the same are the same Thing.
 */
export const compositionOf = (chain, protoOf) => chain.items.map((item) => {
  if (item.kind === 'op') return item.name;
  if (item.kind === 'thing') return `#${protoOf(item)}`;
  const applied = `${item.apply || ''}${item.fnName ? `:${String(item.fnName).toLowerCase()}` : ''}`;
  return `${applied}(${item.args.map(arg => compositionOf(arg, protoOf)).join(';')})`;
}).join(' ');

/**
 * What a part's Thing is made of, read from its definition, and which of its
 * definitions that is: { index, composition }, or null when none reads as one.
 */
export function partCompositionOf(state, proto, protoOf = (term) => term.protoId) {
  const eq = equationOf(state, proto);
  if (eq) return { index: eq.index, composition: compositionOf(eq.chain, protoOf) };
  // One Thing alone (√x, sin θ): its definition is that Thing, with no operation to read.
  const ids = proto?.definitionGraphIds || [];
  for (let index = 0; index < ids.length; index++) {
    const def = state.graphs.get(ids[index]);
    if (def?.instances?.size !== 1 || def.groups?.size) continue;
    const [only] = def.instances.values();
    return { index, composition: `#${protoOf({ protoId: only.prototypeId })}` };
  }
  return null;
}

/** Where a bank Thing came from, and the web address it is (as an import records one: an exact link). */
const metadataOf = (origin, link) => ({
  provenance: { wasAttributedTo: BANK_AGENT, source: origin, generatedAtTime: new Date().toISOString() },
  ...(link ? { linkConfirmations: { [canonicalizeLink(link)]: { state: LINK_STATES.EXACT, by: BANK_AGENT } } } : {}),
});

/**
 * The Thing made from this bank entry before, if any (the latest, should
 * there be several): by where it came from, or, for a concept, a Thing
 * exactly linked to the same Wikidata item (an ontology import's). Never by name.
 */
function prototypeFrom(origin, link) {
  let found = null;
  let linked = null;
  const key = link ? canonicalizeLink(link) : null;
  for (const p of useGraphStore.getState().nodePrototypes.values()) {
    if (p.semanticMetadata?.provenance?.source === origin) found = p;
    // The confirmation first: reading every Thing's links is what made a large build slow.
    else if (key && p.semanticMetadata?.linkConfirmations?.[key]?.state === LINK_STATES.EXACT
      && (p.externalLinks || []).some(l => canonicalizeLink(l) === key)) linked = p;
  }
  return found || linked;
}

/** Where a Thing came from in the bank, or null. */
export const bankOriginOf = (proto) => {
  const prov = proto?.semanticMetadata?.provenance;
  return prov?.wasAttributedTo === BANK_AGENT && typeof prov.source === 'string' ? prov.source : null;
};

/**
 * The bank's Thing for `origin`, made if there is none. One that exists is
 * only ever added to: given the formula label and description it lacks, never
 * changed where it already says something.
 */
function prototypeFromOrNew(origin, fields, link = null) {
  const existing = prototypeFrom(origin, link);
  if (existing) {
    const addLabel = fields.labels?.formula && !existing.labels?.formula;
    const addDescription = fields.description && !String(existing.description || '').trim();
    if (addLabel || addDescription) {
      useGraphStore.getState().updateNodePrototype(existing.id, (draft) => {
        if (addLabel) draft.labels = { ...(draft.labels || {}), formula: fields.labels.formula };
        if (addDescription) draft.description = fields.description;
      });
    }
    return useGraphStore.getState().nodePrototypes.get(existing.id) || existing;
  }
  const proto = {
    id: uuidv4(), color: NODE_DEFAULT_COLOR, description: '', typeNodeId: null, definitionGraphIds: [],
    ...fields, ...(link ? { externalLinks: [link] } : {}), semanticMetadata: metadataOf(origin, link),
  };
  useGraphStore.getState().addNodePrototype(proto);
  return proto;
}

/**
 * @param {string} text - e.g. "E = m * c^2"
 * @param {string} graphId - the web to build into
 * @param {{x: number, y: number}} at - canvas point for the middle of the formula
 * @param {object} [readOptions] - how the text is read: { convention, isKnownName } (see parseFormulaText)
 * @param {object} [equation] - what the equation is, when known:
 *   { title, description, origin, link, discipline, section, color, newColor, protoId,
 *     bindings: { symbol: { origin, link, name, label, description, color } | { protoId, label } | { name, label, description, color } } }
 *   (`link`: the web address the Thing is, recorded as an exact link;
 *   `color`: the equation's Thing's, when it is made new here, and a binding's its Thing's;
 *   `newColor`: () => the color for each other Thing made new here (webColors.js), the default without;
 *   `protoId`: a Thing the universe has already, to be the equation, or what a symbol stands for;
 *   `replaces`: that Thing's node in this web, which the formula takes the place of, connections and all;
 *   a binding with only a name: a new Thing by that name)
 * @returns {{ instanceIds: string[], groupId: string|null, equationProtoId: string|null, text: string }}
 * @throws {Error} when the text isn't a formula (message is short and user-facing)
 */
export function buildFormulaInWeb(text, graphId, at, readOptions, equation = {}) {
  const chain = chainFromText(text, readOptions);
  const store = useGraphStore.getState();
  if (!store.graphs.get(graphId)) throw new Error('No web to add it to');
  const bindings = equation.bindings || {};
  const title = equation.title?.trim() || '';
  let result = null;
  store.withHistoryTransaction(title ? `Added ${title}` : 'Added formula', () => {
    result = build(chain, graphId, at, bindings, title, equation);
  });
  // Drawn for the first time, it comes in the way a new Thing does.
  markFormulaSpawn(result?.groupId);
  return result;
}

// Build the formula's Things, parts and operations, centred on `at`: every instance inside it.
// `newColor`: the color for each term Thing and part made new here (webColors.js), else
// the default; without it a part is `partColor`, the equation's.
function buildTerms(chain, graphId, at, bindings, newColor = null, partColor = null) {
  const colorFor = (bound) => bound?.color || newColor?.() || NODE_DEFAULT_COLOR;
  // Prototypes by name: numbers, words, operations and types are reused.
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
      useGraphStore.getState().addNodePrototype(proto);
    } else if (description && !String(proto.description || '').trim()) {
      // Only ever added: a Thing that already says what it is keeps its own words.
      useGraphStore.getState().updateNodePrototype(proto.id, (draft) => { draft.description = description; });
    }
    protoByName.set(key, proto);
    return proto;
  };
  // What each operand stands for: the bound concept, a new bare symbol, or the Thing by that name.
  const bySymbol = new Map();
  const prototypeFor = (name) => {
    if (bySymbol.has(name)) return bySymbol.get(name);
    let proto;
    const bound = bindings[name];
    const own = bound?.protoId ? useGraphStore.getState().nodePrototypes.get(bound.protoId) : null;
    if (own) {
      // A Thing of the universe's own (the wizard's P for Pressure): only ever
      // added to, as a bank Thing is, given the formula label it lacks.
      if (!own.labels?.formula) {
        useGraphStore.getState().updateNodePrototype(own.id, (draft) => {
          draft.labels = { ...(draft.labels || {}), formula: bound.label || name };
        });
      }
      proto = useGraphStore.getState().nodePrototypes.get(own.id) || own;
    } else if (bound?.origin) {
      const fresh = !prototypeFrom(bound.origin, bound.link || null);
      proto = prototypeFromOrNew(bound.origin, {
        name: bound.name, description: bound.description || '', labels: { formula: bound.label || name },
        ...(fresh ? { color: colorFor(bound) } : {}),
      }, bound.link || null);
    } else if (bound?.name) {
      // A meaning with nothing to find it by: a new Thing named for what it is.
      proto = {
        id: uuidv4(), name: String(bound.name), color: colorFor(bound), description: bound.description || '',
        typeNodeId: null, definitionGraphIds: [], labels: { formula: bound.label || name },
      };
      useGraphStore.getState().addNodePrototype(proto);
    } else if (!isNumber(name) && isSymbolText(name)) {
      proto = { id: uuidv4(), name: String(name), color: colorFor(null), description: '', typeNodeId: null, definitionGraphIds: [] };
      useGraphStore.getState().addNodePrototype(proto);
    } else {
      proto = prototypeNamed(name);
    }
    bySymbol.set(name, proto);
    return proto;
  };
  // Things mode shows Things by name, so their room is their name's.
  const shownName = (name) => bindings[name]?.name || name;

  // Widths, inside out.
  const termWidth = (term) => {
    if (term.kind === 'thing') {
      term._w = getNodeDimensions({ name: shownName(term.name) }, false, null).currentWidth;
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
        const proto = prototypeFor(item.name);
        const id = uuidv4();
        const h = getNodeDimensions({ name: proto.name }, false, null).currentHeight;
        // Written here other than its Thing is (q₁ for Electric Charge, written q): this one's own label.
        const own = formulaLabelOf(useGraphStore.getState().nodePrototypes.get(proto.id) || proto) !== item.name;
        nodes.push({ instanceId: id, prototypeId: proto.id, x, y: at.y - h / 2, scale: 1, ...(own ? { labels: { formula: item.name } } : {}) });
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

  // A part the universe has already: the same Things under the same operations,
  // typed the same (the Jovanovic equations' exp(−(K_J × C_e)), both of the
  // same concepts). Its Thing and the definition it reads as, or null.
  const samePart = (part, typeNodeId) => {
    if (part.args.length !== 1) return null;
    const want = compositionOf(part.args[0], (term) => bySymbol.get(term.name)?.id);
    const state = useGraphStore.getState();
    let found = null;
    for (const p of state.nodePrototypes.values()) {
      if (p.isOrbitCatalog || p.name !== part.name || (p.typeNodeId || null) !== typeNodeId || !p.definitionGraphIds?.length) continue;
      const has = partCompositionOf(state, p);
      if (has?.composition === want) found = { proto: p, index: has.index }; // the last, as names resolve
    }
    return found;
  };

  const buildPart = (part, left) => {
    let x = left + PART_PAD;
    const ids = [];
    part.args.forEach((arg) => {
      ids.push(...buildChain(arg, x).inside);
      x += arg._w + ARG_GAP;
    });
    // The part's Thing: named after its term, typed by what is applied to it.
    let typeNodeId = null;
    if (part.apply && part.apply !== 'fn') {
      typeNodeId = prototypeNamed(OPERATORS[part.apply].name, OPERATOR_DESCRIPTIONS[part.apply]).id;
    } else if (part.apply === 'fn') {
      typeNodeId = prototypeNamed(part.fnName, FUNCTION_DESCRIPTIONS[part.fnName] || '').id;
    }
    // The same part again is the same Thing, with the same definition: not a copy of it.
    const same = samePart(part, typeNodeId);
    const st = useGraphStore.getState();
    const color = same?.proto.color || newColor?.() || partColor || NODE_DEFAULT_COLOR;
    const groupId = st.createGroup(graphId, { name: part.name, color, memberInstanceIds: ids });
    const thing = same?.proto || { id: uuidv4(), name: part.name, color, description: '', typeNodeId, definitionGraphIds: [] };
    if (!same) st.addNodePrototype(thing);
    st.convertGroupToNodeGroup(graphId, groupId, thing.id, false, '', undefined, same ? { useDefinitionIndex: same.index } : {});
    const anchorId = useGraphStore.getState().graphs.get(graphId)?.groups?.get(groupId)?.anchorInstanceId;
    if (!anchorId) throw new Error('Could not make a part of the formula');
    return { anchorId, ids: [...ids, anchorId] };
  };

  const { inside } = buildChain(chain, at.x - chain._w / 2);
  return { inside, text: chainText(chain) };
}

function build(chain, graphId, at, bindings, title, equation) {
  // The equation's own Thing, holding the whole formula, shown as the formula:
  // one the universe has already when named (the Ideal Gas Law it wrote down
  // before it had the formula), else the bank's, else a new one. Made new, it
  // takes the first of the web's colors (`newColor`), its terms the rest.
  const given = equation.protoId ? useGraphStore.getState().nodePrototypes.get(equation.protoId) : null;
  const before = given ? null : equation.origin ? prototypeFrom(equation.origin) : null;
  const color = given || before ? null : (equation.color || equation.newColor?.() || null);
  const { inside, text } = buildTerms(chain, graphId, at, bindings, equation.newColor, color || (given || before)?.color);

  const name = title || text;
  const equationProto = given || (equation.origin
    ? prototypeFromOrNew(equation.origin, { name, description: equation.description || '', ...(color ? { color } : {}) }, equation.link || null)
    : { id: uuidv4(), name, color: color || NODE_DEFAULT_COLOR, description: equation.description || '', typeNodeId: null, definitionGraphIds: [] });
  if (given && equation.description && !String(given.description || '').trim()) {
    useGraphStore.getState().updateNodePrototype(given.id, (draft) => { draft.description = equation.description; });
  }
  if (!given && !equation.origin) useGraphStore.getState().addNodePrototype(equationProto);
  const groupId = useGraphStore.getState().createGroup(graphId, {
    name, color: equationProto.color || NODE_DEFAULT_COLOR, memberInstanceIds: inside, format: 'formula',
  });
  // The same equation again is the same Thing with the same definition: its
  // first web, not a copy of it each time it is placed.
  const st = useGraphStore.getState();
  const known = before && (st.nodePrototypes.get(before.id)?.definitionGraphIds || []).findIndex(id => st.graphs.has(id));
  st.convertGroupToNodeGroup(graphId, groupId, equationProto.id, false, '', undefined,
    Number.isInteger(known) && known >= 0 ? { useDefinitionIndex: known } : {});
  const made = useGraphStore.getState().graphs.get(graphId)?.groups?.get(groupId);
  const linked = made?.linkedNodePrototypeId === equationProto.id;
  if (linked && given && equation.replaces) takePlaceOf(graphId, equation.replaces, made.anchorInstanceId);

  if (equation.discipline && linked) placeInDiscipline(equation.discipline, equation.section || null, equationProto.id);
  return { instanceIds: inside, groupId, equationProtoId: linked ? equationProto.id : null, text };
}

/**
 * The equation's Thing stood in the web as a plain node before it had its
 * formula (the wizard wrote "Hamilton's Model", then its equation): the
 * formula takes that node's place. Its connections now reach the whole
 * equation, and the node goes, so the Thing is in the web once.
 */
function takePlaceOf(graphId, oldId, anchorId) {
  const st = useGraphStore.getState();
  const graph = st.graphs.get(graphId);
  if (!anchorId || oldId === anchorId || !graph?.instances?.has(oldId)) return;
  for (const edgeId of graph.edgeIds || []) {
    const e = st.edges.get(edgeId);
    if (!e || (e.sourceId !== oldId && e.destinationId !== oldId)) continue;
    st.updateEdge(edgeId, (draft) => {
      if (draft.sourceId === oldId) draft.sourceId = anchorId;
      if (draft.destinationId === oldId) draft.destinationId = anchorId;
      const arrows = draft.directionality?.arrowsToward;
      if (arrows instanceof Set && arrows.has(oldId)) { arrows.delete(oldId); arrows.add(anchorId); }
      else if (Array.isArray(arrows) && arrows.includes(oldId)) draft.directionality.arrowsToward = arrows.map(x => (x === oldId ? anchorId : x));
    });
  }
  st.removeNodeInstance(graphId, oldId);
}

/**
 * Write a formula of the web over again, in place: the same equation (its
 * group, its Thing, every connection to the whole of it) holding new Things,
 * centred where the old ones were, its definition saved over. A connection
 * from outside to a term goes to the new term standing for the same Thing
 * (Pressure, still in it); to one the new formula no longer has, it goes with
 * that term. Untitled, the equation's name follows its text. One undo step.
 *
 * @param {object} [options] - { title, bindings, newColor } as buildFormulaInWeb's equation
 * @returns {{ groupId: string, equationProtoId: string|null, text: string }}
 * @throws {Error} when the text isn't a formula, or the group isn't one
 */
export function rewriteFormulaInWeb(graphId, groupId, text, readOptions, { title = '', bindings = {}, newColor = null } = {}) {
  const chain = chainFromText(text, readOptions);
  const store = useGraphStore.getState();
  const graph = store.graphs.get(graphId);
  const group = graph?.groups?.get(groupId);
  if (!group || group.format !== 'formula') throw new Error('No formula there to rewrite');
  const oldIds = new Set(group.memberInstanceIds || []);
  const equationProto = group.linkedNodePrototypeId ? store.nodePrototypes.get(group.linkedNodePrototypeId) : null;
  // Untitled (named for its text), it is named for its new text after.
  const compact = (t) => String(t || '').replace(/\s+/g, '');
  const before = readFormulaGroupText(store, graphId, group);
  const untitled = !!equationProto && before !== null && compact(before) === compact(equationProto.name);

  // Centred where its Things were.
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const id of oldIds) {
    const inst = graph.instances.get(id);
    if (!inst || inst.isGroupAnchor) continue;
    const dims = getNodeDimensions({ name: store.nodePrototypes.get(inst.prototypeId)?.name || '' }, false, null);
    minX = Math.min(minX, inst.x); minY = Math.min(minY, inst.y);
    maxX = Math.max(maxX, inst.x + dims.currentWidth); maxY = Math.max(maxY, inst.y + dims.currentHeight);
  }
  const at = Number.isFinite(minX) ? { x: (minX + maxX) / 2, y: (minY + maxY) / 2 } : { x: 0, y: 0 };

  // Its parentheses, and the connections reaching a term from outside.
  const parts = [...graph.groups.values()].filter(g => g.id !== groupId
    && g.memberInstanceIds?.length && g.memberInstanceIds.every(id => oldIds.has(id)));
  const reaching = [];
  for (const edgeId of graph.edgeIds || []) {
    const e = store.edges.get(edgeId);
    if (!e) continue;
    const a = oldIds.has(e.sourceId);
    const b = oldIds.has(e.destinationId);
    if (a !== b) reaching.push({ id: edgeId, end: a ? 'sourceId' : 'destinationId', protoId: graph.instances.get(a ? e.sourceId : e.destinationId)?.prototypeId });
  }

  let result = null;
  const label = equationProto?.name ? `Rewrote ${equationProto.name}` : 'Rewrote formula';
  store.withHistoryTransaction(label, () => {
    const { inside, text: newText } = buildTerms(chain, graphId, at, bindings, newColor, equationProto?.color || group.color);
    const st = useGraphStore.getState();
    // The new Things join the group before the old ones leave it, so it is never empty.
    st.addInstancesToGroup(graphId, groupId, inside);

    const newByProto = new Map();
    for (const id of inside) {
      const protoId = useGraphStore.getState().graphs.get(graphId)?.instances.get(id)?.prototypeId;
      if (protoId && !newByProto.has(protoId)) newByProto.set(protoId, id);
    }
    for (const { id, end, protoId } of reaching) {
      const to = newByProto.get(protoId);
      if (!to) continue;
      st.updateEdge(id, (draft) => {
        const from = draft[end];
        draft[end] = to;
        const arrows = draft.directionality?.arrowsToward;
        if (arrows instanceof Set && arrows.has(from)) { arrows.delete(from); arrows.add(to); }
        else if (Array.isArray(arrows) && arrows.includes(from)) draft.directionality.arrowsToward = arrows.map(x => (x === from ? to : x));
      });
    }

    for (const part of parts) {
      if (useGraphStore.getState().graphs.get(graphId)?.groups?.has(part.id)) st.deleteGroupAndContents(graphId, part.id);
    }
    const left = [...oldIds].filter(id => useGraphStore.getState().graphs.get(graphId)?.instances.has(id));
    if (left.length) st.removeMultipleNodeInstances(graphId, left);

    const name = title?.trim() || (untitled ? newText : '');
    if (name && equationProto) {
      st.updateNodePrototype(equationProto.id, (draft) => { draft.name = name; });
      st.updateGroup(graphId, groupId, (draft) => { draft.name = name; });
    }
    if (equationProto) st.updateDefinitionFromNodeGroup(graphId, groupId);
    result = { groupId, equationProtoId: equationProto?.id || null, text: newText };
  });
  markFormulaSpawn(groupId);
  return result;
}

/** The text a group read as in a state, or null. */
function readFormulaGroupText(state, graphId, group) {
  try {
    const view = projectGraphView(state, graphId);
    const chain = view && readFormulaGroup(state, view, view.groups?.get(group.id) || group);
    return chain ? chainText(chain) : null;
  } catch { return null; }
}

/**
 * Put the equation where it belongs: in its section's web (Thermodynamics),
 * the section in its discipline's (Physics); without a section, in the
 * discipline's. Each of those Things (made from the bank, found by where it
 * came from; a section is its Wikidata or MathModDB item) gets a web if it has none, and
 * what goes in it is placed unless it is there already. Nothing in them is
 * moved or changed.
 */
function placeInDiscipline(discipline, section, equationProtoId) {
  const { holderProtoId } = filing(discipline, section);
  placeIn(holderProtoId, equationProtoId);
}

/** The discipline's Thing, and the Thing an equation of it is filed under (its section's, or the discipline's). */
function filing(discipline, section) {
  const disciplineProto = prototypeFromOrNew(disciplineOrigin(discipline.id), {
    name: discipline.name, description: discipline.description || '',
  });
  if (!section) return { disciplineProtoId: disciplineProto.id, holderProtoId: disciplineProto.id };
  const sectionProto = prototypeFromOrNew(conceptOrigin(section.id), {
    name: section.name, description: section.description || '',
  }, itemIri(section.id));
  placeIn(disciplineProto.id, sectionProto.id);
  return { disciplineProtoId: disciplineProto.id, holderProtoId: sectionProto.id };
}

/** An entry's section, as its discipline names it. */
const sectionOf = (discipline, entry) => (entry.sectionId
  ? discipline.sections?.find(x => x.id === entry.sectionId) || { id: entry.sectionId, name: entry.section }
  : null);

/**
 * The Thing buildBankEquation would make this entry's equation of, if the
 * universe has it: found as the builder finds it, by where it came from or by
 * the item it is exactly linked to (an equation whose item is one of its own
 * concepts' is that concept's Thing).
 */
export const bankEquationThing = (entry) => prototypeFrom(equationOrigin(entry.id), entry.defines ? null : entry.source);

/**
 * Where the bank files an equation: its section's web, the section placed in
 * its discipline's (else the discipline's own web), each made if there is
 * none. The formula starter builds each equation there.
 * @returns {{ webId: string, disciplineProtoId: string }}
 */
export function bankHomeOf(discipline, entry) {
  const { disciplineProtoId, holderProtoId } = filing(discipline, sectionOf(discipline, entry));
  return { webId: webOf(holderProtoId), disciplineProtoId };
}

/** The Thing the formula starter places every discipline in, Formulas, and its web. */
export function formulaStarterRoot() {
  const proto = prototypeFromOrNew(STARTER_ORIGIN, {
    name: 'Formulas', description: 'Equations of every discipline, from Wikidata and MathModDB.',
  });
  return { protoId: proto.id, webId: webOf(proto.id) };
}

/** A Thing's first web, made if it has none. */
function webOf(protoId) {
  const st = useGraphStore.getState();
  const webId = (st.nodePrototypes.get(protoId)?.definitionGraphIds || []).find(id => st.graphs.has(id));
  return webId || st.createAndAssignGraphDefinitionWithoutActivation(protoId);
}

/** Place a Thing in another's web (made if it has none), unless it is there already. */
export function placeIn(holderProtoId, protoId) {
  const webId = webOf(holderProtoId);
  const web = useGraphStore.getState().graphs.get(webId);
  if (!web) return;
  const instances = [...(web.instances?.values() || [])];
  if (instances.some(inst => inst.prototypeId === protoId)) return;
  const n = instances.length;
  useGraphStore.getState().addNodeInstance(webId, protoId, {
    x: (n % DISCIPLINE_COLUMNS) * DISCIPLINE_CELL.w,
    y: Math.floor(n / DISCIPLINE_COLUMNS) * DISCIPLINE_CELL.h,
  });
}

/**
 * Build an equation from the bank, fully formed: its symbols bound to their
 * concepts, its title, its description, and its place in its discipline's
 * web. The bank must be loaded (loadFormulaBank) for its concepts. `color`:
 * the equation's Thing's, if it is new; `newColor`: as buildFormulaInWeb's.
 */
export function buildBankEquation(discipline, entry, graphId, at, { color = null, newColor = null } = {}) {
  const bindings = {};
  for (const [symbol, conceptId] of Object.entries(entry.symbols)) {
    const concept = bankConcept(conceptId);
    if (!concept) continue;
    bindings[symbol] = {
      origin: conceptOrigin(conceptId), link: concept.source, name: concept.name, label: concept.symbol, description: concept.description,
    };
  }
  return buildFormulaInWeb(entry.text, graphId, at, {
    convention: 'math',
    isKnownName: (n) => Object.prototype.hasOwnProperty.call(entry.symbols, n) || !!entry.placeHolders?.includes(n),
  }, {
    title: entry.title,
    description: entry.description || '',
    origin: equationOrigin(entry.id),
    // The item is the law itself (Ideal Gas Law), unless it is one of its own
    // concepts (capacitance, C = Q/V): then that concept's Thing holds the link.
    link: entry.defines ? null : entry.source,
    bindings,
    color,
    newColor,
    discipline,
    section: sectionOf(discipline, entry),
  });
}
