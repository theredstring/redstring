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

// Half the length of each arm, in px, at scale 1. Deliberately small: this
// thing sits ON the node being aimed at, not beside it, so every pixel of arm
// is a pixel of node label covered. Settings → Input scales it, because how
// big a reticle wants to be depends on the display and on how much occlusion
// the user will trade for visibility.
const ARM = 6;
// Not scaled with the arms. A bar under 2px lands on fractional device pixels
// and turns into a grey smear; above 2 it reads as a shape rather than as a
// sight. Length is what conveys size here.
const THICKNESS = 2;
const OPACITY = 0.5;

const GamepadCrosshair = ({ visible, viewportBounds, headerHeight = 0, scale = 1 }) => {
  if (!visible || !viewportBounds) return null;

  // Rounded so both arms land on whole pixels and the two bars stay visually
  // identical; a half-pixel arm antialiases one end and not the other.
  const arm = Math.max(2, Math.round(ARM * scale));

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
          left: centerX - arm,
          top: centerY - THICKNESS / 2,
          width: arm * 2,
          height: THICKNESS,
        }}
      />
      <div
        style={{
          ...bar,
          left: centerX - THICKNESS / 2,
          top: centerY - arm,
          width: THICKNESS,
          height: arm * 2,
        }}
      />
    </div>
  );
};

export default GamepadCrosshair;
