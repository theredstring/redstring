/**
 * Build a Redstring universe state from an import plan.
 *
 * The output has exactly the shape a loaded `.redstring` file deserializes to
 * (Maps of prototypes, graphs and edges; instance Maps inside graphs; Set
 * directionality), so it can go straight into `mergeUniverseState`, into
 * `mergeUniverses` in a test, or through `exportToRedstring` to become a pack
 * file. Nothing here touches a store.
 *
 * Every ID comes from the plan's derivation (UUID v5 of IRIs), so building the
 * same plan twice gives identical states, and merging one into a universe that
 * already holds it changes nothing.
 */

import { NODE_DEFAULT_COLOR } from '../../constants.js';
import { canonicalizeLink, LINK_STATES } from '../linkState.js';
import { importIds } from './plan.js';

const isHttpIri = (iri) => /^https?:\/\//i.test(String(iri || ''));

/** Same colour derivation the wizard uses for connection types, so imports look native. */
const connectionColor = (name) => {
  const s = String(name || '');
  let hash = 0;
  for (let i = 0; i < s.length; i++) hash = s.charCodeAt(i) + ((hash << 5) - hash);
  return `hsl(${Math.abs(hash) % 360}, 60%, 45%)`;
};

/** externalLinks + the exact-rung record for an IRI, when it's a web IRI. */
function identityFor(iri) {
  if (!isHttpIri(iri)) return { externalLinks: [], linkConfirmations: null };
  return {
    externalLinks: [iri],
    linkConfirmations: { [canonicalizeLink(iri)]: { state: LINK_STATES.EXACT, by: 'import' } },
  };
}

/** Lay instances out on a plain grid; the real layout runs once the web is in the store. */
function gridPosition(i) {
  return { x: (i % 8) * 260, y: Math.floor(i / 8) * 200 };
}

const WEB_DESCRIPTIONS = {
  composition: (name, from) => `The parts of ${name}, from ${from}.`,
  connections: (name, from) => `The connections of ${name}, from ${from}.`,
  kinds: (name, from) => `The kinds of ${name}, from ${from}.`,
};

function newWeb({ id, name, description, definingId }) {
  return {
    id,
    name,
    description,
    picture: null,
    color: NODE_DEFAULT_COLOR,
    directed: false,
    instances: new Map(),
    groups: new Map(),
    edgeIds: [],
    definingNodeIds: [definingId],
    panOffset: null,
    zoomLevel: null,
  };
}

function placeAll(web, thingIds) {
  thingIds.forEach((thingId, i) => {
    const id = importIds.instance(web.id, thingId);
    web.instances.set(id, { id, prototypeId: thingId, ...gridPosition(i), scale: 1 });
  });
}

/**
 * @param {Object} plan - from buildImportPlan()
 * @returns {Object} a universe state: { nodePrototypes, graphs, edges, edgePrototypes,
 *   openGraphIds, expandedGraphIds, savedNodeIds, savedGraphIds, activeGraphId, ... }
 */
