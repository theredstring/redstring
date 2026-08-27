import React, { useCallback, useRef, useState } from 'react';
import { Info } from 'lucide-react';
import PanelIconButton from './PanelIconButton.jsx';
import AnchoredPopoverBox from './AnchoredPopoverBox.jsx';

/**
 * An info button that opens a short explanation next to itself.
 *
 * The point of this component is to let interfaces stay in plain language while
 * the concepts underneath stay available. The About section says "matched
 * automatically" rather than "skos:closeMatch"; this is where a reader can find
 * out that there is a ladder at all, without the vocabulary being pushed at
 * everyone who opens the panel.
 *
 * Reusable by design — expected to spread to the abstraction axis, save/git
 * state, and anywhere else a term is doing more work than its label admits.
 *
 * Usage:
 *   <InfoPopover title="Identifiers" label="What are identifiers?">
 *     {ABOUT_INTRO}
 *   </InfoPopover>
 */
const InfoPopover = ({
  title,
  children,
  label = 'More information',
  direction = 'down-left',
  width = 280,
  estimatedHeight = 180,
  size = 14,
  color,
  style = {}
}) => {
  const [anchor, setAnchor] = useState(null);
  const triggerRef = useRef(null);

  const handleClick = useCallback((event) => {
    if (anchor) {
      setAnchor(null);
      return;
    }
    // The trigger is a button inside PanelIconButton; take its box rather than
    // the event coords so a keyboard activation anchors correctly too.
    const el = event?.currentTarget instanceof Element ? event.currentTarget : triggerRef.current;
    const rect = el?.getBoundingClientRect();
    if (!rect) return;
    triggerRef.current = el;
    setAnchor({ x: rect.left + rect.width / 2, y: rect.bottom });
  }, [anchor]);

  return (
    <>
      <PanelIconButton
        icon={Info}
        size={size}
        color={color}
        active={!!anchor}
        onClick={handleClick}
        title={label}
        ariaExpanded={!!anchor}
        ariaHasPopup="dialog"
        style={style}
      />
      {anchor && (
        <AnchoredPopoverBox
          position={anchor}
          direction={direction}
          width={width}
          estimatedHeight={estimatedHeight}
          onDismiss={() => setAnchor(null)}
          triggerRef={triggerRef}
          ariaLabel={title || label}
        >
          {title && (
            <div style={{ fontWeight: 'bold', marginBottom: 6 }}>{title}</div>
          )}
          {children}
        </AnchoredPopoverBox>
      )}
    </>
  );
};

export default InfoPopover;
