import { useDeferredValue, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ArrowUpFromDot, ChevronLeft, ChevronRight, NotebookText, Plus, Trash2 } from 'lucide-react';
import { getDefinitionDescription } from '../../utils.js';
import { useTheme } from '../../hooks/useTheme.js';
import useGraphStore from '../../store/graphStore.js';
import useDoubleTap from '../../hooks/useDoubleTap.js';
import WebCard from '../webPreview/WebCard.jsx';
import { projectGraphView, viewEdges } from '../../core/openDefinitions.js';
import PanelIconButton from '../shared/PanelIconButton.jsx';

// Lines of description shown before "Show More"; enough to tell definitions apart
// while skimming.
const DESCRIPTION_CLAMP_LINES = 3;

/**
 * One definition drawn as the canvas draws a Thing in the decompose preview
 * (WebCard). The description is left out here; the section shows it underneath.
 */
export const DefinitionCard = ({ graphId, nodeName, nodeColor }) => {
  // Narrow selectors: the graph object itself changes on every pan and zoom of
  // that graph, its instances and edge list only when its contents do. Read as
  // viewed, like the canvas: a Thing opened in place inside this Web shows its
  // definition's nodes in its box, and a connection into a closed box is drawn
  // to the box.
  const instances = useGraphStore((s) => projectGraphView(s, graphId)?.instances);
  const edgeIds = useGraphStore((s) => projectGraphView(s, graphId)?.edgeIds);
  const groups = useGraphStore((s) => projectGraphView(s, graphId)?.groups);
  const webName = useGraphStore((s) => s.graphs.get(graphId)?.name);
  const nodePrototypes = useGraphStore((s) => s.nodePrototypes);
  const edgesMap = useGraphStore((s) => viewEdges(s, graphId));

  const nodes = useMemo(() => {
    if (!instances) return [];
    const result = [];
    instances.forEach((instance, id) => {
      const prototype = nodePrototypes.get(instance.prototypeId);
      if (prototype) result.push({ ...prototype, ...instance, id });
    });
    return result;
  }, [instances, nodePrototypes]);

  const edges = useMemo(() => (
    Array.isArray(edgeIds) ? edgeIds.map((id) => edgesMap.get(id)).filter(Boolean) : []
  ), [edgeIds, edgesMap]);

  // The Web on show can be the one being dragged around on the canvas (a home
  // tab showing its own graph); let the canvas frame win.
  const deferredNodes = useDeferredValue(nodes);
  const deferredEdges = useDeferredValue(edges);
  const deferredGroups = useDeferredValue(groups);

  const title = (typeof webName === 'string' && webName.trim()) ? webName.trim() : nodeName;

  // Sized by the Thing's name, as the canvas sizes it, whatever the title says.
  return (
    <WebCard
      nodes={deferredNodes}
      edges={deferredEdges}
      groups={deferredGroups}
      title={title}
      sizingName={nodeName}
      color={nodeColor}
    />
  );
};

/**
 * The definition's own description: what this Thing means under this Web. The
 * first definition's is the Thing's description (getDefinitionDescription).
 */
