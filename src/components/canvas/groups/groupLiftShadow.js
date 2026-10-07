/**
 * The shadow under a group lifted by a drag. Fast form only: stacked rects at
 * low alpha, offset down and grown a little each, painted inline with the
 * group. A CSS drop-shadow filter on a group box is what flickered big webs out
 * of raster memory (see groupElements), and a group has no affordable fancy
 * form, so the Lifted Thing Shadow setting only decides between this and none.
 *
 * Three kinds, one per thing a group draws:
 * - 'box':     a thing-group's opaque shell. Filled layers under it.
 * - 'outline': a regular group's dashed outline, which has nothing inside it
 *              to cast a filled shadow, so the layers are the outline itself,
 *              offset and stroked wider instead of grown.
 * - 'pill':    a regular group's title pill. Filled, like 'box'.
 *
 * The geometry lives here so the render and the drag (which rewrites a group's
 * box every frame) place the same shadow for the same box.
 */

/** Canvas units. Sized against the drop-shadow(0 8px 16px) the groups once wore. */
export const GROUP_LIFT_SHADOW_LAYERS = [
  { dy: 10, spread: 2, alpha: 0.08 },
  { dy: 10, spread: 6, alpha: 0.08 },
  { dy: 10, spread: 11, alpha: 0.07 },
  { dy: 10, spread: 17, alpha: 0.05 },
];

/** Whether a dragged group draws its shadow under the Lifted Thing Shadow setting. */
export const groupLiftShadowOn = (liftedThingShadow) => liftedThingShadow !== 'off';

/**
 * One layer's rect for a box {x, y, w, h}. For 'outline' the box keeps its size
 * and the spread goes into the stroke width (see strokeWidth below).
 */
export function groupLiftShadowRect(kind, box, { dy, spread }) {
  if (kind === 'outline') return { x: box.x, y: box.y + dy, width: box.w, height: box.h };
  return { x: box.x - spread, y: box.y - spread + dy, width: box.w + spread * 2, height: box.h + spread * 2 };
}

/**
 * Move a rendered shadow to a new box: the drag's per-frame counterpart of the
 * render. Each layer carries its own dy and spread on data attributes.
 * @param {SVGGElement|null} shadowG the `[data-group-shadow]` wrapper
 */
export function placeGroupLiftShadow(shadowG, box) {
  if (!shadowG) return;
  const kind = shadowG.getAttribute('data-group-shadow');
  const rects = shadowG.children;
  for (let i = 0; i < rects.length; i++) {
    const el = rects[i];
    const r = groupLiftShadowRect(kind, box, {
      dy: parseFloat(el.getAttribute('data-dy')) || 0,
      spread: parseFloat(el.getAttribute('data-spread')) || 0,
    });
    el.setAttribute('x', r.x);
    el.setAttribute('y', r.y);
    el.setAttribute('width', r.width);
    el.setAttribute('height', r.height);
  }
}
