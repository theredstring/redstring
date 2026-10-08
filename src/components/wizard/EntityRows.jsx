import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useDrag } from 'react-dnd';
import { getEmptyImage } from 'react-dnd-html5-backend';
import { NotebookText, ArrowUpFromDot } from 'lucide-react';
import UniversalNodeRenderer from '../../UniversalNodeRenderer';
import TripletPreview from '../connections/TripletPreview.jsx';
import CompactConnectionRow, { COMPACT_CONNECTIONS_BELOW } from '../connections/CompactConnectionRow.jsx';
import PanelIconButton from '../shared/PanelIconButton.jsx';
import { DefinitionCard, DefinitionDescription } from '../panel/WebDefinitionsSection.jsx';
import useGraphStore from '../../store/graphStore.js';
import useMobileDetection from '../../hooks/useMobileDetection';
import { useTheme } from '../../hooks/useTheme.js';
import { layoutNodeChips, panelListTextFor } from '../../utils/connectionPreview.js';
import { NODE_DEFAULT_COLOR } from '../../constants.js';
import { resolveRows, rowsSignature } from './createdRows.js';
import useSpawnableDrag from './useSpawnableDrag.js';
import {
  openThingInPanel,
  openWebInPanel,
  openThingAsWeb,
  openWebOnCanvas
} from './entityActions.js';

/**
 * A Thing, Web or Connection drawn the way the control panel draws it, with the
 * type row's two buttons beside it: open in the panel, open as a web.
 */

/** A made Web's card is no wider than this; the chat column can be. */
const WEB_CARD_MAX_WIDTH = 340;

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

// Where a definition's description is kept: the first's on the Thing, the
// rest (and a Web no Thing defines) on the Web. As PanelContentWrapper does.
const updateWebDescription = (thingId, graphId, description) => {
  const st = useGraphStore.getState();
  const thing = thingId ? st.nodePrototypes.get(thingId) : null;
  if (thing && thing.definitionGraphIds?.[0] === graphId) {
    st.updateNodePrototype(thingId, (draft) => { draft.description = description; });
  } else {
    st.updateGraph?.(graphId, (draft) => { draft.description = description; });
  }
};

/**
 * A Web the call made, as the right panel's Web Definitions shows one: the Web
 * drawn live (it changes as the Web does, like Open Webs), its two buttons under
 * it, then its description.
 */
/** The Web's card, dragged as Open Webs drags one: the Thing it defines, with the Web. */
const DraggableWebCard = ({ row }) => {
  const [drag, isDragging] = useSpawnableDrag({ prototypeId: row.thingId, nodeName: row.thingName, graphId: row.id });
  return (
    <div ref={drag} className="entity-drag" style={{ opacity: isDragging ? 0.5 : 1, cursor: row.thingId ? 'grab' : undefined }}>
      <DefinitionCard graphId={row.id} nodeName={row.thingName} nodeColor={row.color} />
    </div>
  );
};

/** A Thing's chip, dragged as any Thing in a panel list is. */
const DraggableThingChip = ({ row, maxWidth }) => {
  const [drag, isDragging] = useSpawnableDrag({ prototypeId: row.id, nodeName: row.name });
  return (
    <div ref={drag} className="entity-drag" style={{ opacity: isDragging ? 0.5 : 1, cursor: 'grab' }}>
      <ThingChip id={row.id} name={row.name} color={row.color} definitionGraphIds={row.definitionGraphIds} maxWidth={maxWidth} />
    </div>
  );
};

/**
 * A connection too narrow for a triplet, as the semantic list draws one but
 * three Things down: both ends, and the connection between them as the Thing
 * that defines it. Each picks up as itself.
 */
