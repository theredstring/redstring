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

  // The value chip shares a grid row with the track, and its column is sized to
  // its text. So the track's width — and therefore where along it the thumb
  // sits — depended on how many characters the current value happened to need.
  // Crossing 1.0 is where that bites: trailing zeros are trimmed, so "0.95x"
  // becomes "1x", the chip loses three characters, the track grows into them and
  // the thumb jumps out from under the pointer. Same on any digit boundary — a
  // Grid Size crossing 100px did it too.
  //
  // So reserve the widest string this slider could ever show and hold the chip
  // at that width for its whole range. Built from the range rather than from the
  // current value: the largest magnitude at full decimal precision, with 8s
  // standing in for the digits.
  const widestSample = (() => {
    const magnitude = Math.max(Math.abs(min), Math.abs(max));
    const intDigits = String(Math.floor(magnitude)).length;
    const sign = min < 0 ? '-' : '';
    const frac = decimals > 0 ? `.${'8'.repeat(decimals)}` : '';
    return `${sign}${'8'.repeat(intDigits)}${frac}${suffix}`;
  })();

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
          <span className="maroon-slider__value-sizer" aria-hidden="true">{widestSample}</span>
          <span className="maroon-slider__value-text">
            {displayValue !== undefined ? displayValue : shown}
            {suffix}
          </span>
        </div>
      </div>
    </div>
  );
};

export default MaroonSlider;
