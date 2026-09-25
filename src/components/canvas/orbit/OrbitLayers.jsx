/**
 * The semantic orbit's HTML scrim and its own <svg> layer above the canvas
 * (moved verbatim from NodeCanvas): the focus node and its overlay portal into
 * the layer, so the scrim can dim the graph behind them.
 */
import { Profiler } from 'react';
import { onRenderProbe } from '../../../utils/perf/renderProbe.js';
import { ORBIT_SCRIM_BLUR_PX, ORBIT_SCRIM_COLOR } from './orbitConstants.js';

export default function OrbitLayers({ ctx }) {
  const {
    semanticOrbitActive, canvasSize, setOverlayGroup,
  } = ctx;

  return (
    <Profiler id="OrbitLayers" onRender={onRenderProbe}>
      {/* Orbit scrim. An HTML layer above the <svg>, NOT a rect inside
          it: a translucent element inside the content group makes the
          canvas's own tiles non-opaque, so the whole graph beneath has
          to be blended instead of discarded — that is what exhausted
          the GPU tile budget in orbit mode. As a sibling layer it is a
          single flat composite on the GPU and costs essentially
          nothing. pointer-events stays off so the transparent rect
          inside the canvas keeps handling click-to-exit unchanged. */}
      {semanticOrbitActive && (() => {
        const blurPx = typeof window !== 'undefined' && window.__orbitBlur != null
          ? Number(window.__orbitBlur)
          : ORBIT_SCRIM_BLUR_PX;
        const blur = blurPx > 0 ? `blur(${blurPx}px)` : undefined;
        return (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              background: ORBIT_SCRIM_COLOR,
              backdropFilter: blur,
              WebkitBackdropFilter: blur, // Safari / iOS still need the prefix
              pointerEvents: 'none',
            }}
          />
        );
      })()}

      {/* Orbit layer. Geometry mirrors the main <svg> exactly (same
          origin, same size) and its content group carries the same
          transform, so anything portalled in here lands where it would
          have inside the canvas — just above the scrim. Only mounted
          during orbit, so normal rendering is untouched. */}
      {semanticOrbitActive && (
        <svg
          className="canvas-orbit-layer"
          width={canvasSize.width}
          height={canvasSize.height}
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            overflow: 'visible',
            // Empty space must fall through to the canvas beneath; the
            // content group re-enables hits on the shapes themselves.
            pointerEvents: 'none',
          }}
        >
          <g ref={setOverlayGroup} style={{ pointerEvents: 'auto' }} />
        </svg>
      )}

    </Profiler>
  );
}