const DraggableCompactConnection = ({ row }) => {
  const [dragSubject, draggingSubject] = useSpawnableDrag({ prototypeId: row.subjectId, nodeName: row.subject });
  const [dragObject, draggingObject] = useSpawnableDrag({ prototypeId: row.objectId, nodeName: row.object });
  const [dragType, draggingType] = useSpawnableDrag({ prototypeId: row.typeId, nodeName: row.name });
  const pillStyle = (dragging) => ({ cursor: 'grab', opacity: dragging ? 0.5 : 1, userSelect: 'none', WebkitUserSelect: 'none', WebkitTouchCallout: 'none' });
  const toward = row.arrowsToward;
  return (
    <CompactConnectionRow
      subjectName={row.subject}
      subjectColor={row.subjectColor}
      predicate={row.name}
      otherName={row.object}
      otherColor={row.objectColor}
      direction={toward.has('object') && toward.has('subject') ? 'both'
        : toward.has('object') ? 'out'
          : toward.has('subject') ? 'in' : 'none'}
      subjectPill={{ ref: dragSubject, style: pillStyle(draggingSubject) }}
      otherPill={{ ref: dragObject, style: pillStyle(draggingObject) }}
      predicatePill={{
        color: row.connectionColor || NODE_DEFAULT_COLOR,
        ref: dragType,
        style: row.typeId ? pillStyle(draggingType) : undefined
      }}
    />
  );
};

/**
 * A connection's triplet, picked up by the part you grab: the left third is
 * its subject, the middle the Thing that defines the connection, the right
 * third its object. One SVG draws all three, so the part is read from the
 * pointer rather than from the boxes.
 */
const DraggableTriplet = ({ row, width }) => {
  const sideRef = useRef('subject');
  const [{ isDragging }, drag, preview] = useDrag(() => ({
    type: 'spawnable_node',
    item: () => {
      if (sideRef.current === 'object') return { prototypeId: row.objectId, nodeName: row.object };
      if (sideRef.current === 'type') return { prototypeId: row.typeId, nodeName: row.name };
      return { prototypeId: row.subjectId, nodeName: row.subject };
    },
    canDrag: () => !!(sideRef.current === 'object' ? row.objectId
      : sideRef.current === 'type' ? row.typeId : row.subjectId),
    collect: (monitor) => ({ isDragging: !!monitor.isDragging() })
  }), [row.subjectId, row.objectId, row.typeId, row.subject, row.object, row.name]);
  useEffect(() => { preview(getEmptyImage(), { captureDraggingState: true }); }, [preview]);

  const pickSide = (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.touches?.[0]?.clientX ?? e.clientX;
    const at = (x - rect.left) / Math.max(1, rect.width);
    sideRef.current = at < 1 / 3 ? 'subject' : at > 2 / 3 ? 'object' : 'type';
  };

  return (
    <div
      ref={drag}
      className="entity-drag"
      onPointerDown={pickSide}
      onMouseDown={pickSide}
      onTouchStart={pickSide}
      style={{ cursor: 'grab', opacity: isDragging ? 0.5 : 1 }}
    >
      <TripletPreview
        subject={row.subject}
        predicate={row.name}
        object={row.object}
        subjectColor={row.subjectColor}
        objectColor={row.objectColor}
        connectionColor={row.connectionColor}
        arrowsToward={row.arrowsToward}
        containerWidth={width}
      />
    </div>
  );
};

const WebEntity = ({ row, width, expanded, onOverflowChange }) => {
  const thing = useGraphStore(s => (row.thingId ? s.nodePrototypes.get(row.thingId) || null : null));
  return (
    <div className="entity-web" style={{ width: Math.min(width, WEB_CARD_MAX_WIDTH) }}>
      <DraggableWebCard row={row} />
      <EntityActions
        name={row.name}
        onOpenInPanel={() => openWebInPanel(row.id)}
        onOpenWeb={(e) => openWebOnCanvas(row.id, e)}
        webOpen={row.webOpen}
      />
      <DefinitionDescription
        graphId={row.id}
        thing={thing}
        onUpdate={(graphId, description) => updateWebDescription(row.thingId, graphId, description)}
        compact
        expanded={expanded}
        onOverflowChange={onOverflowChange}
      />
    </div>
  );
};

