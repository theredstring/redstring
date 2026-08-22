export const isTouchDevice = () => {
    if (typeof window === 'undefined') return false;
    return 'ontouchstart' in window || navigator.maxTouchPoints > 0 || navigator.msMaxTouchPoints > 0;
};

export const likelyTouch = () => {
    if (typeof navigator !== 'undefined' && (navigator.maxTouchPoints > 0 || navigator.msMaxTouchPoints > 0)) return true;
    if (typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(pointer: coarse)').matches) return true;
    return false;
};

/**
 * True when the primary input cannot hover at all — a phone or tablet, but NOT
 * a touchscreen laptop, where a mouse is still present and hover works fine.
 *
 * This is the right test for "does hover-driven UI work here", and it is
 * strictly narrower than likelyTouch()/isTouchDevice(), which both answer "can
 * this device receive touch" and are true on hybrid machines.
 */
export const hasNoHover = () => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
    return window.matchMedia('(hover: none)').matches;
};

export const normalizeTouchEvent = (e) => {
    // For touch end events, changedTouches has the final position where finger lifted
    const t = e.touches?.[0] || e.changedTouches?.[0];
    if (t) {
        return { clientX: t.clientX, clientY: t.clientY };
    }
    return null;
};
