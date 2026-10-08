import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useDrag } from 'react-dnd';
import { getEmptyImage } from 'react-dnd-html5-backend';
import { Plus, Check, Link2, ChevronDown, RefreshCw, Loader2, ListPlus } from 'lucide-react';
import useGraphStore from '../../store/graphStore.js';
import useCanvasUIStore from '../../store/canvasUIStore.js';
import { useTheme } from '../../hooks/useTheme.js';
import useElementWidth from '../../hooks/useElementWidth.js';
import useSemanticConnections from '../../hooks/useSemanticConnections.js';
import useActiveGraphStructureKey from '../../hooks/useActiveGraphStructureKey.js';
import PanelIconButton from '../shared/PanelIconButton.jsx';
import ConfirmDialog from '../shared/ConfirmDialog.jsx';
import TripletPreview from './TripletPreview.jsx';
import CompactConnectionRow, { COMPACT_CONNECTIONS_BELOW } from './CompactConnectionRow.jsx';
import TypeStatementDialog, { isTypeStatement } from './TypeStatementDialog.jsx';
import {
  conceptUris, findPrototypeForConcept, anchorInstanceFor, placeConcept, placeStatement, placeConnections, revealInstances, existingInstanceFor,
  ensureConceptPrototype
} from '../../services/semanticPlacement.js';
import { THING_PROTOTYPE_ID } from '../../wizard/tools/utils/abstractionSpec.js';
import { haptic } from '../../services/haptics.js';

const PAGE = 20;
const ACTION_COLUMN = 40;
const lower = (s) => (typeof s === 'string' ? s.trim().toLowerCase() : '');

const SOURCE_NAMES = { wikidata: 'Wikidata', dbpedia: 'DBpedia' };

/**
 * A row as a drag: the universal dragged node, wearing whichever end lands
 * under the pointer (`begin` decides as the drag starts). Let go on the canvas,
 * `onDropAt` gets the canvas point; anywhere else that takes a Thing (a Web in
 * the list, the Wizard), the end it wears is what's dropped.
 */
const DraggableStatement = ({ begin, onDropAt, disabled, style, children, ...rest }) => {
  const [{ isDragging }, drag, preview] = useDrag(() => ({
    type: 'spawnable_node',
    item: begin,
    canDrag: () => !disabled,
    end: (item, monitor) => {
      const result = monitor.getDropResult();
      if (result?.canvasPoint) onDropAt(result.canvasPoint);
    },
    collect: (monitor) => ({ isDragging: !!monitor.isDragging() })
  }), [begin, onDropAt, disabled]);

  useEffect(() => {
    preview(getEmptyImage(), { captureDraggingState: true });
  }, [preview]);

  return (
    <div ref={drag} style={{ ...style, opacity: isDragging ? 0.5 : 1 }} {...rest}>
      {children}
    </div>
  );
};

/**
 * What the semantic web says about a Thing, as connections you can bring in.
 *
 * Each row is the statement drawn as the canvas would draw it. When the Thing
 * is in the open Web, a row's + adds the other end beside it — with room for
 * the connection's label, clear of what's there where it can be — joined by
 * that connection, the same add the orbit does. When the other end is already
 * in the Web the row links to it instead (a link icon, not a +). When the
 * Thing isn't in the Web, the + brings it in with the connection: beside the
 * other end when that's here, otherwise both, in open space. A row the Web
 * already says shows a check, which takes you to it. A row dragged onto the
 * canvas does the same, the end being placed landing where it's let go. "Add all" brings in every
 * connection the list holds (or every one the filter matches) at once, after
 * saying how many. An outgoing "instance of" or "subclass of" asks first
 * whether its other end becomes the Thing's type, the connection, or both.
 *
 * @param {Object} props
 * @param {Object} props.seed - a prototype or a discovered concept
 * @param {string} [props.seedPrototypeId] - the prototype standing for it here, if known
 * @param {string} [props.seedColor]
 * @param {(concept: Object) => void} [props.onOpen] - called with the other end when a row is clicked
 * @param {boolean} [props.offerAddSeed=true] - offer to place the seed itself when it isn't in the Web
 */
