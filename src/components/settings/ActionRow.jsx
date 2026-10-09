import React, { useEffect, useRef, useState } from 'react';
import PanelIconButton from '../shared/PanelIconButton.jsx';

/** How long a button asking "Sure?" waits for the second press. */
const CONFIRM_WINDOW_MS = 4000;

/**
 * A Settings row whose control is a single button: label and reason on the
 * left. Module scope, for the reason given above Toggle in SettingsModal.
 *
 * With `confirmLabel`, the first press only arms it: the button reads
 * `confirmLabel` for a few seconds and a second press acts. For the rows that
 * throw something away. `busy` swaps the label while the action runs.
 */
const ActionRow = ({ title, description, actionLabel, confirmLabel = null, busy = false, busyLabel = null, disabled = false, onClick }) => {
  const [armed, setArmed] = useState(false);
  const timer = useRef(null);

  useEffect(() => () => clearTimeout(timer.current), []);

  const press = () => {
    if (!confirmLabel || armed) {
      clearTimeout(timer.current);
      setArmed(false);
      onClick?.();
      return;
    }
    setArmed(true);
    timer.current = setTimeout(() => setArmed(false), CONFIRM_WINDOW_MS);
  };

  const label = busy ? (busyLabel || actionLabel) : armed ? confirmLabel : actionLabel;

  return (
    <div className="settings-row">
      <div className="settings-row-label">
        {title}
        {description && <div className="settings-row-description">{description}</div>}
      </div>
      <PanelIconButton
        label={label}
        labelFontSize={11}
        variant="outline"
        active={armed}
        disabled={disabled || busy}
        onClick={press}
        style={{ padding: '5px 12px', flexShrink: 0 }}
      />
    </div>
  );
};

export default ActionRow;
