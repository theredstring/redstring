/**
 * The orbit dim rect inside the canvas (moved verbatim from NodeCanvas): the
 * click target that exits orbit, dimmed or transparent per ENABLE_ORBIT_DIM.
 */
import { Profiler } from 'react';
import { onRenderProbe } from '../../../utils/perf/renderProbe.js';

export default function OrbitDimRect({ ctx }) {
  const {
    semanticOrbitActive, orbitDimRectRef, updateOrbitDimRect, ENABLE_ORBIT_DIM, canvasSize,
    orbitClickDownPos, exitOrbitMode,
  } = ctx;

  return (
    <Profiler id="OrbitDimRect" onRender={onRenderProbe}>
      {/* Dim overlay for semantic orbit mode.
          Plain SVG rect (not foreignObject) so it stays in proper paint order
          on iOS WebKit — foreignObject with backdrop-filter punches itself to
          the top of the stack and eats taps on orbit items. */}
      {semanticOrbitActive && (
        <rect
          /* Geometry is set imperatively (viewport-sized, tracks
             every pan/zoom tick) — see updateOrbitDimRect. Kept out
             of JSX so React re-renders don't clobber it. */
          ref={(el) => {
            orbitDimRectRef.current = el;
            if (el) updateOrbitDimRect();
          }}
          data-orbit-dim=""
          /* Dimming off: transparent and static at full canvas
             size — nothing to paint, nothing to blend through,
             no per-tick geometry writes, and still the click
             target that exits orbit mode. */
          {...(ENABLE_ORBIT_DIM ? null : {
            x: canvasSize.offsetX,
            y: canvasSize.offsetY,
            width: canvasSize.width,
            height: canvasSize.height,
          })}
          fill={ENABLE_ORBIT_DIM ? 'rgba(0, 0, 0, 0.7)' : 'transparent'}
          /* touchAction 'none', like the canvas surface this
             covers — every gesture here is the app's to
             interpret. It read 'manipulation' before, copied
             from a small button where handing pan and pinch
             back to the browser is harmless; on something
             spanning the whole canvas it is not. */
          style={{ cursor: 'pointer', touchAction: 'none' }}
          onMouseDown={(e) => {
            orbitClickDownPos.current = { x: e.clientX, y: e.clientY };
          }}
          onClick={(e) => {
            const down = orbitClickDownPos.current;
            orbitClickDownPos.current = null;
            // No matching mousedown means this is a synthesized click after a
            // touch gesture (pan) — ignore. Real mouse clicks always come with
            // a mousedown right before.
            if (!down) return;
            const dx = e.clientX - down.x;
            const dy = e.clientY - down.y;
            if (dx * dx + dy * dy > 25) return; // moved >5px = was a pan
            e.stopPropagation();
            exitOrbitMode();
          }}
          onTouchStart={(e) => {
            // Only a one-finger sequence can be a tap. A second finger
            // means a pinch, which is the canvas's gesture, not ours.
            const t = e.touches?.length === 1 ? e.touches[0] : null;
            orbitClickDownPos.current = t ? { x: t.clientX, y: t.clientY } : null;
          }}
          onTouchEnd={(e) => {
            const down = orbitClickDownPos.current;
            orbitClickDownPos.current = null;
            // Suppress the synthetic click that follows touchend either way,
            // so a pan-then-lift can't fall through to onClick and exit.
            if (e.cancelable) e.preventDefault();

            const t = e.changedTouches?.[0];
            const isTap = down && t
              && e.touches?.length === 0            // last finger up
              && (t.clientX - down.x) ** 2 + (t.clientY - down.y) ** 2 <= 25;

            // Deliberately does NOT stop propagation, for any outcome.
            //
            // The canvas's own touchend is where a gesture gets torn down —
            // the pinch flag cleared, pan momentum launched — and it is also
            // what removes the document-level touchmove/touchend listeners
            // that handleTouchStartCanvas attached for this gesture. Stopping
            // propagation here (which React forwards to the native event, so
            // the document listeners never fire either) meant that in orbit
            // mode none of it ran: pans lost their inertia, every touch leaked
            // a live touchmove listener, and after a pinch the pinch flag
            // stayed set, so every later touch was read as a continuing pinch
            // and panning stopped working at all.
            //
            // The canvas will read a tap here as a bare-canvas tap and clear
            // the selection, which exits orbit by way of the deselect effect.
            // Exiting explicitly as well is harmless and does not depend on
            // that chain holding.
            if (isTap) exitOrbitMode();
          }}
        />
      )}


    </Profiler>
  );
}
