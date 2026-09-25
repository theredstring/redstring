/**
 * The hover vision aid and the controller crosshair, over the canvas (moved
 * verbatim from NodeCanvas).
 */
import { Profiler } from 'react';
import { onRenderProbe } from '../../../utils/perf/renderProbe.js';
import HoverVisionAidLayer from './HoverVisionAidLayer.jsx';
import GamepadCrosshair from '../../GamepadCrosshair.jsx';

export default function CanvasHud({ ctx }) {
  const {
    headerHeight, zoomLevel, gamepadActive, viewportBounds, gamepadCrosshairScale,
  } = ctx;

  return (
    <Profiler id="CanvasHud" onRender={onRenderProbe}>
      <HoverVisionAidLayer headerHeight={headerHeight} zoomLevel={zoomLevel} />

      {/* The controller's cursor. Pinned to the absolute screen centre
          so panels opening and closing never move it, and the zoom is
          anchored on the same point, so the world scales under it
          without sliding. */}
      <GamepadCrosshair
        visible={gamepadActive}
        viewportBounds={viewportBounds}
        headerHeight={headerHeight}
        scale={gamepadCrosshairScale}
      />
    </Profiler>
  );
}
