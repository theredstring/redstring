import React from 'react';
import { useDarkMode } from '../hooks/useTheme.js';
import { crosshairCenter } from '../utils/gamepadAim.js';

/**
 * GamepadCrosshair — the controller's cursor.
 *
 * A Minecraft-style reticle pinned to the ABSOLUTE centre of the screen —
 * deliberately not to the centre of the usable canvas. Panels, the header and
 * the TypeList move that second point around every time one opens, closes or
 * is resized, and the reticle is the cursor: one that relocates itself because
 * a panel appeared is one the user has to go and find again. See
 * `crosshairCenter`, which is also what the aim resolution and the zoom anchor
 * read, so all three stay on the same pixel.
 *
 * Rendered as a sibling of the canvas <svg> inside `.canvas-area`, which is
 * `position: relative`, so it is positioned against the same box the mouse
 * coordinates are measured in — hence the conversion out of app-box space
 * below.
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
  // Hook before the early return: bailing out first would change hook order
  // between a hidden and a visible crosshair.
  const darkMode = useDarkMode();

  if (!visible || !viewportBounds) return null;

  // Rounded so both arms land on whole pixels and the two bars stay visually
  // identical; a half-pixel arm antialiases one end and not the other.
  const arm = Math.max(2, Math.round(ARM * scale));

  // App-box centre → offsets within `.canvas-area`.
  //
  // The container's origin is (0, headerHeight), NOT (viewportBounds.x,
  // viewportBounds.y): the panels are position:fixed overlays and take no flow
  // space, so the canvas area is full-width and starts at the left edge of the
  // app box whatever the panels are doing. `viewportBounds.x` is the left
  // panel's width — subtracting it here is what dragged the reticle left when a
  // panel opened. Only the header has to come off, because it IS in the flow.
  // See the note above getFramingRegion in NodeCanvas for the same conversion.
  const center = crosshairCenter(viewportBounds);
  const centerX = center.x;
  const centerY = center.y - headerHeight;

  // Two bars rather than an SVG: fewer nodes, no rasterisation, and it stays
  // pin-sharp at any devicePixelRatio.
  const bar = {
    position: 'absolute',
    backgroundColor: darkMode ? '#BDB5B5' : '#260000',
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
