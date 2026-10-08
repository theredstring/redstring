/**
 * The scroll position, shown while a drag is edge-scrolling (see
 * edgeAutoScroll.js). A held drag moves the content under the finger with no
 * scrollbar of its own in view — the header strip has none at all, and the
 * panel's is a faint hover affordance — so this draws a thumb for the length of
 * the run and fades it after. The scroller carries `data-edge-autoscrolling`
 * while it shows, which a stylesheet can use to step its native thumb aside so
 * the two don't double up. An attribute, not a class: a scroller's className is
 * usually React's to rewrite (the panel's changes with its scroll state), and
 * would drop a class added here on its next render.
 *
 * One fixed-position node on <body>, moved with transforms: it is updated every
 * scrolling frame and must not re-render anything.
 */

export const EDGE_SCROLLING_ATTR = 'data-edge-autoscrolling';

/**
 * @param {Object} options
 * @param {'x'|'y'} options.axis
 * @param {string|(() => string)} options.color - Thumb colour, or a getter read
 *   on every show (so it follows a theme change mid-session).
 * @param {number} [options.thickness=6] - Thumb thickness, px.
 * @param {number} [options.minLength=28] - Shortest the thumb gets, px.
 * @param {number} [options.lingerMs=500] - How long it stays after the last step.
 * @param {(rect: DOMRect) => number} [options.getCrossPosition] - Where the
 *   thumb's near edge sits across the axis; defaults to just inside the
 *   scroller's far edge (its right for a list, its bottom for a strip).
 * @returns {{ show: (el: HTMLElement, bounds: {lo: number, hi: number}) => void, hide: () => void, destroy: () => void }}
 */
export function createEdgeScrollIndicator({
  axis, color, thickness = 6, minLength = 28, lingerMs = 500, getCrossPosition,
}) {
  let node = null;
  let target = null;
  let lingerTimer = null;

  const ensureNode = () => {
    if (node) return node;
    node = document.createElement('div');
    node.setAttribute('aria-hidden', 'true');
    Object.assign(node.style, {
      position: 'fixed',
      left: '0',
      top: '0',
      zIndex: '15001',
      pointerEvents: 'none',
      borderRadius: `${thickness / 2}px`,
      opacity: '0',
      transition: 'opacity 160ms ease',
      willChange: 'transform, opacity',
    });
    document.body.appendChild(node);
    return node;
  };

  const hide = () => {
    clearTimeout(lingerTimer);
    lingerTimer = null;
    if (node) node.style.opacity = '0';
    target?.removeAttribute(EDGE_SCROLLING_ATTR);
    target = null;
  };

  return {
    show(el, bounds) {
      const size = axis === 'x' ? el.scrollWidth : el.scrollHeight;
      const view = axis === 'x' ? el.clientWidth : el.clientHeight;
      const pos = axis === 'x' ? el.scrollLeft : el.scrollTop;
      const span = bounds.hi - bounds.lo;
      if (size <= view || span <= 0) return;

      const length = Math.min(span, Math.max(minLength, span * (view / size)));
      const along = bounds.lo + (span - length) * Math.max(0, Math.min(1, pos / (size - view)));
      const rect = el.getBoundingClientRect();
      const across = getCrossPosition
        ? getCrossPosition(rect)
        : (axis === 'x' ? rect.bottom : rect.right) - thickness - 3;

      const n = ensureNode();
      if (axis === 'x') {
        n.style.width = `${length}px`;
        n.style.height = `${thickness}px`;
        n.style.transform = `translate(${along}px, ${across}px)`;
      } else {
        n.style.width = `${thickness}px`;
        n.style.height = `${length}px`;
        n.style.transform = `translate(${across}px, ${along}px)`;
      }
      n.style.backgroundColor = typeof color === 'function' ? color() : color;
      n.style.opacity = '1';

      if (target !== el) {
        target?.removeAttribute(EDGE_SCROLLING_ATTR);
        target = el;
        el.setAttribute(EDGE_SCROLLING_ATTR, '');
      }
      clearTimeout(lingerTimer);
      lingerTimer = setTimeout(hide, lingerMs);
    },
    hide,
    destroy() {
      hide();
      node?.remove();
      node = null;
    },
  };
}
