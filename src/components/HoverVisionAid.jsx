import React, { useState, useEffect, useRef, useMemo } from 'react';
import UniversalNodeRenderer from '../UniversalNodeRenderer';
import { RENDERER_PRESETS } from '../UniversalNodeRenderer.presets';
import { getNodeDimensions } from '../utils.js';
import { measureTextWidth } from '../services/textMeasurement.js';
import useGraphStore from '../store/graphStore.js';

// Minecraft-toolbar-style timing: after the pointer leaves, hold the preview at
// full opacity for PREFADE_MS, then fade it out over FADE_MS. The preview fades
// IN over FADE_IN_MS (deliberately quicker than the fade-out) when it first
// appears. Switching between two already-visible subjects stays an instant swap.
const PREFADE_MS = 250;
const FADE_MS = 250;
const FADE_IN_MS = 120;

// The preview exists to make small (zoomed-out) nodes legible. Once the user is
// zoomed in far enough that on-canvas node text is already readable, it becomes
// redundant. Default canvas zoom is 1.0 (comfortably readable); the aid is shown
// only once you zoom out past ZOOM_HIDE_THRESHOLD, where text starts to get small.
// It's a hard on/off threshold — opacity does NOT track the zoom level — but it
// fades over ZOOM_FADE_MS when crossing. Runs orthogonally to the hover fade
// above (nested opacity) so the two don't fight each other.
const ZOOM_HIDE_THRESHOLD = 0.25;
const ZOOM_FADE_MS = 200;

// Neutral text settings so the hover preview renders a "standard" node/connection
// regardless of the user's global font-size / node-size / connection-width sliders.
const STANDARD_TEXT_SETTINGS = { fontSize: 1, lineSpacing: 1, nodeScale: 1, connectionWidth: 1 };

// The "Hover Preview Size" slider is a relative multiplier around a sensible
// baseline: 1x on the slider = HOVER_PREVIEW_BASE_SCALE actual scale. Keeping the
// slider centered on 1x (rather than exposing the raw 0.6 factor) makes the
// default read as "normal" while still letting users scale up or down from there.
const HOVER_PREVIEW_BASE_SCALE = 0.66;

/**
 * HoverVisionAid displays a high-fidelity preview of nodes or connections
 * when the user hovers over elements on the canvas.
 *
 * SCALING FIX: Uses standard getNodeDimensions(node, false) to avoid massive square mode.
 *
 * The live hover props feed a small internal state machine that decouples what
 * is *displayed* from what is currently hovered, so the preview can linger and
 * fade after the pointer leaves, quick-fade in when it first appears, and swap
 * instantly between subjects that are already on screen.
 */
