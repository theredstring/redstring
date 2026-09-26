import { useDeferredValue, useMemo, useRef, useState } from 'react';
import { ArrowUpFromDot, ChevronLeft, ChevronRight, NotebookText, Plus, Trash2 } from 'lucide-react';
import { NODE_DEFAULT_COLOR } from '../../constants.js';
import { getNodeDimensions } from '../../utils.js';
import { getTextColor } from '../../utils/colorUtils';
import { buildNodeFontString, wrapTextToLines } from '../../services/textMeasurement.js';
import { LABEL_FONT_SIZE_BASE, LABEL_LINE_HEIGHT_BASE } from '../../utils/nodeLabelStyle.js';
import { useTheme } from '../../hooks/useTheme.js';
import useGraphStore from '../../store/graphStore.js';
import InnerNetwork from '../../InnerNetwork.jsx';
import PanelIconButton from '../shared/PanelIconButton.jsx';

// Node.jsx: the label container's vertical padding and the background rect's inset.
const LABEL_PADDING_V = 34;
const FRAME_INSET = 6;

/**
 * One definition drawn as the canvas draws a Thing in the decompose preview:
 * the same geometry (getNodeDimensions in preview mode) under a viewBox, so the
 * frame, the title band and the Web keep the proportions they have on the canvas.
 * The description is left out here; the section shows it underneath.
 */
const DefinitionCard = ({ graphId, nodeName, nodeColor }) => {
  const theme = useTheme();
  const textSettings = useGraphStore((s) => s.textSettings);
  // Narrow selectors: the graph object itself changes on every pan and zoom of
  // that graph, its instances and edge list only when its contents do.
  const instances = useGraphStore((s) => s.graphs.get(graphId)?.instances);
  const edgeIds = useGraphStore((s) => s.graphs.get(graphId)?.edgeIds);
  const webName = useGraphStore((s) => s.graphs.get(graphId)?.name);
  const nodePrototypes = useGraphStore((s) => s.nodePrototypes);
  const edgesMap = useGraphStore((s) => s.edges);

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

  const nodeScale = textSettings?.nodeScale ?? 1;
  const title = (typeof webName === 'string' && webName.trim()) ? webName.trim() : nodeName;

  const geometry = useMemo(() => {
    // Sized by the Thing's name, as the canvas sizes it, whatever the title says.
    const dims = getNodeDimensions({ name: nodeName }, true, null);
    const unexpanded = getNodeDimensions({ name: nodeName }, false, null);
    const fontScale = (textSettings?.fontSize ?? 1) * nodeScale;
    const fontSize = LABEL_FONT_SIZE_BASE * fontScale;
    const lineHeight = LABEL_LINE_HEIGHT_BASE * fontScale * (textSettings?.lineSpacing ?? 1);
    const wrapWidth = unexpanded.currentWidth - 2 * unexpanded.scaledPadding;
    const maxLines = Math.max(1, Math.floor((dims.textAreaHeight - 2 * LABEL_PADDING_V * nodeScale) / lineHeight));
    let lines = wrapTextToLines(title, wrapWidth, buildNodeFontString({ ...textSettings, fontSize: fontScale }));
    if (lines.length === 0) lines = [title];
    if (lines.length > maxLines) {
      lines = lines.slice(0, maxLines);
      lines[maxLines - 1] = `${lines[maxLines - 1].replace(/\s+\S*$/, '')}…`;
    }
    return { dims, fontSize, lineHeight, lines };
  }, [nodeName, title, textSettings, nodeScale]);

  const { dims, fontSize, lineHeight, lines } = geometry;
  const width = dims.currentWidth;
  const height = dims.currentHeight;
  const inner = {
    x: dims.scaledPadding,
    y: dims.textAreaHeight,
    w: dims.innerNetworkWidth,
    h: dims.innerNetworkHeight,
    r: 22 * nodeScale
  };
  const color = nodeColor || NODE_DEFAULT_COLOR;
  const textColor = getTextColor(color, theme.darkMode);
  const titleCenterY = dims.textAreaHeight / 2;

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      width="100%"
      style={{ display: 'block', height: 'auto', aspectRatio: `${width} / ${height}` }}
      role="img"
      aria-label={title}
    >
      <rect
        x={FRAME_INSET}
        y={FRAME_INSET}
        width={width - FRAME_INSET * 2}
        height={height - FRAME_INSET * 2}
        rx={dims.scaledCornerRadius - FRAME_INSET}
        ry={dims.scaledCornerRadius - FRAME_INSET}
        fill={color}
      />
      {lines.map((line, i) => (
        <text
          key={i}
          x={width / 2}
          y={titleCenterY + (i - (lines.length - 1) / 2) * lineHeight}
          textAnchor="middle"
          dominantBaseline="central"
          fontFamily="'EmOne', sans-serif"
          fontWeight="bold"
          fontSize={fontSize}
          fill={textColor}
        >
          {line}
        </text>
      ))}
      <rect x={inner.x} y={inner.y} width={inner.w} height={inner.h} rx={inner.r} ry={inner.r} fill={theme.canvas.bg} />
      {deferredNodes.length > 0 ? (
        <g transform={`translate(${inner.x}, ${inner.y})`}>
          <InnerNetwork
            nodes={deferredNodes}
            edges={deferredEdges}
            width={inner.w}
            height={inner.h}
            padding={14 * nodeScale}
          />
        </g>
      ) : (
        <text
          x={inner.x + inner.w / 2}
          y={inner.y + inner.h / 2}
          textAnchor="middle"
          dominantBaseline="central"
          fontFamily="'EmOne', sans-serif"
          fontWeight="bold"
          fontSize={36 * nodeScale}
          fill={theme.canvas.textSecondary}
        >
          This Web is empty.
        </text>
      )}
    </svg>
  );
};

/** The definition's own description: what this Thing means under this Web. */
const DefinitionDescription = ({ graphId, onUpdate }) => {
  const theme = useTheme();
  const description = useGraphStore((s) => s.graphs.get(graphId)?.description) || '';
  const [draft, setDraft] = useState(null);
  const savingRef = useRef(false);
  const editing = draft !== null;

  const save = () => {
    if (savingRef.current || !editing) return;
    savingRef.current = true;
    if (draft !== description) onUpdate?.(graphId, draft);
    setDraft(null);
    setTimeout(() => { savingRef.current = false; }, 200);
  };

  const sizeToContent = (el) => {
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.max(el.scrollHeight + 4, 40)}px`;
  };

  const textStyle = {
    fontSize: '1.0rem',
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
    <div
      onDoubleClick={() => { savingRef.current = false; setDraft(description); }}
      title="Double-click to edit"
      style={{
        ...textStyle,
        padding: '14px 8px 6px',
        color: description ? theme.canvas.textPrimary : theme.canvas.textSecondary,
        cursor: 'pointer',
        userSelect: 'text',
        whiteSpace: 'pre-wrap'
      }}
    >
      {description || 'Double-click to describe this definition...'}
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
        alignItems: isUltraSlim ? 'flex-start' : 'center',
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
        <DefinitionDescription key={`desc-${shownGraphId}`} graphId={shownGraphId} onUpdate={onUpdateDescription} />
      )}
    </div>
  );
};

export default WebDefinitionsSection;
