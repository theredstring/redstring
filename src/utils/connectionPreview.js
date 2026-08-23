/**
 * Shared recipe for the "node preview" representations that render through
 * UniversalNodeRenderer outside the canvas: the connection control panel, the
 * hover vision aid, and the right panel's Connections list.
 *
 * All three draw the same picture (subject —predicate→ object) and must read as
 * the same node the canvas draws. Before this module the recipe was copy-pasted
 * (the control panel's comments literally said "matching HoverVisionAid" and
 * "Use EXACT same logic as ConnectionBrowser") and the panel list had drifted
 * off it entirely. Keep the recipe here so the representations stay in parity;
 * the only thing that legitimately differs between them is the size floor.
 */
import { getNodeDimensions } from '../utils.js';

// Neutral text settings so previews render at a "standard" size regardless of
// the user's global font/node-size/connection sliders.
export const STANDARD_TEXT_SETTINGS = { fontSize: 1, lineSpacing: 1, nodeScale: 1, connectionWidth: 1 };

// getNodeDimensions inflates node geometry by 1.4× globally (utils.js, for the
// bigger canvas nodes). The previews want the pre-resizable (0.8.2) box size, so
// divide that factor back out before feeding boxes to the renderer.
export const LEGACY_DIM_SCALE = 1 / 1.4;

/**
 * Node-box floors per context. Without a floor, getNodeDimensions returns
 * compact boxes for short names → small text, and a height under ~88px makes the
 * corner radius cap at height/2 (a full pill instead of a rounded rectangle).
 *
 * cornerRadius is kept below height/2 in every entry so the boxes stay rounded
 * rectangles at the same ratio (~0.45) the canvas node uses.
 */
export const CONNECTION_PREVIEW_FLOORS = {
  // Canvas bottom control panel: rendered at full nodeScale.
  controlPanel: { width: 130, height: 84, cornerRadius: 38 },
  // Hover vision aid: also downscaled ~0.6× by CSS, hence the taller box.
  hover: { width: 100, height: 96, cornerRadius: 44 },
  // Right panel Connections list: a ~280px-wide column can't fit two 130px
  // boxes plus a predicate label, so this is the deliberate concession — same
  // recipe and proportions, smaller box.
  panelList: { width: 110, height: 72, cornerRadius: 32 }
};

/**
 * Size a set of preview nodes the way the canvas sizes them: measure the name at
 * the canvas font via getNodeDimensions, divide out the 1.4× inflation, then
 * floor.
 *
 * x/y are pinned to 0 so the renderer takes the explicit-box branch rather than
 * looking the id up in the active graph's instances (preview ids are often real
 * instance ids, and we never want live canvas geometry leaking into a preview).
 * Layout position is assigned by the renderer's horizontal-align pass anyway.
 *
 * @param {Array<object>} nodes - node-ish objects ({ id, name, color, ... })
 * @param {{width:number,height:number}} floors - entry from CONNECTION_PREVIEW_FLOORS
 * @returns {Array<object>} nodes with x/y/width/height set
 */
export function buildConnectionPreviewNodes(nodes, floors) {
  return nodes.map((node) => {
    const dims = getNodeDimensions(node, false, null, 39, STANDARD_TEXT_SETTINGS);
    return {
      ...node,
      x: 0,
      y: 0,
      width: Math.max(dims.currentWidth * LEGACY_DIM_SCALE, floors.width),
      height: Math.max(dims.currentHeight * LEGACY_DIM_SCALE, floors.height)
    };
  });
}

/**
 * The UniversalNodeRenderer props every preview representation shares. Spread
 * this after a RENDERER_PRESETS entry and before any per-consumer overrides.
 *
 * @param {{cornerRadius:number}} floors - entry from CONNECTION_PREVIEW_FLOORS
 */
export function connectionPreviewRendererProps(floors) {
  return {
    renderContext: 'full',
    ignoreGlobalScale: true,
    cornerRadiusMultiplier: floors.cornerRadius
  };
}
