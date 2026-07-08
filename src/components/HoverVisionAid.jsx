import React, { useState, useEffect, useRef, useMemo } from 'react';
import UniversalNodeRenderer from '../UniversalNodeRenderer';
import { RENDERER_PRESETS } from '../UniversalNodeRenderer.presets';
import { getNodeDimensions } from '../utils.js';
import { measureTextWidth } from '../services/textMeasurement.js';
import useGraphStore from '../store/graphStore.js';

// Minecraft-toolbar-style timing: after the pointer leaves, hold the preview at
// full opacity for PREFADE_MS, then fade it out over FADE_MS. Any new hover
// during the hold or fade snaps back to full opacity and switches instantly.
const PREFADE_MS = 250;
const FADE_MS = 250;

/**
 * HoverVisionAid displays a high-fidelity preview of nodes or connections
 * when the user hovers over elements on the canvas.
 *
 * SCALING FIX: Uses standard getNodeDimensions(node, false) to avoid massive square mode.
 *
 * The live hover props feed a small internal state machine that decouples what
 * is *displayed* from what is currently hovered, so the preview can linger and
 * fade after the pointer leaves without any fade-in or resize animation on the
 * way back in.
 */
const HoverVisionAid = ({
  hoveredNode,
  hoveredConnection,
  activePieMenuItem,
  headerHeight = 60,
  verticalOffset = -25
}) => {
  const showHoverPreview = useGraphStore((state) => state.showHoverPreview ?? true);
  const hoverPreviewSize = useGraphStore((state) => state.hoverPreviewSize ?? 0.6);

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
      return { kind: 'item', key: `i:${activePieMenuItem.id ?? activePieMenuItem.label}`, item: activePieMenuItem };
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

  useEffect(() => {
    const clearTimers = () => {
      if (prefadeTimer.current) { clearTimeout(prefadeTimer.current); prefadeTimer.current = null; }
      if (fadeTimer.current) { clearTimeout(fadeTimer.current); fadeTimer.current = null; }
    };

    const subject = targetRef.current;

    if (subject) {
      // Hovering something: cancel any pending hold/fade, snap to full opacity,
      // and switch content instantly. If it's the same subject we were already
      // showing (re-hover during the hold), the keyed wrapper below doesn't
      // remount — nothing visibly changes, we just kill the timer.
      clearTimers();
      displayedRef.current = subject;
      setDisplayed(subject);
      setFadeStyle({ opacity: 1, transition: 'none' });
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
  }, []);

  if (!displayed) {
    return null;
  }

  const isConnection = displayed.kind === 'connection';
  const isNode = displayed.kind === 'node';
  const isItem = displayed.kind === 'item';

  let content = null;

  // Hover Preview Size setting is the direct scale (default 0.6x) for node and
  // connection previews. The pie-menu item label is a fixed text pill, not a node
  // preview, so it renders at its original full size (1.0) and ignores the slider.
  const previewScale = isItem ? 1.0 : hoverPreviewSize;

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
    const sourceDims = getNodeDimensions(hoveredConn.source, false);
    const targetDims = getNodeDimensions(hoveredConn.target, false);

    // Use natural node widths (252px+ from canvas) but cap height so tall image
    // nodes don't make the preview excessively tall.
    const sourceW = Math.max(sourceDims.currentWidth, 220);
    const sourceH = Math.min(Math.max(sourceDims.currentHeight, 96), 200);
    const targetW = Math.max(targetDims.currentWidth, 220);
    const targetH = Math.min(Math.max(targetDims.currentHeight, 96), 200);

    const nodes = isSelfLoop
      ? [{ ...hoveredConn.source, x: 0, y: 0, width: sourceW, height: sourceH }]
      : [
          { ...hoveredConn.source, x: 0, y: 0, width: sourceW, height: sourceH },
          { ...hoveredConn.target, x: 0, y: 0, width: targetW, height: targetH }
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

    // The renderer applies 0.8× to minHorizontalSpacing for 2-3 node layouts.
    // Pre-compensate: connectionGap = targetGap / 0.8 → actual SVG gap = targetGap.
    // Target at least 300px (225px visible at CSS 0.75) or 2× the longest label word.
    const renderFont = '24px "EmOne", sans-serif';
    const longestWordWidth = connections.reduce((max, conn) => {
      const name = conn.connectionName || 'Connection';
      const wordMax = name.split(' ').reduce((wmax, w) => Math.max(wmax, measureTextWidth(w, renderFont)), 0);
      return Math.max(max, wordMax);
    }, 0);

    // Keep the gap modest — a fixed-scale preview looks ridiculous if the gap
    // stretches out for long labels, so cap it rather than letting it grow freely.
    const targetGap = Math.min(460, Math.max(320, longestWordWidth * 1.6));
    const connectionGap = Math.ceil(targetGap / 0.8);

    // Size container generously so nodeScale would be 1.0 without the cap.
    // maxNodeScale={0.8} on the renderer then explicitly scales nodes — and
    // proportionally their fonts, padding, and corner radii — to 80%, freeing
    // the remaining space as additional gap for the connection label.
    const maxNodeHeight = Math.max(...nodes.map(n => n.height));
    const connectionContainerHeight = maxNodeHeight + 40;
    const totalNodeWidth = nodes.reduce((sum, n) => sum + n.width, 0) * (isSelfLoop ? 2 : 1);
    const calculatedWidth = Math.max(700, totalNodeWidth + connectionGap + 80);

    containerStyle.marginTop = -20;
    content = (
      <div style={{ display: 'inline-flex', padding: 0, borderRadius: '44px', background: 'transparent', overflow: 'visible' }}>
        <UniversalNodeRenderer
          {...RENDERER_PRESETS.CONNECTION_PANEL}
          renderContext="full"
          nodes={nodes}
          connections={connections}
          containerWidth={calculatedWidth}
          containerHeight={connectionContainerHeight}
          minHorizontalSpacing={connectionGap}
          cornerRadiusMultiplier={56}
          maxNodeScale={0.7}
          connectionFontScale={1.6}
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
    const dims = getNodeDimensions(hoveredNodeData, false);
    const nodeWidth = Math.max(dims.currentWidth, 220);
    const nodeHeight = Math.max(dims.currentHeight, 96);

    // 2. Tight container — nodes are now ~252px wide at 1x so we cap height to
    //    prevent the preview growing proportionally with the larger baseline.
    const nodeContainerWidth = Math.max(300, nodeWidth + 48);
    const nodeContainerHeight = Math.max(100, Math.min(200, nodeHeight + 24));

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
          cornerRadiusMultiplier={56}
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
          minWidth: 140,
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
          the renderer at its final size — no width/height resize tween. */}
      <div key={displayed.key} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
        {content}
      </div>
    </div>
  );
};

export default HoverVisionAid;
