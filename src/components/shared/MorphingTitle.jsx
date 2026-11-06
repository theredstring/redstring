import { useLayoutEffect, useRef, useState } from 'react';

/** The words two titles start with alike: those stay put as the rest changes. */
const sharedHead = (a, b) => {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return a.slice(0, a.lastIndexOf(' ', i - 1) + 1);
};

/**
 * A title that reads as one string across its versions: the words they share
 * stay where they are, the rest fades from the old to the new, and its width
 * eases between the two, carrying along whatever sits after it (a chevron).
 * Styled in UnifiedSelector.css.
 */
export default function MorphingTitle({ text }) {
  const [shown, setShown] = useState({ text, head: '', leaving: '' });
  if (shown.text !== text) {
    const head = sharedHead(shown.text, text);
    setShown({ text, head, leaving: shown.text.slice(head.length) });
  }
  const { head, leaving } = shown;

  const lineRef = useRef(null);
  const [width, setWidth] = useState(null);
  useLayoutEffect(() => {
    const line = lineRef.current;
    if (line) setWidth(Math.ceil(line.getBoundingClientRect().width));
  }, [text]);

  return (
    <span className="morphing-title" style={width === null ? undefined : { width }}>
      <span ref={lineRef} className="morphing-title-line">
        {head}
        <span className="morphing-title-tail">
          {leaving && (
            <span
              key={`out:${text}`}
              className="morphing-title-leaving"
              aria-hidden="true"
              onAnimationEnd={() => setShown(s => (s.text === text ? { ...s, leaving: '' } : s))}
            >
              {leaving}
            </span>
          )}
          <span key={text} className={leaving ? 'morphing-title-entering' : undefined}>
            {text.slice(head.length)}
          </span>
        </span>
      </span>
    </span>
  );
}
