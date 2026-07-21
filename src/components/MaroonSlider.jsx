import React, { useState } from 'react';
import './MaroonSlider.css';

// Decimal places implied by a step value (0.05 -> 2, 5 -> 0). Used to round the
// committed value onto a clean grid while the input itself runs continuously.
const decimalsOf = (step) => {
  const s = String(step);
  const dot = s.indexOf('.');
  return dot === -1 ? 0 : s.length - dot - 1;
};

const MaroonSlider = ({
  label,
  value,
  min = 0,
  max = 100,
  step = 1,
  onChange,
  disabled = false,
  suffix = '',
  displayValue
}) => {
  // While the user is actively dragging, the thumb is driven by this local raw
  // value rather than the `value` prop. The prop round-trips through the store
  // (and its batching middleware), so it can arrive a render late; feeding that
  // stale value back to a controlled range input snaps the thumb backwards and,
  // with the pointer still moving, makes it oscillate around the current spot.
  const [dragValue, setDragValue] = useState(null);
  const isDragging = dragValue !== null;
  const raw = isDragging ? dragValue : value;

  // The input runs continuously (step="any") so slow movement never lingers on a
  // coarse step boundary and flip-flops between two neighbouring values. The
  // value we hand back out is rounded to the step's decimal grid — one order
  // finer than the nominal step (a 0.05 step commits at 0.01) — so stored values
  // stay clean while the thumb stays smooth.
  const decimals = decimalsOf(step);
  const commit = (v) => Number(Number(v).toFixed(decimals));
  const shown = commit(raw);

  const handleChange = (e) => {
    const v = Number(e.target.value);
    if (isDragging) setDragValue(v);
    onChange?.(commit(v));
  };

  const beginDrag = (e) => setDragValue(Number(e.target.value));
  const endDrag = () => setDragValue(null);

  return (
    <div className="maroon-slider" aria-disabled={disabled}>
      {label && (
        <label className="maroon-slider__label">
          {label}
        </label>
      )}
      <div className="maroon-slider__control">
        <input
          className="maroon-slider__range"
          type="range"
          min={min}
          max={max}
          step="any"
          value={raw}
          onChange={handleChange}
          onPointerDown={beginDrag}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          onBlur={endDrag}
          disabled={disabled}
          aria-valuemin={min}
          aria-valuemax={max}
          aria-valuenow={shown}
        />
        <div className="maroon-slider__value">
          {displayValue !== undefined ? displayValue : shown}
          {suffix}
        </div>
      </div>
    </div>
  );
};

export default MaroonSlider;
