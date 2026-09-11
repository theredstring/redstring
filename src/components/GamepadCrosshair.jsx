import React from 'react';

/**
 * GamepadCrosshair — the controller's cursor.
 *
 * A Minecraft-style reticle pinned to the centre of the USABLE viewport, not
 * of the window. Panels, the header and the TypeList all eat into the canvas,
 * and `viewportBounds` already accounts for all three, so the crosshair stays
 * centred in what the user can actually see as panels open and close — and it
 * sits exactly where the zoom is anchored, so zooming never slides the world
 * out from under it.
 *
 * Rendered as a sibling of the canvas <svg> inside `.canvas-area`, which is
 * `position: relative`, so it is positioned against the same box the mouse
 * coordinates are measured in.
 */

// Half the length of each arm, in px. Big enough to aim with, small enough not
// to obscure a node label underneath it.
const ARM = 9;
const THICKNESS = 2;
const OPACITY = 0.5;

const GamepadCrosshair = ({ visible, viewportBounds, headerHeight = 0 }) => {
  if (!visible || !viewportBounds) return null;

  // `.canvas-area` starts below the header and to the right of the left panel,
  // so convert the window-space bounds into offsets within that box.
  const centerX = viewportBounds.width / 2;
  const centerY = (viewportBounds.height / 2) + (viewportBounds.y - headerHeight);

  // Two bars rather than an SVG: fewer nodes, no rasterisation, and it stays
  // pin-sharp at any devicePixelRatio.
  const bar = {
    position: 'absolute',
    backgroundColor: '#260000',
    opacity: OPACITY,
    borderRadius: 1,
    pointerEvents: 'none',
  };

  return (
    <div
      className="gamepad-crosshair"
      aria-hidden="true"
      style={{
        position: 'absolute',
        inset: 0,
        pointerEvents: 'none',
        zIndex: 10,
      }}
    >
      <div
        style={{
          ...bar,
          left: centerX - ARM,
          top: centerY - THICKNESS / 2,
          width: ARM * 2,
          height: THICKNESS,
        }}
      />
      <div
        style={{
          ...bar,
          left: centerX - THICKNESS / 2,
          top: centerY - ARM,
          width: THICKNESS,
          height: ARM * 2,
        }}
      />
    </div>
  );
};

export default GamepadCrosshair;
