import React, { useEffect, useMemo, useRef, useState } from 'react';
import { NotebookText, ArrowUpFromDot } from 'lucide-react';
import UniversalNodeRenderer from '../../UniversalNodeRenderer';
import TripletPreview from '../connections/TripletPreview.jsx';
import PanelIconButton from '../shared/PanelIconButton.jsx';
import { DefinitionCard, DefinitionDescription } from '../panel/WebDefinitionsSection.jsx';
import useGraphStore from '../../store/graphStore.js';
import useMobileDetection from '../../hooks/useMobileDetection';
import { useTheme } from '../../hooks/useTheme.js';
import { layoutNodeChips, panelListTextFor } from '../../utils/connectionPreview.js';
import { NODE_DEFAULT_COLOR } from '../../constants.js';
import { resolveRows, rowsSignature } from './createdRows.js';
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
 * A Web the call made, as the right panel's Web Definitions shows one: its two
 * buttons, the Web drawn live (it changes as the Web does, like Open Webs), and
 * its description under it.
 */
const WebEntity = ({ row, width, expanded, onOverflowChange }) => {
  const thing = useGraphStore(s => (row.thingId ? s.nodePrototypes.get(row.thingId) || null : null));
  return (
    <div className="entity-web" style={{ width: Math.min(width, WEB_CARD_MAX_WIDTH) }}>
      <EntityActions
        name={row.name}
        onOpenInPanel={() => openWebInPanel(row.id)}
        onOpenWeb={(e) => openWebOnCanvas(row.id, e)}
        webOpen={row.webOpen}
      />
      <DefinitionCard graphId={row.id} nodeName={row.thingName} nodeColor={row.color} />
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
  return (
    <div className="entity-row">
      <div className="entity-row-rep">
        <ThingChip id={row.id} name={row.name} color={row.color} definitionGraphIds={row.definitionGraphIds} maxWidth={repWidth} />
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
    const measure = () => setWidth(el.offsetWidth || 320);
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
