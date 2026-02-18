export const isTouchDevice = () => {
    if (typeof window === 'undefined') return false;
    return 'ontouchstart' in window || navigator.maxTouchPoints > 0 || navigator.msMaxTouchPoints > 0;
};

export const likelyTouch = () => {
    if (typeof navigator !== 'undefined' && (navigator.maxTouchPoints > 0 || navigator.msMaxTouchPoints > 0)) return true;
    if (typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(pointer: coarse)').matches) return true;
    return false;
};

export const normalizeTouchEvent = (e) => {
    // For touch end events, changedTouches has the final position where finger lifted
    const t = e.touches?.[0] || e.changedTouches?.[0];
    if (t) {
        return { clientX: t.clientX, clientY: t.clientY };
    }
    return null;
};
