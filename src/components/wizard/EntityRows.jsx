import { useEffect, useMemo, useRef, useState } from 'react';
import { NotebookText, ArrowUpFromDot } from 'lucide-react';
import UniversalNodeRenderer from '../../UniversalNodeRenderer';
import TripletPreview from '../connections/TripletPreview.jsx';
import PanelIconButton from '../shared/PanelIconButton.jsx';
import useGraphStore from '../../store/graphStore.js';
import useMobileDetection from '../../hooks/useMobileDetection';
import { layoutNodeChips, panelListTextFor } from '../../utils/connectionPreview.js';
import { NODE_DEFAULT_COLOR } from '../../constants.js';
import {
  connectionThingId,
  webThingId,
  openThingInPanel,
  openWebInPanel,
  openThingAsWeb,
  openWebOnCanvas
} from './entityActions.js';

/**
 * A Thing, Web or Connection drawn the way the control panel draws it, with the
 * type row's two buttons beside it: open in the panel, open as a web.
 */

/** Room the two buttons take beside a row's drawing. */
const ACTIONS_WIDTH = 74;
/** Rows a card shows before "Show N more". */
const ROWS_COLLAPSED = 4;

/** One node chip, the control panel's node preview at the panel-list text size. */
export const ThingChip = ({ id, name, color, definitionGraphIds, maxWidth }) => {
  const { isMobile } = useMobileDetection();
  const padding = 4;
  const grid = useMemo(() => layoutNodeChips({
    nodes: [{ id: id || 'thing', name: name || 'Thing', color: color || NODE_DEFAULT_COLOR, definitionGraphIds: definitionGraphIds || [] }],
    text: panelListTextFor(isMobile),
    maxRowWidth: maxWidth,
    padding,
    maxChipWidth: maxWidth
  }), [id, name, color, definitionGraphIds, maxWidth, isMobile]);
  return (
    <UniversalNodeRenderer
      nodes={grid.nodes}
      connections={[]}
      containerWidth={grid.containerWidth}
      containerHeight={grid.containerHeight}
      padding={padding}
      ignoreGlobalScale={true}
      interactive={false}
    />
  );
};

/** The two buttons, spaced as the type row spaces them. */
export const EntityActions = ({ name, onOpenInPanel, onOpenWeb, webOpen = false }) => (
  <div className="entity-row-actions">
    <PanelIconButton
      icon={NotebookText}
      onClick={onOpenInPanel}
      disabled={!onOpenInPanel}
      title={onOpenInPanel ? `Open ${name} in panel` : 'Nothing to open'}
    />
    <PanelIconButton
      icon={ArrowUpFromDot}
      onClick={webOpen ? undefined : onOpenWeb}
      disabled={webOpen || !onOpenWeb}
      title={webOpen ? `${name}'s Web is open` : onOpenWeb ? `Open ${name} as a Web` : 'Nothing to open'}
    />
  </div>
);

const arrowEndsOf = (edge) => {
  const ends = new Set();
  const toward = edge?.directionality?.arrowsToward;
  const has = (id) => (toward instanceof Set ? toward.has(id) : Array.isArray(toward) ? toward.includes(id) : false);
  if (has(edge?.sourceId)) ends.add('subject');
  if (has(edge?.destinationId)) ends.add('object');
  return ends;
};

/**
 * Resolve a `created` record against the live store into rows. Anything since
 * deleted, or undone, is simply absent.
 */
