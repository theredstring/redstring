import React, { useState } from 'react';

/**
 * The shimmer shown while a panel image is still decoding.
 *
 * Same treatment the upload path uses for its placeholder, pulled out so a tab
 * switch and an upload read as the same "working on it" state.
 */
export const PanelImageShimmer = () => (
  <>
    <style>{`@keyframes panelImgShimmer { 0% { transform: translateY(100%); } 100% { transform: translateY(-100%); } }`}</style>
    <div style={{
      position: 'absolute',
      left: 0,
      right: 0,
      height: '60%',
      background: 'linear-gradient(to top, rgba(255,255,255,0) 0%, rgba(255,255,255,0.55) 50%, rgba(255,255,255,0) 100%)',
      animation: 'panelImgShimmer 1.2s ease-in-out infinite'
    }} />
  </>
);

/**
 * A panel image that tracks its own decode state.
 *
 * Switching right-panel tabs used to show the PREVIOUS node's image for a beat
 * before flipping to the new one. Two causes, both handled here:
 *
 *  - React reuses one <img> across tabs and only swaps `src`. The browser keeps
 *    painting the old frame until the new bytes decode, so the wrong image is
 *    on screen the whole time. Callers mount this with `key={src}`, so a new
 *    source is a new element with `isLoaded` false — the stale frame is never
 *    shown at all.
 *  - Nothing reserved the image's height, so everything below it jumped once
 *    the new image landed. The aspect ratio is known for uploads and Wikipedia
 *    thumbnails alike, so the box is sized before the bytes arrive.
 *
 * `loading="lazy"` is deliberately absent: it defers the very fetch being
 * waited on, which lengthened the blank state it was meant to help.
 *
 * @param {string} src - Resolved image URL.
 * @param {string} alt - Alt text (the node's name).
 * @param {number} [aspectRatio] - height/width, as stored on the prototype.
 */
const PanelImage = ({ src, alt, aspectRatio }) => {
  const [isLoaded, setIsLoaded] = useState(false);
  const [hasFailed, setHasFailed] = useState(false);

  // An image already in the browser cache can be `complete` before React
  // attaches onLoad, and that load event never fires — without this the
  // shimmer would sit there forever on a tab you have already visited.
  const measureRef = (node) => {
    if (node?.complete && node.naturalWidth > 0) setIsLoaded(true);
  };

  return (
    <div style={{
      width: '100%',
      overflow: 'hidden',
      borderRadius: '6px',
      position: 'relative',
      // Held only until the image can size the box itself — and held for good
      // if it never arrives, so a failure reads as a quiet placeholder.
      background: (isLoaded && !hasFailed) ? 'transparent' : '#cfcfcf',
      aspectRatio: (isLoaded && !hasFailed) ? undefined : (aspectRatio ? `1 / ${aspectRatio}` : '1 / 1')
    }}>
      <img
        ref={measureRef}
        src={src}
        alt={alt}
        decoding="async"
        // Treat a failed load as settled: a broken image should fall back to
        // the empty box, not shimmer indefinitely. It also stays at opacity 0
        // — revealing it would show the browser's broken-image glyph, which is
        // the one thing this box is meant to avoid.
        onLoad={() => setIsLoaded(true)}
        onError={() => { setHasFailed(true); setIsLoaded(true); }}
        style={{
          display: 'block',
          width: '100%',
          height: 'auto',
          objectFit: 'contain',
          borderRadius: '6px',
          opacity: (isLoaded && !hasFailed) ? 1 : 0,
          transition: 'opacity 0.18s ease'
        }}
      />
      {!isLoaded && <PanelImageShimmer />}
    </div>
  );
};

export default PanelImage;
