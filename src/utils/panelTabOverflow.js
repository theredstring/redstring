/**
 * How the left panel's view-tab strip behaves when it runs out of room.
 *
 * The tabs are fixed-width squares, so a narrow panel simply cannot show all of
 * them. Rather than squash or clip, the strip collapses to two: the view you are
 * in, and an ellipsis holding everything else.
 *
 * Pure and separate from Panel.jsx because the collapsed strip has to survive
 * views being opened from ELSEWHERE — "Ask The Wizard" from the canvas, a
 * federation prompt, a history request — which change the active view without
 * touching the strip. Those are the cases worth testing.
 */

/** Every tab in a panel header is this square. */
export const PANEL_TAB_WIDTH = 50;

/**
 * @param {object} args
 * @param {string[]} args.tabKeys - Every view tab, in strip order.
 * @param {string} args.activeKey - The view currently showing.
 * @param {number|null} args.stripWidth - Measured strip width; null before the
 *   first measurement, which reads as "assume everything fits" so the strip does
 *   not flash an ellipsis on load.
 * @param {number} [args.reservedWidth] - Width at the strip's leading edge that
 *   is covered by something else (the panel's own toggle button overlays it).
 * @param {number} [args.tabWidth]
 * @returns {{ hiddenKeys: Set<string>, overflowKeys: string[], collapsed: boolean }}
 *   `overflowKeys` is what the ellipsis menu lists — including the active view
 *   when even it could not be kept.
 */
export function resolveTabOverflow({
  tabKeys,
  activeKey,
  stripWidth,
  reservedWidth = 0,
  tabWidth = PANEL_TAB_WIDTH,
}) {
  const total = tabKeys.length;
  if (!total) return { hiddenKeys: new Set(), overflowKeys: [], collapsed: false };

  const usable = stripWidth == null ? null : stripWidth - reservedWidth;
  const fit = usable == null ? total : Math.floor(usable / tabWidth);
  if (fit >= total) return { hiddenKeys: new Set(), overflowKeys: [], collapsed: false };

  // Collapsed is all-or-two: the strip becomes exactly "where you are" plus the
  // way to everywhere else. No partial row of whichever tabs happened to fit —
  // at these widths that is just noise around the one tab that matters. Under
  // two slots even that goes, and the strip is the ellipsis alone.
  const keepActive = fit >= 2 && tabKeys.includes(activeKey);
  const hiddenKeys = new Set(tabKeys.filter((key) => !(keepActive && key === activeKey)));
  return {
    hiddenKeys,
    overflowKeys: tabKeys.filter((key) => hiddenKeys.has(key)),
    collapsed: true,
  };
}