export function buildUniverseState(plan) {
  const { source } = plan;
  const nodePrototypes = new Map();
  const graphs = new Map();
  const edges = new Map();
  const thingIdOf = new Map(plan.things.map((t) => [t.iri, t.id]));

  // The source Thing: the ontology itself, whose web is a declared folder.
  const sourceIdentity = identityFor(source.iri);
  nodePrototypes.set(source.id, {
    id: source.id,
    name: source.title,
    description: source.description || '',
    color: NODE_DEFAULT_COLOR,
    typeNodeId: null,
    definitionGraphIds: [source.folderWebId],
    externalLinks: sourceIdentity.externalLinks,
    semanticMetadata: {
      ...(sourceIdentity.linkConfirmations ? { linkConfirmations: sourceIdentity.linkConfirmations } : {}),
      origin: { label: source.title, href: source.homepage || (isHttpIri(source.iri) ? source.iri : null), isLocal: false },
      ontologySource: {
        iri: source.iri,
        versionIri: source.versionIri,
        version: source.version,
        license: source.license,
        homepage: source.homepage,
        date: source.date,
        format: source.format,
        fileName: source.fileName,
        roots: source.roots,
        ...(source.importedAt ? { importedAt: source.importedAt } : {}),
      },
    },
  });

  for (const thing of plan.things) {
    const identity = identityFor(thing.iri);
    const ontology = {
      iri: thing.iri,
      source: source.id,
      kind: thing.kind,
      ...(thing.label ? { label: thing.label } : {}),
      ...(thing.synonyms.length ? { synonyms: thing.synonyms } : {}),
      ...(thing.xrefs.length ? { xrefs: thing.xrefs } : {}),
      ...(thing.otherParents.length ? { otherParents: thing.otherParents } : {}),
      ...(thing.relations.length ? { relations: thing.relations } : {}),
      ...(thing.deprecated ? { deprecated: true } : {}),
      ...(thing.replacedBy ? { replacedBy: thing.replacedBy } : {}),
    };
    nodePrototypes.set(thing.id, {
      id: thing.id,
      name: thing.name,
      description: thing.description,
      color: NODE_DEFAULT_COLOR,
      typeNodeId: thing.typeIri ? thingIdOf.get(thing.typeIri) : null,
      definitionGraphIds: [thing.compositionWebId, thing.connectionsWebId, thing.kindsWebId].filter(Boolean),
      externalLinks: identity.externalLinks,
      ...(thing.equivalents.length ? { equivalentClasses: thing.equivalents } : {}),
      semanticMetadata: {
        ...(identity.linkConfirmations ? { linkConfirmations: identity.linkConfirmations } : {}),
        origin: { label: source.title, href: isHttpIri(thing.iri) ? thing.iri : null, isLocal: false },
        ontology,
      },
    });
  }

  for (const rel of plan.relationTypes) {
    const identity = identityFor(rel.iri);
    nodePrototypes.set(rel.id, {
      id: rel.id,
      name: rel.name,
      description: '',
      color: connectionColor(rel.name),
      typeNodeId: null,
      definitionGraphIds: [],
      externalLinks: identity.externalLinks,
      semanticMetadata: {
        ...(identity.linkConfirmations ? { linkConfirmations: identity.linkConfirmations } : {}),
        origin: { label: source.title, href: isHttpIri(rel.iri) ? rel.iri : null, isLocal: false },
        ontology: { iri: rel.iri, source: source.id, kind: 'relation' },
      },
    });
  }

  // The folder web: declared as a folder, holding the roots or top kinds.
  const folder = newWeb({
    id: source.folderWebId,
    name: source.title,
    description: `Folder: the kinds imported from ${source.title}.`,
    definingId: source.id,
  });
  placeAll(folder, source.folderMembers.map((iri) => thingIdOf.get(iri)).filter(Boolean));
  graphs.set(folder.id, folder);

  const relationById = new Map(plan.relationTypes.map((r) => [r.iri, r]));
  for (const plannedWeb of plan.webs) {
    const wholeId = thingIdOf.get(plannedWeb.whole);
    const wholeName = nodePrototypes.get(wholeId)?.name || 'Thing';
    const web = newWeb({
      id: plannedWeb.id,
      name: wholeName,
      description: WEB_DESCRIPTIONS[plannedWeb.kind](wholeName, source.title),
      definingId: wholeId,
    });
    const memberIds = plannedWeb.members.map((iri) => thingIdOf.get(iri)).filter(Boolean);
    placeAll(web, memberIds);

    for (const c of plannedWeb.connections) {
      const sourceInstance = importIds.instance(web.id, thingIdOf.get(c.source));
      const targetInstance = importIds.instance(web.id, thingIdOf.get(c.target));
      if (!web.instances.has(sourceInstance) || !web.instances.has(targetInstance)) continue;
      const rel = relationById.get(c.property);
      const edgeId = importIds.edge(web.id, c.source, c.property, c.target);
      edges.set(edgeId, {
        id: edgeId,
        sourceId: sourceInstance,
        destinationId: targetInstance,
        name: rel?.name || 'Connection',
        type: rel?.name || 'Connection',
        typeNodeId: 'base-connection-prototype',
        definitionNodeIds: rel ? [rel.id] : [],
        directionality: { arrowsToward: new Set([targetInstance]) },
      });
      web.edgeIds.push(edgeId);
    }
    graphs.set(web.id, web);
  }

  return {
    nodePrototypes,
    graphs,
    edges,
    edgePrototypes: new Map(),
    openGraphIds: [folder.id],
    expandedGraphIds: new Set([folder.id]),
    activeGraphId: folder.id,
    activeDefinitionNodeId: source.id,
    savedNodeIds: new Set([source.id]),
    savedGraphIds: new Set(),
    rightPanelTabs: [{ type: 'home', isActive: true }],
    mergeDismissals: {},
  };
}