const HoverVisionAid = ({
  hoveredNode,
  hoveredConnection,
  activePieMenuItem,
  headerHeight = 60,
  verticalOffset = -25,
  zoomLevel = 1
}) => {
  const showHoverPreview = useGraphStore((state) => state.showHoverPreview ?? true);
  const hoverPreviewZoomOnly = useGraphStore((state) => state.hoverPreviewZoomOnly ?? true);
  const hoverPreviewSize = useGraphStore((state) => state.hoverPreviewSize ?? 1.0);

  // On no-mouse (touch) devices there is no real hover — a tap would otherwise pop this
  // preview up unexpectedly, so suppress the node/connection hover previews entirely.
  // (The pie-menu item label is kept; it's driven by the pie menu, not stray hovers.)
  const noHoverDevice = typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia('(hover: none)').matches;

  // Normalize the current live hover into a single "subject" (or null). The
  // `key` uniquely identifies the subject so we can tell "same thing" from
  // "different thing" across renders regardless of object identity.
  const liveSubject = useMemo(() => {
    if (!showHoverPreview) return null;

    const hasConnection = Boolean(hoveredConnection?.source && hoveredConnection?.target);
    const hasNode = Boolean(!hasConnection && hoveredNode);
    const hasItem = Boolean(!hasConnection && !hasNode && activePieMenuItem);

    if (noHoverDevice && !hasItem) return null;

    if (hasConnection) {
      return {
        kind: 'connection',
        key: `c:${hoveredConnection.id}:${hoveredConnection.source.id}:${hoveredConnection.target.id}`,
        connection: hoveredConnection
      };
    }
    if (hasNode) {
      return { kind: 'node', key: `n:${hoveredNode.id}`, node: hoveredNode };
    }
    if (hasItem) {
      // Include the label in the key (not just the id): some pie items (e.g. the
      // size cycler) keep a stable id but change their label on click, and the
      // display is gated on this key. Keying on label too lets the chip text
      // update in place — an instant swap since the chip is already visible.
      return { kind: 'item', key: `i:${activePieMenuItem.id ?? ''}:${activePieMenuItem.label}`, item: activePieMenuItem };
    }
    return null;
  }, [showHoverPreview, noHoverDevice, hoveredConnection, hoveredNode, activePieMenuItem]);

  const targetKey = liveSubject?.key ?? '';

  // Keep the latest subject readable inside the (key-gated) effect without
  // making the effect fire on every unrelated re-render.
  const targetRef = useRef(liveSubject);
  targetRef.current = liveSubject;

  // What is actually rendered right now — lags the live hover during fade-out.
  const [displayed, setDisplayed] = useState(null);
  const displayedRef = useRef(null);
  // Fade style applied to the container. transition:'none' means instant snaps.
  const [fadeStyle, setFadeStyle] = useState({ opacity: 1, transition: 'none' });

  const prefadeTimer = useRef(null);
  const fadeTimer = useRef(null);
  const fadeInRaf = useRef(null);

  useEffect(() => {
    const clearTimers = () => {
      if (prefadeTimer.current) { clearTimeout(prefadeTimer.current); prefadeTimer.current = null; }
      if (fadeTimer.current) { clearTimeout(fadeTimer.current); fadeTimer.current = null; }
      if (fadeInRaf.current) { cancelAnimationFrame(fadeInRaf.current); fadeInRaf.current = null; }
    };

    const subject = targetRef.current;

    if (subject) {
      // Hovering something: cancel any pending hold/fade and show the subject.
      // If it was already fully on screen (switching subjects, or re-hovering
      // during the hold), swap content instantly at full opacity. If it was
      // absent or mid-fade-out, quick-fade it in (FADE_IN_MS < FADE_MS).
      const wasVisible = Boolean(displayedRef.current) && !fadeTimer.current;
      clearTimers();
      displayedRef.current = subject;
      setDisplayed(subject);
      if (wasVisible) {
        setFadeStyle({ opacity: 1, transition: 'none' });
      } else {
        // Start transparent, then transition to full opacity on the next frame
        // so the browser has a painted 0-opacity frame to animate from.
        setFadeStyle({ opacity: 0, transition: 'none' });
        fadeInRaf.current = requestAnimationFrame(() => {
          fadeInRaf.current = requestAnimationFrame(() => {
            fadeInRaf.current = null;
            setFadeStyle({ opacity: 1, transition: `opacity ${FADE_IN_MS}ms ease` });
          });
        });
      }
      return;
    }

    // Pointer left. Nothing displayed → nothing to do.
    if (!displayedRef.current) return;

    // Hold at full opacity, then fade out.
    clearTimers();
    prefadeTimer.current = setTimeout(() => {
      prefadeTimer.current = null;
      setFadeStyle({ opacity: 0, transition: `opacity ${FADE_MS}ms ease` });
      fadeTimer.current = setTimeout(() => {
        fadeTimer.current = null;
        displayedRef.current = null;
        setDisplayed(null);
        setFadeStyle({ opacity: 1, transition: 'none' });
      }, FADE_MS);
    }, PREFADE_MS);
  }, [targetKey]);

  // Clean up timers on unmount.
  useEffect(() => () => {
    if (prefadeTimer.current) clearTimeout(prefadeTimer.current);
    if (fadeTimer.current) clearTimeout(fadeTimer.current);
    if (fadeInRaf.current) cancelAnimationFrame(fadeInRaf.current);
  }, []);

  if (!displayed) {
    return null;
  }

  const isConnection = displayed.kind === 'connection';
  const isNode = displayed.kind === 'node';
  const isItem = displayed.kind === 'item';

  // Zoom-based visibility: a hard on/off threshold (shown only when zoomed out
  // enough that text gets small), not a ramp. Applied to a nested wrapper so it
  // fades independently of, and simultaneously with, the hover fade-in/out.
  // Gated by the "zoom only" setting (on by default): when off, node/connection
  // previews show at any zoom. Pie-menu item chips are always exempt — they're a
  // button label, not a legibility aid, so they show at every zoom level.
  const zoomGated = hoverPreviewZoomOnly && !isItem && zoomLevel > ZOOM_HIDE_THRESHOLD;
  const zoomOpacity = zoomGated ? 0 : 1;

  // Pre-resizable fixed preview dimensions (reverted from node-size scaling).
  const CONNECTION_PREVIEW_HEIGHT = 180;
  const connectionLabelFont = '28px "EmOne", sans-serif';

  // getNodeDimensions inflates node geometry by 1.4× globally (utils.js, for the
  // bigger canvas nodes). The previews want the pre-resizable (0.8.2) box size, so
  // divide that factor back out before feeding boxes to the renderer.
  const LEGACY_DIM_SCALE = 1 / 1.4;

  let content = null;

  // Hover Preview Size setting scales node and connection previews: slider 1x maps
  // to HOVER_PREVIEW_BASE_SCALE actual scale. The pie-menu item label is a fixed
  // text pill, not a node preview, so it renders at its original full size (1.0)
  // and ignores the slider entirely (chips must not scale down). Connection previews
  // get a small extra boost so the triplet reads a touch larger than a lone node.
  const CONNECTION_PREVIEW_SCALE_BOOST = 1.1;
  const previewScale = isItem
    ? 1.0
    : hoverPreviewSize * HOVER_PREVIEW_BASE_SCALE * (isConnection ? CONNECTION_PREVIEW_SCALE_BOOST : 1);

  const containerStyle = {
    position: 'absolute',
    top: headerHeight + verticalOffset,
    left: '50%',
    transform: `translateX(-50%) scale(${previewScale})`,
    transformOrigin: 'top center',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '10px',
    pointerEvents: 'none',
    zIndex: 10,
    width: 'auto',
    maxWidth: '94vw',
    opacity: fadeStyle.opacity,
    transition: fadeStyle.transition,
    willChange: 'opacity'
  };

  if (isConnection) {
    const hoveredConn = displayed.connection;
    const isSelfLoop = hoveredConn.source.id === hoveredConn.target.id;
    const sourceDims = getNodeDimensions(hoveredConn.source, false, null, 39, STANDARD_TEXT_SETTINGS);
    const targetDims = getNodeDimensions(hoveredConn.target, false, null, 39, STANDARD_TEXT_SETTINGS);

    const nodes = isSelfLoop
      ? [
          {
            ...hoveredConn.source,
            x: 0,
            y: 0,
            width: Math.max(sourceDims.currentWidth * LEGACY_DIM_SCALE, 100),
            height: Math.max(sourceDims.currentHeight * LEGACY_DIM_SCALE, 96)
          }
        ]
      : [
          {
            ...hoveredConn.source,
            x: 0,
            y: 0,
            width: Math.max(sourceDims.currentWidth * LEGACY_DIM_SCALE, 100),
            height: Math.max(sourceDims.currentHeight * LEGACY_DIM_SCALE, 96)
          },
          {
            ...hoveredConn.target,
            x: 0,
            y: 0,
            width: Math.max(targetDims.currentWidth * LEGACY_DIM_SCALE, 100),
            height: Math.max(targetDims.currentHeight * LEGACY_DIM_SCALE, 96)
          }
        ];

    const connections = [
      {
        id: hoveredConn.id,
        sourceId: hoveredConn.source.id,
        destinationId: hoveredConn.target.id,
        connectionName: hoveredConn.name || 'Connection',
        color: hoveredConn.color,
        definitionNodeIds: hoveredConn.definitionNodeIds,
        typeNodeId: hoveredConn.typeNodeId,
        directionality: hoveredConn.directionality
      }
    ];

    // Port sizing formulas EXACTLY from UnifiedBottomControlPanel.jsx
    // Self-loops render as two side-by-side copies inside UniversalNodeRenderer,
    // so budget width for a 2-node layout even though `nodes` holds one entry.
    const baseSpacing = 200;
    const layoutNodeCount = isSelfLoop ? 2 : nodes.length;
    const nodeSpacing = nodes.reduce((sum, n) => sum + (n.width * 0.4), 0) * (isSelfLoop ? 2 : 1)
                      + (layoutNodeCount * 90);

    const longestConnectionLabelWidth = connections.reduce((max, conn) => {
      const width = measureTextWidth(conn.connectionName, connectionLabelFont);
      return Math.max(max, width);
    }, 0);

    const connectionLabelSpace = Math.max(
      320,
      Math.ceil(longestConnectionLabelWidth + 220)
    );

    const calculatedWidth = Math.min(
      1800,
      baseSpacing + nodeSpacing + connectionLabelSpace
    );

    const dynamicMinHorizontalSpacing = Math.round(Math.max(
      120,
      Math.min(
        connectionLabelSpace - 80,
        400
      )
    ) * 1.15); // Slightly more room between nodes for the connection line

    containerStyle.marginTop = -20;
    content = (
      <div style={{ display: 'inline-flex', padding: 0, borderRadius: '44px', background: 'transparent', overflow: 'visible' }}>
        <UniversalNodeRenderer
          {...RENDERER_PRESETS.CONNECTION_PANEL}
          renderContext="full"
          nodes={nodes}
          connections={connections}
          containerWidth={calculatedWidth}
          containerHeight={CONNECTION_PREVIEW_HEIGHT}
          minHorizontalSpacing={dynamicMinHorizontalSpacing}
          cornerRadiusMultiplier={44}
          connectionFontScale={1.2}
          connectionStrokeScale={0.7}
          ignoreGlobalScale={true}
          interactive={false}
          showHoverEffects={false}
          showConnectionDots={true}
          backgroundColor="transparent"
        />
      </div>
    );
  } else if (isNode) {
    const hoveredNodeData = displayed.node;
    // 1. Prepare node with REAL dimensions (non-preview)
    const dims = getNodeDimensions(hoveredNodeData, false, null, 39, STANDARD_TEXT_SETTINGS);
    const nodeWidth = Math.max(dims.currentWidth * LEGACY_DIM_SCALE, 100);
    const nodeHeight = Math.max(dims.currentHeight * LEGACY_DIM_SCALE, 96);

    // 2. Calculate container to fit (sync with Control Panel logic)
    const nodeContainerWidth = Math.max(340, nodeWidth + 80);
    const nodeContainerHeight = Math.max(120, nodeHeight + 40);

    containerStyle.marginTop = -18;
    content = (
      <div style={{ display: 'inline-flex', padding: 0, borderRadius: '36px', background: 'transparent', overflow: 'visible' }}>
        <UniversalNodeRenderer
          renderContext="full"
          nodes={[
            {
              ...hoveredNodeData,
              x: 0,
              y: 0,
              width: nodeWidth,
              height: nodeHeight
            }
          ]}
          connections={[]}
          containerWidth={nodeContainerWidth}
          containerHeight={nodeContainerHeight}
          padding={16}
          scaleMode="fit"
          cornerRadiusMultiplier={44}
          ignoreGlobalScale={true}
          interactive={false}
          showHoverEffects={false}
          backgroundColor="transparent"
        />
      </div>
    );
  } else if (isItem) {
    const pieMenuHeight = 36;
    const pieMenuPaddingX = 14;
    containerStyle.marginTop = -2;
    content = (
      <div
        style={{
          minWidth: 40,
          height: pieMenuHeight,
          borderRadius: pieMenuHeight / 2,
          border: '2px solid maroon',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontFamily: "'EmOne', sans-serif",
          fontSize: '14px',
          fontWeight: 700,
          color: 'maroon',
          background: '#DEDADA',
          letterSpacing: '0.04em',
          padding: `0 ${pieMenuPaddingX}px`,
          boxShadow: '0 2px 8px rgba(0, 0, 0, 0.12)'
        }}
      >
        {displayed.item.label}
      </div>
    );
  }

  return (
    <div className="hover-vision-aid" style={containerStyle}>
      {/* Keyed by subject so switching preview (e.g. connection → node) remounts
          the renderer at its final size — no width/height resize tween.
          Zoom fade lives on this wrapper: its opacity multiplies with the hover
          fade on the parent (nested opacity), so zooming in fades the aid out
          without disturbing the hover-driven fade-in/out. */}
      <div
        key={displayed.key}
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          opacity: zoomOpacity,
          transition: `opacity ${ZOOM_FADE_MS}ms ease`,
          willChange: 'opacity'
        }}
      >
        {content}
      </div>
    </div>
  );
};

export default HoverVisionAid;