const EntityRow = ({ row, width, expanded, onOverflowChange }) => {
  if (row.kind === 'web') return <WebEntity row={row} width={width} expanded={expanded} onOverflowChange={onOverflowChange} />;
  // Narrow: the buttons go under the drawing, which then has the whole width,
  // rather than squeezing in beside it (a chip kept a 140px floor, so a narrow
  // card pushed its buttons past the edge).
  const narrow = width - ACTIONS_WIDTH < COMPACT_CONNECTIONS_BELOW;
  const repWidth = narrow ? Math.max(1, width) : width - ACTIONS_WIDTH;
  if (row.kind === 'connection') {
    return (
      <div className={`entity-row${narrow ? ' entity-row-stacked entity-row-compact' : ''}`}>
        <div className="entity-row-rep">
          {narrow ? (
            // Too narrow for a readable triplet: the semantic list's compact
            // row, with both ends, since a card implies neither.
            <DraggableCompactConnection row={row} />
          ) : (
            <DraggableTriplet row={row} width={repWidth} />
          )}
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
  return (
    <div className={`entity-row${narrow ? ' entity-row-stacked' : ''}`}>
      <div className="entity-row-rep">
        <DraggableThingChip row={row} maxWidth={repWidth} />
      </div>
      <EntityActions
        name={row.name}
        onOpenInPanel={() => openThingInPanel(row.id)}
        onOpenWeb={(e) => openThingAsWeb(row.id, e)}
        webOpen={row.webOpen}
      />
    </div>
  );
};

const SECTION_TITLES = { thing: 'Things', connection: 'Connections' };

/** What a Wizard tool call made, under its card. Renders nothing when it's all gone. */
export const CreatedEntities = ({ created }) => {
  const signature = useGraphStore(state => rowsSignature(resolveRows(created, state)));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const rows = useMemo(() => resolveRows(created, useGraphStore.getState()), [created, signature]);
  const [expanded, setExpanded] = useState(false);
  const [descOverflows, setDescOverflows] = useState(false);
  const theme = useTheme();
  const ref = useRef(null);
  const [width, setWidth] = useState(320);
  const hasRows = rows.length > 0;

  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    // The content box: offsetWidth counts the area's own padding, which sized
    // every drawing 20px wider than the room it had.
    const measure = () => {
      const cs = typeof getComputedStyle === 'function' ? getComputedStyle(el) : null;
      const pad = cs ? (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.paddingRight) || 0) : 0;
      setWidth(Math.max(0, (el.clientWidth || 0) - pad) || 320);
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [hasRows]);

  if (rows.length === 0) return null;
  // One Show More for the whole card. A call that made a Web shows that Web
  // first, its description clamped; the pill opens the description and the
  // rest of what the call made together, rather than one toggle each.
  const leadsWithWeb = rows[0].kind === 'web';
  const shown = expanded ? rows : rows.slice(0, leadsWithWeb ? 1 : ROWS_COLLAPSED);
  const hidden = rows.length - shown.length;
  const showToggle = expanded || hidden > 0 || (leadsWithWeb && descOverflows);
  const accentColor = theme.darkMode ? '#C09191' : theme.accent.primary;
  // Headed by kind, with the count, as the card's detail lists were, once
  // there is more than one kind to tell apart. A Web's card names itself.
  const counts = rows.reduce((acc, r) => ({ ...acc, [r.kind]: (acc[r.kind] || 0) + 1 }), {});
  const headed = Object.keys(counts).length > 1;

  return (
    <div className="tool-created-entities" ref={ref} onClick={(e) => e.stopPropagation()}>
      {shown.map((row, i) => (
        <React.Fragment key={row.key}>
          {headed && SECTION_TITLES[row.kind] && shown[i - 1]?.kind !== row.kind && (
            <h4 className="tool-created-heading">{SECTION_TITLES[row.kind]} ({counts[row.kind]})</h4>
          )}
          <EntityRow
            row={row}
            width={width}
            expanded={expanded}
            onOverflowChange={i === 0 ? setDescOverflows : undefined}
          />
        </React.Fragment>
      ))}
      {showToggle && (
        // The description's own pill, as Web Definitions draws it.
        <PanelIconButton
          label={expanded ? 'Show Less' : 'Show More'}
          labelFontSize={11}
          variant="outline"
          color={accentColor}
          onClick={() => setExpanded(v => !v)}
          style={{ borderColor: accentColor }}
        />
      )}
    </div>
  );
};

export default CreatedEntities;
