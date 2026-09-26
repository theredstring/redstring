import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowUpFromDot, ChevronLeft, ChevronRight, Plus, Trash2 } from 'lucide-react';
import { NODE_DEFAULT_COLOR } from '../../constants.js';
import { getTextColor } from '../../utils/colorUtils';
import { useTheme } from '../../hooks/useTheme.js';
import useGraphStore from '../../store/graphStore.js';
import InnerNetwork from '../../InnerNetwork.jsx';
import PanelIconButton from '../shared/PanelIconButton.jsx';

// The preview box's shape. The canvas preview is sized by the expanded node; the
// panel has only its own width to go on, so it keeps a fixed landscape ratio.
const PREVIEW_ASPECT = 3 / 4;

/**
 * One definition drawn the way the decompose preview draws it on the canvas
 * (stage 1): the Web inside a frame in the Thing's colour, with the Web's name
 * above and its description below.
 */
const DefinitionPreview = ({ graphId, nodeName, nodeColor }) => {
  const theme = useTheme();
  // Narrow selectors: the graph object itself changes on every pan and zoom of
  // that graph, its instances and edge list only when its contents do.
  const instances = useGraphStore((s) => s.graphs.get(graphId)?.instances);
  const edgeIds = useGraphStore((s) => s.graphs.get(graphId)?.edgeIds);
  const webName = useGraphStore((s) => s.graphs.get(graphId)?.name);
  const webDescription = useGraphStore((s) => s.graphs.get(graphId)?.description);
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

  // InnerNetwork lays out in pixels and drops labels below a pixel size, so it
  // needs the box's real width rather than a viewBox that scales afterwards.
  const boxRef = useRef(null);
  const [boxWidth, setBoxWidth] = useState(0);
  useEffect(() => {
    const el = boxRef.current;
    if (!el) return undefined;
    const measure = () => setBoxWidth(el.clientWidth);
    measure();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  const boxHeight = Math.round(boxWidth * PREVIEW_ASPECT);

  const color = nodeColor || NODE_DEFAULT_COLOR;
  const textColor = getTextColor(color, theme.darkMode);
  const title = (typeof webName === 'string' && webName.trim()) ? webName.trim() : nodeName;
  const description = typeof webDescription === 'string' ? webDescription.trim() : '';

  return (
    <div style={{
      backgroundColor: color,
      borderRadius: '16px',
      padding: '8px 8px 10px',
      boxSizing: 'border-box'
    }}>
      <div style={{
        color: textColor,
        fontFamily: "'EmOne', sans-serif",
        fontWeight: 'bold',
        fontSize: '1rem',
        lineHeight: 1.25,
        textAlign: 'center',
        padding: '4px 8px 8px',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap'
      }}>
        {title}
      </div>
      <div
        ref={boxRef}
        style={{
          width: '100%',
          aspectRatio: `1 / ${PREVIEW_ASPECT}`,
          backgroundColor: theme.canvas.bg,
          borderRadius: '10px',
          overflow: 'hidden',
          position: 'relative'
        }}
      >
        {deferredNodes.length > 0 && boxWidth > 0 ? (
          <svg width={boxWidth} height={boxHeight} style={{ display: 'block' }}>
            <InnerNetwork
              nodes={deferredNodes}
              edges={deferredEdges}
              width={boxWidth}
              height={boxHeight}
              padding={10}
            />
          </svg>
        ) : deferredNodes.length === 0 && (
          <div style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: theme.canvas.textSecondary,
            fontFamily: "'EmOne', sans-serif",
            fontSize: '0.9rem'
          }}>
            This Web is empty.
          </div>
        )}
      </div>
      {description && (
        <div style={{
          color: textColor,
          fontFamily: "'EmOne', sans-serif",
          fontSize: '0.8rem',
          lineHeight: 1.35,
          padding: '8px 6px 0',
          display: '-webkit-box',
          WebkitLineClamp: 3,
          WebkitBoxOrient: 'vertical',
          overflow: 'hidden'
        }}>
          {description}
        </div>
      )}
    </div>
  );
};

/**
 * Body of the right panel's Web Definitions section: the definition on show,
 * previewed as the decompose view draws it, with the controls the decompose pie
 * offers — step between definitions, open one, add one, delete one.
 *
 * The index is the same `"nodeId-graphId"` context index the canvas uses, so
 * stepping here steps the decompose preview and the Components list with it.
 */
const WebDefinitionsSection = ({
  nodeData,
  definitionGraphIds = [],
  definitionIndex = 0,
  onDefinitionIndexChange,
  onAddDefinition,
  onDeleteDefinition,
  onOpenDefinition,
  canEdit = true,
  activeGraphId = null
}) => {
  const theme = useTheme();
  const total = definitionGraphIds.length;
  const currentGraphId = definitionGraphIds[definitionIndex] || null;
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
            aspectRatio: `1 / ${PREVIEW_ASPECT}`,
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

  return (
    <div style={{ marginRight: '15px' }}>
      {currentGraphId && (
        <DefinitionPreview
          key={currentGraphId}
          graphId={currentGraphId}
          nodeName={nodeName}
          nodeColor={nodeData?.color}
        />
      )}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginTop: '10px',
        marginBottom: '4px'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <PanelIconButton
            icon={ChevronLeft}
            onClick={hasPrev ? () => onDefinitionIndexChange?.(definitionIndex - 1) : undefined}
            disabled={!hasPrev}
            color={hasPrev ? theme.canvas.textPrimary : theme.canvas.textSecondary}
            title="Previous definition"
          />
          <span style={{
            minWidth: '44px',
            textAlign: 'center',
            fontFamily: "'EmOne', sans-serif",
            fontSize: '0.9rem',
            color: theme.canvas.textPrimary,
            fontVariantNumeric: 'tabular-nums'
          }}>
            {definitionIndex + 1} / {total}
          </span>
          <PanelIconButton
            icon={ChevronRight}
            onClick={hasNext ? () => onDefinitionIndexChange?.(definitionIndex + 1) : undefined}
            disabled={!hasNext}
            color={hasNext ? theme.canvas.textPrimary : theme.canvas.textSecondary}
            title="Next definition"
          />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          {/* The Web already open on the canvas has nowhere to open to. */}
          <PanelIconButton
            icon={ArrowUpFromDot}
            onClick={currentGraphId !== activeGraphId ? (e) => onOpenDefinition?.(currentGraphId, e) : undefined}
            disabled={currentGraphId === activeGraphId}
            color={currentGraphId === activeGraphId ? theme.canvas.textSecondary : theme.canvas.textPrimary}
            title={currentGraphId === activeGraphId ? 'This Web is open' : 'Open this Web'}
          />
          {canEdit && (
            <PanelIconButton
              icon={Plus}
              onClick={onAddDefinition}
              title="Add definition"
            />
          )}
          {canEdit && (
            <PanelIconButton
              icon={Trash2}
              onClick={() => onDeleteDefinition?.(currentGraphId)}
              title="Delete definition"
            />
          )}
        </div>
      </div>
    </div>
  );
};

export default WebDefinitionsSection;