const SemanticConnectionList = ({ seed, seedPrototypeId = null, seedColor, onOpen, offerAddSeed = true }) => {
  const theme = useTheme();
  const [containerRef, width] = useElementWidth(320);
  const [shown, setShown] = useState(PAGE);
  const [filter, setFilter] = useState('');
  const [hoveredId, setHoveredId] = useState(null);
  // The "add all" being asked about: { statements, added, linked }.
  const [bulk, setBulk] = useState(null);
  // The "instance of" / "subclass of" row being asked about, with what the dialog states.
  const [typeAsk, setTypeAsk] = useState(null);

  const activeGraphId = useGraphStore((s) => s.activeGraphId);
  // What's in the Web, not where it sits: a drag must not redraw every row.
  const structureKey = useActiveGraphStructureKey();
  const graphs = useGraphStore.getState().graphs;
  const edges = useGraphStore((s) => s.edges);
  const nodePrototypes = useGraphStore((s) => s.nodePrototypes);
  const selectedInstanceIds = useCanvasUIStore((s) => s.selectedInstanceIds);

  const { status, identity, connections, retry } = useSemanticConnections(seed);

  const seedName = seed?.name || '';
  const seedProtoId = seedPrototypeId || findPrototypeForConcept(seed, nodePrototypes)?.id || null;
  const color = seedColor || seed?.color || theme.accent.primary;
  const graph = activeGraphId ? graphs.get(activeGraphId) : null;
  const anchor = useMemo(() => (graph && seedProtoId
    ? anchorInstanceFor(activeGraphId, seedProtoId, selectedInstanceIds, { graphs })
    : null
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ), [structureKey, seedProtoId, selectedInstanceIds]);

  // URI → prototype, so each row's other end is found in the universe once.
  const protoByUri = useMemo(() => {
    const index = new Map();
    nodePrototypes.forEach((proto) => conceptUris(proto).forEach((u) => index.set(u, proto)));
    return index;
  }, [nodePrototypes]);

  const protoFor = (concept) => {
    for (const u of conceptUris(concept)) {
      const hit = protoByUri.get(u);
      if (hit) return hit;
    }
    return null;
  };

  // The connections this Web already draws at the anchor, for the checks.
  const atAnchor = useMemo(() => {
    if (!graph || !anchor) return [];
    return (graph.edgeIds || []).map((eid) => edges.get(eid)).filter(Boolean)
      .filter((e) => e.sourceId === anchor.id || e.destinationId === anchor.id)
      .map((e) => {
        const otherId = e.sourceId === anchor.id ? e.destinationId : e.sourceId;
        const inst = graph.instances?.get(otherId);
        return {
          otherId,
          protoId: inst?.prototypeId,
          name: lower(nodePrototypes.get(inst?.prototypeId)?.name),
          label: lower(e.name || e.label || e.type)
        };
      });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [structureKey, anchor, edges, nodePrototypes]);

  const presentAs = (c) => {
    const proto = protoFor(c.other);
    const label = lower(c.predicate);
    const hit = atAnchor.find((a) => a.label === label && ((proto && a.protoId === proto.id) || a.name === lower(c.other.name)));
    return hit ? hit.otherId : null;
  };

  const visible = useMemo(() => {
    const q = lower(filter);
    if (!q) return connections;
    return connections.filter((c) => lower(c.predicate).includes(q) || lower(c.other.name).includes(q));
  }, [connections, filter]);

  const provenanceOf = (c) => ({
    source: c.provider,
    uri: c.other.semanticMetadata?.originalUri || null,
    predicate: c.predicateUri || c.predicate,
    retrieved_at: new Date().toISOString()
  });

  // `at`: the canvas point a drag let go at.
  const add = (c, at = null) => {
    if (!activeGraphId) return null;
    haptic('nodeSpawn', { force: true });
    return placeStatement({
      graphId: activeGraphId,
      seed,
      seedPrototypeId: seedProtoId,
      concept: c.other,
      predicate: c.predicate,
      direction: c.direction,
      provenance: provenanceOf(c),
      anchorInstanceId: anchor?.id || null,
      at
    });
  };

  // A row's +, link or drop. A statement of what the seed is asks first, unless
  // its other end is already the seed's type and only the connection is left to add.
  const onAdd = (c, at = null) => {
    const seedProto = seedProtoId ? nodePrototypes.get(seedProtoId) : null;
    const typeProto = protoFor(c.other);
    if (!seedProto || !isTypeStatement(c) || (typeProto && seedProto.typeNodeId === typeProto.id)) {
      add(c, at);
      return;
    }
    // The type may not loop back: the other end can't already be a kind of the seed.
    let typeBlocked = false;
    for (let id = typeProto?.id, seen = new Set(); id && !seen.has(id); id = nodePrototypes.get(id)?.typeNodeId) {
      if (id === seedProto.id) { typeBlocked = true; break; }
      seen.add(id);
    }
    const currentType = seedProto.typeNodeId && seedProto.typeNodeId !== THING_PROTOTYPE_ID
      ? nodePrototypes.get(seedProto.typeNodeId)
      : null;
    setTypeAsk({
      c,
      at,
      currentTypeName: currentType?.name || null,
      typeBlocked
    });
  };

  const applyTypeChoice = (choice) => {
    const c = typeAsk?.c;
    if (!c || !seedProtoId) return;
    const st = useGraphStore.getState();
    const run = () => {
      // The type is the Thing the connection reached, when there is one.
      const placed = choice !== 'type' ? add(c, typeAsk.at) : null;
      if (choice === 'web') return;
      if (choice === 'type') haptic('nodeSpawn', { force: true });
      st.setNodeType(seedProtoId, placed?.prototypeId || ensureConceptPrototype(c.other));
      // Only the type: the Thing typed comes in alone (where it was dropped),
      // without the statement's other end, when it isn't here already.
      if (choice === 'type' && activeGraphId && !anchorInstanceFor(activeGraphId, seedProtoId)) {
        placeConcept({ graphId: activeGraphId, concept: seed, prototypeId: seedProtoId, mode: 'open', at: typeAsk.at });
      }
    };
    const label = choice === 'web' ? `Added ${c.other.name}` : `Made ${c.other.name} the type of ${seedName}`;
    if (typeof st.withHistoryTransaction === 'function') st.withHistoryTransaction(label, run);
    else run();
  };

  // Everything the list holds that the Web doesn't say yet, counted into new
  // Things and links to ones already here, for the dialog to state.
  const askAddAll = () => {
    if (!activeGraphId || !anchor) return;
    const state = { graphs, nodePrototypes };
    const pending = visible.filter((c) => !presentAs(c));
    if (pending.length === 0) return;
    // A Thing reached by two connections is made once; the second one links to it.
    const seen = new Set();
    let added = 0;
    pending.forEach((c) => {
      const keys = [...conceptUris(c.other), `name:${lower(c.other.name)}`];
      const here = keys.some((k) => seen.has(k)) || existingInstanceFor(activeGraphId, c.other, anchor.id, state);
      keys.forEach((k) => seen.add(k));
      if (!here) added += 1;
    });
    setBulk({ pending, added, linked: pending.length - added });
  };

  const addAll = () => {
    if (!bulk || !activeGraphId || !anchor) return;
    haptic('nodeSpawn', { force: true });
    placeConnections({
      graphId: activeGraphId,
      anchorInstanceId: anchor.id,
      statements: bulk.pending.map((c) => ({
        concept: c.other,
        predicate: c.predicate,
        direction: c.direction,
        provenance: provenanceOf(c)
      })),
      label: `Added ${bulk.pending.length} connections of ${seedName}`
    });
  };

  // The end a row's drag wears: the one the drop places. With the seed here,
  // the other end; with only the other end here, the seed; with neither, the
  // seed, which lands at the drop with the other end beside it.
  const dragItemFor = (c) => () => {
    const st = useGraphStore.getState();
    const seedHere = !!(activeGraphId && seedProtoId && anchorInstanceFor(activeGraphId, seedProtoId, null, st));
    const end = seedHere ? c.other : seed;
    const endProtoId = seedHere ? findPrototypeForConcept(c.other, st.nodePrototypes)?.id : seedProtoId;
    return {
      semanticStatement: true,
      prototypeId: endProtoId || null,
      nodeName: end.name,
      nodeColor: end.color,
      ...(endProtoId ? {} : { needsMaterialization: true, conceptData: end })
    };
  };

  const addSeed = () => {
    if (!activeGraphId) return;
    haptic('nodeSpawn', { force: true });
    placeConcept({ graphId: activeGraphId, concept: seed, prototypeId: seedProtoId, mode: 'open' });
  };

  const small = { fontSize: '12px', fontFamily: "'EmOne', sans-serif", color: theme.canvas.textSecondary, lineHeight: 1.4 };
  const sources = [...new Set(connections.map((c) => SOURCE_NAMES[c.provider] || c.provider))].join(' · ');
  const tripletWidth = Math.max(160, width - ACTION_COLUMN - 8);
  // Whether the seed is here for rows to hang off; without it, a row brings it in too.
  const canAdd = !!anchor;
  // Below this a triplet's names truncate to a few letters; rows go compact.
  const compact = width > 0 && width < COMPACT_CONNECTIONS_BELOW;
  // Offered once the list has settled, so "all" means all of it.
  const remaining = canAdd && status === 'ready' ? visible.filter((c) => !presentAs(c)).length : 0;
  const filtering = !!lower(filter);

  return (
    <div ref={containerRef} style={{ width: '100%' }}>
      {/* The seed isn't here: adding a row brings it in, or it can come alone. */}
      {!canAdd && connections.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: '10px', marginBottom: '14px' }}>
          <span style={small}>
            {activeGraphId
              ? `${seedName} isn't in this web yet. Adding a connection brings it in too.`
              : 'Open a web to bring these connections in.'}
          </span>
          {activeGraphId && offerAddSeed && (
            <PanelIconButton
              icon={Plus}
              size={14}
              label={(
                // A long name truncates rather than stretching the pill past the panel.
                <span style={{ display: 'block', maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  Add {seedName}
                </span>
              )}
              labelFontSize={12}
              variant="outline"
              onClick={addSeed}
              title={`Add ${seedName} to this web, in open space`}
              // Room for the hover ring at the panel's edge, and never wider than the column.
              style={{ marginLeft: '3px', maxWidth: 'calc(100% - 6px)', minWidth: 0 }}
            />
          )}
        </div>
      )}

      {remaining > 1 && (
        <div style={{ marginBottom: '10px' }}>
          <PanelIconButton
            icon={ListPlus}
            size={14}
            label={filtering ? `Add ${remaining} matching` : `Add all ${remaining}`}
            labelFontSize={12}
            variant="outline"
            onClick={askAddAll}
            title={filtering
              ? `Add the ${remaining} connections matching "${filter.trim()}"`
              : `Add all ${remaining} connections of ${seedName} to this web`}
            // Room for the hover ring at the panel's edge.
            style={{ marginLeft: '3px' }}
          />
        </div>
      )}

      {connections.length > 12 && (
        <input
          type="text"
          value={filter}
          onChange={(e) => { setFilter(e.target.value); setShown(PAGE); }}
          placeholder="Filter connections"
          style={{
            width: '100%',
            boxSizing: 'border-box',
            padding: '7px 14px',
            marginBottom: '10px',
            border: `1px solid ${theme.canvas.border}`,
            borderRadius: '20px',
            fontSize: '12px',
            fontFamily: "'EmOne', sans-serif",
            background: 'transparent',
            color: theme.canvas.textPrimary,
            outline: 'none'
          }}
        />
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
        {visible.slice(0, shown).map((c) => {
          const otherProto = protoFor(c.other);
          const otherColor = otherProto?.color || c.other.color;
          const presentId = canAdd ? presentAs(c) : null;
          const isOut = c.direction === 'out';
          return (
            <div
              key={c.id}
              style={{ display: 'flex', alignItems: 'center', gap: '4px' }}
              onMouseEnter={() => setHoveredId(c.id)}
              onMouseLeave={() => setHoveredId((id) => (id === c.id ? null : id))}
            >
              <DraggableStatement
                begin={dragItemFor(c)}
                onDropAt={(at) => onAdd(c, at)}
                disabled={!activeGraphId || !!presentId}
                data-semantic-row={c.other.name}
                onClick={onOpen ? () => onOpen(c.other) : undefined}
                title={c.other.description ? `${c.other.name}: ${c.other.description}` : `${c.subject} → ${c.predicate} → ${c.object}`}
                style={{
                  flex: 1,
                  minWidth: 0,
                  padding: '4px',
                  borderRadius: '10px',
                  cursor: onOpen ? 'pointer' : activeGraphId && !presentId ? 'grab' : 'default',
                  background: onOpen && hoveredId === c.id ? theme.canvas.hover : 'transparent',
                  transition: 'background-color 0.15s ease'
                }}
              >
                {compact ? (
                  <CompactConnectionRow
                    predicate={c.predicate}
                    direction={c.direction}
                    otherName={c.other.name}
                    otherColor={otherColor}
                  />
                ) : (
                  <TripletPreview
                    subject={c.subject}
                    predicate={c.predicate}
                    object={c.object}
                    subjectColor={isOut ? color : otherColor}
                    objectColor={isOut ? otherColor : color}
                    connectionColor={color}
                    containerWidth={tripletWidth}
                  />
                )}
              </DraggableStatement>
              <div style={{ width: `${ACTION_COLUMN}px`, display: 'flex', justifyContent: 'center', flexShrink: 0 }}>
                {presentId ? (
                  <PanelIconButton
                    icon={Check}
                    size={16}
                    onClick={() => revealInstances(activeGraphId, [anchor.id, presentId], { force: true })}
                    title="Already in this web. Show it"
                  />
                ) : canAdd && existingInstanceFor(activeGraphId, c.other, anchor.id, { graphs, nodePrototypes }) ? (
                  <PanelIconButton
                    icon={Link2}
                    size={17}
                    onClick={() => onAdd(c)}
                    title={`Connect to ${c.other.name}, already in this web, by "${c.predicate}"`}
                  />
                ) : activeGraphId ? (
                  <PanelIconButton
                    icon={Plus}
                    size={18}
                    onClick={() => onAdd(c)}
                    title={canAdd
                      ? `Add ${c.other.name} beside ${seedName}, connected by "${c.predicate}"`
                      : `Add ${seedName} and its connection to ${c.other.name}, "${c.predicate}"`}
                  />
                ) : null}
              </div>
            </div>
          );
        })}
      </div>

      {visible.length > shown && (
        <div style={{ display: 'flex', justifyContent: 'center', marginTop: '10px' }}>
          <PanelIconButton
            icon={ChevronDown}
            size={14}
            label={`Show More (${visible.length - shown})`}
            labelPosition="left"
            labelFontSize={11}
            variant="outline"
            onClick={() => setShown((n) => n + PAGE)}
          />
        </div>
      )}

      {/* Status: what's happening, or why there's nothing. */}
      <div style={{ ...small, display: 'flex', alignItems: 'center', gap: '8px', marginTop: connections.length ? '10px' : 0, flexWrap: 'wrap' }}>
        {status === 'loading' && (
          <>
            <span className="rs-spin" style={{ display: 'inline-flex', flexShrink: 0 }}><Loader2 size={13} /></span>
            <span>{connections.length ? 'Still asking…' : 'Asking Wikidata and DBpedia…'}</span>
          </>
        )}
        {status === 'ready' && connections.length > 0 && (
          <span>{connections.length} connection{connections.length === 1 ? '' : 's'} from {sources}</span>
        )}
        {status === 'ready' && connections.length === 0 && (
          <span>Nothing on the semantic web connects to {seedName} yet.</span>
        )}
        {status === 'unresolved' && (
          <span>
            {`Couldn't tell which ${seedName || 'Thing'} this is on the semantic web.`}
            {seed?.id && !seed?.semanticMetadata?.isSemanticNode ? ' Linking it to a Wikipedia or Wikidata entry in About settles it.' : ''}
          </span>
        )}
        {status === 'error' && (
          <>
            <span>{"The semantic web didn't answer."}</span>
            <PanelIconButton icon={RefreshCw} size={13} label="Retry" labelFontSize={11} variant="outline" onClick={retry} />
          </>
        )}
        {identity?.qid && status !== 'loading' && connections.length > 0 && (
          <a
            href={`https://www.wikidata.org/wiki/${identity.qid}`}
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: theme.canvas.textSecondary }}
          >
            {identity.qid}
          </a>
        )}
      </div>

      {/* On the body: a panel can sit in a transformed box, which would pin a
          fixed dialog to the panel instead of the window. */}
      {bulk && createPortal(
        <ConfirmDialog
          isOpen
          onClose={() => setBulk(null)}
          onConfirm={addAll}
          title={`Add ${bulk.pending.length} connections?`}
          message={[
            bulk.added > 0 && `${bulk.added} new Thing${bulk.added === 1 ? '' : 's'} will be placed around ${seedName}`,
            bulk.linked > 0 && `${bulk.added > 0 ? 'and ' : ''}${bulk.linked} more connection${bulk.linked === 1 ? '' : 's'} drawn to Things already here`
          ].filter(Boolean).join(', ') + '.'}
          details="One undo takes them all back out."
          confirmLabel={`Add ${bulk.pending.length}`}
          variant="info"
        />,
        document.body
      )}
      {typeAsk && createPortal(
        <TypeStatementDialog
          seedName={seedName}
          typeName={typeAsk.c.other.name}
          predicate={typeAsk.c.predicate}
          currentTypeName={typeAsk.currentTypeName}
          typeBlocked={typeAsk.typeBlocked}
          onChoose={applyTypeChoice}
          onClose={() => setTypeAsk(null)}
        />,
        document.body
      )}
    </div>
  );
};

export default SemanticConnectionList;
