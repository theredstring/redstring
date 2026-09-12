import React from 'react';
import { Star } from 'lucide-react';
import { useTheme } from '../../../hooks/useTheme.js';
import { DialogButton } from '../../shared/Dialog.jsx';

/**
 * "Source of Truth" / "Not Source of Truth", on one storage of a universe.
 *
 * The Git block and the Local block each carried their own copy of this button,
 * and the two copies had drifted in the one way that matters: Git lifted its
 * maroon to #CCAAA8 in dark mode, Local did not, so on a dark panel the Local
 * pill was #7A0000 text and border on #2E2A2A — a control you could barely see,
 * sitting opposite one you could. One component, one set of colours.
 *
 * The colour is the brand INK (canvas.brandText), not the fill maroon: this pill
 * spends most of its life as an outline with a label inside it, and both of
 * those have to be read. The filled state keeps the fill maroon with a light
 * label, which is what every other committing action in the app does.
 *
 * The star is the real state indicator — filled or hollow — because the two
 * states differ by one word otherwise, and "Not Source of Truth" and "Source of
 * Truth" are the same shape at a glance.
 */
/**
 * Two stable component types rather than one arrow defined in the render.
 *
 * PanelIconButton takes the icon as a TYPE and instantiates it. An inline arrow
 * is a new type on every render, so React would tear the star down and rebuild
 * it each time — which, among other things, restarts the colour transition the
 * button runs on hover.
 *
 * `currentColor` is the whole trick: the star takes the pill's colour, including
 * the maroon the pie hover swaps in, so it can never disagree with its label.
 */
const StarFilled = () => (
  <Star size={11} color="currentColor" fill="currentColor" style={{ flexShrink: 0 }} />
);

const StarHollow = () => (
  <Star size={11} color="currentColor" fill="none" style={{ flexShrink: 0 }} />
);

const SourceOfTruthPill = ({
  isSourceOfTruth,
  /**
   * False when this is the universe's ONLY storage, so it must stay the source
   * of truth. The pill still shows the true state; it just cannot be pressed.
   */
  canToggle,
  onSelect
}) => {
  const theme = useTheme();
  const ink = theme.canvas.brandText;

  return (
    <DialogButton
      label={isSourceOfTruth ? 'Source of Truth' : 'Not Source of Truth'}
      icon={isSourceOfTruth ? StarFilled : StarHollow}
      tone={isSourceOfTruth ? 'accent' : 'neutral'}
      disabled={!canToggle}
      onClick={(e) => {
        e.stopPropagation();
        onSelect();
      }}
      title={
        !canToggle
          ? 'Only storage option (must remain source of truth)'
          : isSourceOfTruth
            ? 'Currently source of truth'
            : 'Click to make source of truth'
      }
      labelFontSize={11}
      style={{
        minHeight: 26,
        padding: '3px 10px',
        // The neutral tone outlines in canvas.textPrimary; this one belongs to
        // the brand family, so it takes the ink for its edge and its label.
        ...(isSourceOfTruth ? {} : { borderColor: ink, color: ink }),
        // A locked pill is not a dimmed pill. PanelIconButton drops a disabled
        // button to 0.5, which would read as "this state is off" on the very
        // pill that is announcing the state is on.
        opacity: canToggle ? 1 : 0.9
      }}
    />
  );
};

export default SourceOfTruthPill;
