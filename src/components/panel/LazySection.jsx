import React, { useRef, useState, useEffect, memo } from 'react';

/**
 * Culls offscreen sections by only mounting children when the section
 * is within `rootMargin` of the scroll viewport. When not visible,
 * renders a placeholder div preserving the estimated height so
 * scroll position stays stable.
 */
const LazySection = ({ children, estimatedHeight, className, style }) => {
  const ref = useRef(null);
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => setIsVisible(entry.isIntersecting),
      { rootMargin: '300px 0px' } // start rendering 300px before entering viewport
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      className={className}
      style={{
        ...style,
        minHeight: isVisible ? undefined : estimatedHeight,
      }}
    >
      {isVisible ? children : null}
    </div>
  );
};

export default memo(LazySection);
