import React, { useMemo, useState } from 'react';
import { Plus, Check, Link2, ChevronDown, RefreshCw, Loader2 } from 'lucide-react';
import useGraphStore from '../../store/graphStore.js';
import useCanvasUIStore from '../../store/canvasUIStore.js';
import { useTheme } from '../../hooks/useTheme.js';
import useElementWidth from '../../hooks/useElementWidth.js';
import useSemanticConnections from '../../hooks/useSemanticConnections.js';
import useActiveGraphStructureKey from '../../hooks/useActiveGraphStructureKey.js';
import PanelIconButton from '../shared/PanelIconButton.jsx';
import TripletPreview from './TripletPreview.jsx';
import CompactConnectionRow, { COMPACT_CONNECTIONS_BELOW } from './CompactConnectionRow.jsx';
import { conceptUris, findPrototypeForConcept, anchorInstanceFor, placeConcept, revealInstances, existingInstanceFor } from '../../services/semanticPlacement.js';
import { haptic } from '../../services/haptics.js';

const PAGE = 20;
const ACTION_COLUMN = 40;
const lower = (s) => (typeof s === 'string' ? s.trim().toLowerCase() : '');

const SOURCE_NAMES = { wikidata: 'Wikidata', dbpedia: 'DBpedia' };

/**
 * What the semantic web says about a Thing, as connections you can bring in.
 *
 * Each row is the statement drawn as the canvas would draw it. When the Thing
 * is in the open Web, a row's + adds the other end beside it — with room for
 * the connection's label, clear of what's there where it can be — joined by
 * that connection, the same add the orbit does. When the other end is already
 * in the Web the row links to it instead (a link icon, not a +). A row the Web
 * already says shows a check, which takes you to it.
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

  const add = (c) => {
    if (!activeGraphId || !anchor) return;
    haptic('nodeSpawn', { force: true });
    placeConcept({
      graphId: activeGraphId,
      concept: c.other,
      anchorInstanceId: anchor.id,
      predicate: c.predicate,
      direction: c.direction,
      provenance: {
        source: c.provider,
        uri: c.other.semanticMetadata?.originalUri || null,
        predicate: c.predicateUri || c.predicate,
        retrieved_at: new Date().toISOString()
      }
    });
  };

  const addSeed = () => {
    if (!activeGraphId) return;
    haptic('nodeSpawn', { force: true });
    placeConcept({ graphId: activeGraphId, concept: seed, prototypeId: seedProtoId, mode: 'open' });
  };

  const small = { fontSize: '12px', fontFamily: "'EmOne', sans-serif", color: theme.canvas.textSecondary, lineHeight: 1.4 };
  const sources = [...new Set(connections.map((c) => SOURCE_NAMES[c.provider] || c.provider))].join(' · ');
  const tripletWidth = Math.max(160, width - ACTION_COLUMN - 8);
  const canAdd = !!anchor;
  // Below this a triplet's names truncate to a few letters; rows go compact.
  const compact = width > 0 && width < COMPACT_CONNECTIONS_BELOW;

  return (
    <div ref={containerRef} style={{ width: '100%' }}>
      {/* Why the rows can't be added yet, and the way to fix it, beneath. */}
      {!canAdd && connections.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: '10px', marginBottom: '14px' }}>
          <span style={small}>
            {activeGraphId
              ? `${seedName} isn't in this web yet. Add it to bring its connections in.`
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
              <div
                data-semantic-row={c.other.name}
                onClick={onOpen ? () => onOpen(c.other) : undefined}
                title={c.other.description ? `${c.other.name}: ${c.other.description}` : `${c.subject} → ${c.predicate} → ${c.object}`}
                style={{
                  flex: 1,
                  minWidth: 0,
                  padding: '4px',
                  borderRadius: '10px',
                  cursor: onOpen ? 'pointer' : 'default',
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
              </div>
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
                    onClick={() => add(c)}
                    title={`Connect to ${c.other.name}, already in this web, by "${c.predicate}"`}
                  />
                ) : canAdd ? (
                  <PanelIconButton
                    icon={Plus}
                    size={18}
                    onClick={() => add(c)}
                    title={`Add ${c.other.name} beside ${seedName}, connected by "${c.predicate}"`}
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
            label={`Show more (${visible.length - shown})`}
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
    </div>
  );
};

export default SemanticConnectionList;