export const DefinitionDescription = ({
  graphId,
  thing,
  onUpdate,
  compact = false,
  // Controlled from outside (a chat card's one Show More, wizard/EntityRows.jsx):
  // the caller owns `expanded`, hears whether the clamp hides anything, and
  // draws the toggle itself.
  expanded: expandedProp,
  onOverflowChange
}) => {
  const theme = useTheme();
  const webDescription = useGraphStore((s) => s.graphs.get(graphId)?.description);
  const description = getDefinitionDescription(thing, graphId, webDescription);
  const [draft, setDraft] = useState(null);
  const savingRef = useRef(false);
  const editing = draft !== null;
  // Clamped until asked; the card is keyed per definition, so each starts clamped.
  const [expandedOwn, setExpanded] = useState(false);
  const controlled = expandedProp !== undefined;
  const expanded = controlled ? expandedProp : expandedOwn;
  const [overflows, setOverflows] = useState(false);
  useLayoutEffect(() => { onOverflowChange?.(overflows); }, [overflows, onOverflowChange]);
  const textRef = useRef(null);
  const accentColor = theme.darkMode ? '#C09191' : theme.accent.primary;

  // Only a clamped box can tell whether it is hiding anything, so measure while
  // collapsed and keep the answer while expanded.
  useLayoutEffect(() => {
    const el = textRef.current;
    if (!el || expanded) return undefined;
    const measure = () => setOverflows(el.scrollHeight - el.clientHeight > 1);
    measure();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [description, expanded, editing]);

  const save = () => {
    if (savingRef.current || !editing) return;
    savingRef.current = true;
    if (draft !== description) onUpdate?.(graphId, draft);
    setDraft(null);
    setTimeout(() => { savingRef.current = false; }, 200);
  };

  const startEditing = () => { savingRef.current = false; setDraft(description); };
  const descriptionDoubleTap = useDoubleTap(startEditing);

  const sizeToContent = (el) => {
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.max(el.scrollHeight + 4, 40)}px`;
  };

  // `compact`: a chat card's smaller text (wizard/EntityRows.jsx).
  const textStyle = {
    fontSize: compact ? '0.85rem' : '1.0rem',
    fontFamily: "'EmOne', sans-serif",
    lineHeight: '1.4',
    textAlign: 'left'
  };

  if (editing) {
    return (
      <div style={{ padding: '14px 0 6px' }}>
        <textarea
          value={draft}
          autoFocus
          rows={2}
          ref={sizeToContent}
          onChange={(e) => setDraft(e.target.value)}
          onInput={(e) => sizeToContent(e.target)}
          onBlur={save}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              save();
            } else if (e.key === 'Escape') {
              setDraft(null);
            }
          }}
          style={{
            ...textStyle,
            width: '100%',
            padding: '8px 12px 12px 12px',
            border: `3px solid ${theme.canvas.textPrimary}`,
            borderRadius: '12px',
            backgroundColor: 'transparent',
            outline: 'none',
            color: theme.canvas.textPrimary,
            resize: 'none',
            minHeight: '40px',
            overflow: 'hidden',
            boxSizing: 'border-box'
          }}
        />
      </div>
    );
  }

  return (
    <div style={{ padding: '14px 8px 6px' }}>
      <div
        ref={textRef}
        onDoubleClick={startEditing}
        {...descriptionDoubleTap}
        title="Double-click to edit"
        style={{
          ...textStyle,
          color: description ? theme.canvas.textPrimary : theme.canvas.textSecondary,
          cursor: 'pointer',
          userSelect: 'text',
          whiteSpace: 'pre-wrap',
          ...(expanded ? {} : {
            display: '-webkit-box',
            WebkitLineClamp: DESCRIPTION_CLAMP_LINES,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden'
          })
        }}
      >
        {description || 'Double-click to describe this definition...'}
      </div>
      {!controlled && (overflows || expanded) && (
        <div style={{ display: 'flex', justifyContent: compact ? 'flex-start' : 'center', marginTop: '10px' }}>
          <PanelIconButton
            label={expanded ? 'Show Less' : 'Show More'}
            labelFontSize={11}
            variant="outline"
            color={accentColor}
            onClick={() => setExpanded((v) => !v)}
            style={{ borderColor: accentColor }}
          />
        </div>
      )}
    </div>
  );
};

/**
 * Body of the right panel's Web Definitions section, for skimming a Thing's
 * definitions to find the right one: the controls, the definition on show drawn
 * as the decompose view draws it, and that definition's own description.
 *
 * Which definition is on show belongs to the tab (PanelContentWrapper): it opens
 * on the one you're on and never moves the canvas.
 */
const WebDefinitionsSection = ({
  nodeData,
  definitionGraphIds = [],
  definitionIndex = 0,
  currentDefinitionId = null,
  onDefinitionIndexChange,
  onAddDefinition,
  onDeleteDefinition,
  onOpenDefinition,
  onOpenDefinitionInPanel,
  onUpdateDescription,
  canEdit = true,
  activeGraphId = null,
  subjectWebId = null,
  isUltraSlim = false
}) => {
  const theme = useTheme();
  const total = definitionGraphIds.length;
  const shownGraphId = definitionGraphIds[definitionIndex] || null;
  const hasPrev = definitionIndex > 0;
  const hasNext = definitionIndex < total - 1;
  const nodeName = nodeData?.name || 'this Thing';

  if (total === 0) {
    // Mirrors the canvas's empty decompose preview ("+ Define X With a New Web").
    return (
      <div style={{ marginRight: '15px' }}>
        <button
          type="button"
          onClick={canEdit ? onAddDefinition : undefined}
          disabled={!canEdit}
          style={{
            width: '100%',
            aspectRatio: '1 / 1',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '4px',
            background: 'transparent',
            border: `2px dashed ${theme.canvas.textSecondary}`,
            borderRadius: '16px',
            color: theme.canvas.textSecondary,
            fontFamily: "'EmOne', sans-serif",
            fontSize: '0.9rem',
            fontWeight: 'bold',
            cursor: canEdit ? 'pointer' : 'default',
            outline: 'none'
          }}
        >
          <Plus size={28} />
          <span>Define {nodeName}</span>
          <span>With a New Web</span>
        </button>
      </div>
    );
  }

  const isOpenOnCanvas = shownGraphId === activeGraphId;
  const isThisTabsWeb = shownGraphId === subjectWebId;
  const isCurrent = shownGraphId === currentDefinitionId;
  const currentIndex = definitionGraphIds.indexOf(currentDefinitionId);

  const navigation = (
    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
      <PanelIconButton
        icon={ChevronLeft}
        onClick={hasPrev ? () => onDefinitionIndexChange?.(definitionIndex - 1) : undefined}
        disabled={!hasPrev}
        title="Previous definition"
      />
      {/* Away from the definition you're on, the count takes you back to it. */}
      <button
        type="button"
        onClick={!isCurrent && currentIndex >= 0 ? () => onDefinitionIndexChange?.(currentIndex) : undefined}
        title={isCurrent ? "The definition you're on" : "Back to the definition you're on"}
        style={{
          minWidth: '44px',
          padding: 0,
          background: 'transparent',
          border: 'none',
          outline: 'none',
          textAlign: 'center',
          fontFamily: "'EmOne', sans-serif",
          fontSize: '0.9rem',
          fontWeight: isCurrent ? 'bold' : 'normal',
          color: isCurrent ? theme.canvas.textPrimary : theme.canvas.textSecondary,
          fontVariantNumeric: 'tabular-nums',
          cursor: isCurrent ? 'default' : 'pointer'
        }}
      >
        {definitionIndex + 1} / {total}
      </button>
      <PanelIconButton
        icon={ChevronRight}
        onClick={hasNext ? () => onDefinitionIndexChange?.(definitionIndex + 1) : undefined}
        disabled={!hasNext}
        title="Next definition"
      />
    </div>
  );

  const actions = (
    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
      <PanelIconButton
        icon={NotebookText}
        onClick={isThisTabsWeb ? undefined : () => onOpenDefinitionInPanel?.(shownGraphId)}
        disabled={isThisTabsWeb}
        title={isThisTabsWeb ? 'This is its tab' : 'Open in panel'}
      />
      <PanelIconButton
        icon={ArrowUpFromDot}
        onClick={isOpenOnCanvas ? undefined : (e) => onOpenDefinition?.(shownGraphId, e)}
        disabled={isOpenOnCanvas}
        title={isOpenOnCanvas ? 'This Web is open' : 'Open this Web'}
      />
      {canEdit && (
        <PanelIconButton icon={Plus} onClick={onAddDefinition} title="Add definition" />
      )}
      {canEdit && (
        <PanelIconButton
          icon={Trash2}
          onClick={() => onDeleteDefinition?.(shownGraphId)}
          title="Delete definition"
        />
      )}
    </div>
  );

  return (
    <div style={{ marginRight: '15px' }}>
      {/* A narrow panel stacks the two groups instead of squeezing them. */}
      <div style={{
        display: 'flex',
        flexDirection: isUltraSlim ? 'column' : 'row',
        flexWrap: 'wrap',
        alignItems: 'center',
        justifyContent: 'space-between',
        rowGap: '8px',
        columnGap: '12px',
        marginBottom: '10px'
      }}>
        {navigation}
        {actions}
      </div>
      {shownGraphId && (
        <DefinitionCard
          key={shownGraphId}
          graphId={shownGraphId}
          nodeName={nodeName}
          nodeColor={nodeData?.color}
        />
      )}
      {shownGraphId && (
        <DefinitionDescription key={`desc-${shownGraphId}`} graphId={shownGraphId} thing={nodeData} onUpdate={onUpdateDescription} />
      )}
    </div>
  );
};

export default WebDefinitionsSection;