function resolveRows(created, state) {
  const { graphs, nodePrototypes, edges, activeGraphId } = state;
  const rows = [];

  for (const graphId of created?.webs || []) {
    const graph = graphs.get(graphId);
    if (!graph) continue;
    const thingId = webThingId(graph, nodePrototypes);
    const thing = thingId ? nodePrototypes.get(thingId) : null;
    rows.push({
      kind: 'web',
      key: `w:${graphId}`,
      id: graphId,
      name: graph.name || thing?.name || 'Web',
      color: thing?.color || graph.color || NODE_DEFAULT_COLOR,
      definitionGraphIds: [graphId],
      webOpen: graphId === activeGraphId
    });
  }

  for (const thingId of created?.things || []) {
    const thing = nodePrototypes.get(thingId);
    if (!thing) continue;
    const defs = Array.isArray(thing.definitionGraphIds) ? thing.definitionGraphIds : [];
    rows.push({
      kind: 'thing',
      key: `t:${thingId}`,
      id: thingId,
      name: thing.name || 'Thing',
      color: thing.color || NODE_DEFAULT_COLOR,
      definitionGraphIds: defs,
      webOpen: !!defs[0] && defs[0] === activeGraphId
    });
  }

  for (const entry of created?.connections || []) {
    const edgeId = typeof entry === 'string' ? entry : entry?.id;
    const edge = edgeId ? edges.get(edgeId) : null;
    if (!edge) continue;
    const graph = entry?.graphId ? graphs.get(entry.graphId) : null;
    const instanceOf = (instanceId) => {
      const inst = graph?.instances?.get?.(instanceId);
      return inst ? nodePrototypes.get(inst.prototypeId) || null : null;
    };
    const subject = instanceOf(edge.sourceId);
    const object = instanceOf(edge.destinationId);
    if (!subject || !object) continue;
    const typeId = connectionThingId(edge);
    const type = typeId ? nodePrototypes.get(typeId) : null;
    const typeDefs = Array.isArray(type?.definitionGraphIds) ? type.definitionGraphIds : [];
    rows.push({
      kind: 'connection',
      key: `c:${edgeId}`,
      id: edgeId,
      typeId: type ? typeId : null,
      name: type?.name || edge.name || 'Connection',
      subject: subject.name || 'Thing',
      object: object.name || 'Thing',
      subjectColor: subject.color || NODE_DEFAULT_COLOR,
      objectColor: object.color || NODE_DEFAULT_COLOR,
      connectionColor: type?.color || edge.color || subject.color,
      arrowsToward: arrowEndsOf(edge),
      webOpen: !!typeDefs[0] && typeDefs[0] === activeGraphId
    });
  }
  return rows;
}

// Everything a row draws, as one string, so a card re-renders when one of its
// own entities changes and not on every write to the store (a drag writes
// every frame).
const rowsSignature = (rows) => rows.map(r => [
  r.key, r.name, r.color, r.webOpen ? 1 : 0, r.subject, r.object, r.subjectColor, r.objectColor,
  r.connectionColor, r.arrowsToward ? Array.from(r.arrowsToward).join('+') : '', r.typeId
].join('|')).join('\n');

const EntityRow = ({ row, width }) => {
  const repWidth = Math.max(140, width - ACTIONS_WIDTH);
  if (row.kind === 'connection') {
    return (
      <div className="entity-row">
        <div className="entity-row-rep">
          <TripletPreview
            subject={row.subject}
            predicate={row.name}
            object={row.object}
            subjectColor={row.subjectColor}
            objectColor={row.objectColor}
            connectionColor={row.connectionColor}
            arrowsToward={row.arrowsToward}
            containerWidth={repWidth}
          />
        </div>
        <EntityActions
          name={row.name}
          onOpenInPanel={row.typeId ? () => openThingInPanel(row.typeId) : undefined}
          onOpenWeb={row.typeId ? (e) => openThingAsWeb(row.typeId, e) : undefined}
          webOpen={row.webOpen}
        />
      </div>
    );
  }
  const isWeb = row.kind === 'web';
  return (
    <div className="entity-row">
      <div className="entity-row-rep">
        <ThingChip id={row.id} name={row.name} color={row.color} definitionGraphIds={row.definitionGraphIds} maxWidth={repWidth} />
      </div>
      <EntityActions
        name={row.name}
        onOpenInPanel={isWeb ? () => openWebInPanel(row.id) : () => openThingInPanel(row.id)}
        onOpenWeb={isWeb ? (e) => openWebOnCanvas(row.id, e) : (e) => openThingAsWeb(row.id, e)}
        webOpen={row.webOpen}
      />
    </div>
  );
};

/** What a Wizard tool call made, under its card. Renders nothing when it's all gone. */
export const CreatedEntities = ({ created }) => {
  const signature = useGraphStore(state => rowsSignature(resolveRows(created, state)));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const rows = useMemo(() => resolveRows(created, useGraphStore.getState()), [created, signature]);
  const [expanded, setExpanded] = useState(false);
  const ref = useRef(null);
  const [width, setWidth] = useState(320);
  const hasRows = rows.length > 0;

  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const measure = () => setWidth(el.offsetWidth || 320);
    measure();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [hasRows]);

  if (rows.length === 0) return null;
  const shown = expanded ? rows : rows.slice(0, ROWS_COLLAPSED);
  const hidden = rows.length - shown.length;

  return (
    <div className="tool-created-entities" ref={ref} onClick={(e) => e.stopPropagation()}>
      {shown.map(row => <EntityRow key={row.key} row={row} width={width} />)}
      {(hidden > 0 || expanded) && rows.length > ROWS_COLLAPSED && (
        <button type="button" className="tool-created-toggle" onClick={() => setExpanded(v => !v)}>
          {expanded ? 'Show fewer' : `Show ${hidden} more`}
        </button>
      )}
    </div>
  );
};

export default CreatedEntities;
