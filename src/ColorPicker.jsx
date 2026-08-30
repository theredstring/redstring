import React, { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { Pipette } from 'lucide-react';
import { useTheme } from './hooks/useTheme.js';
import useMobileDetection from './hooks/useMobileDetection';
import { cssColorToHex } from './utils/colorUtils';
import { sampleColorAt } from './utils/screenColorSample.js';
import PanelIconButton from './components/shared/PanelIconButton.jsx';

const ColorPicker = ({
  isVisible,
  onClose,
  onColorChange,
  currentColor = '#8B0000',
  position = { x: 0, y: 0 },
  direction = 'down-left', // 'down-left' or 'down-right'
  parentContainerRef = null, // Optional parent container to consider as "inside"
  onDelete,
  // Fired once when the picker closes, marking the end of one colour edit.
  // Sliders emit onColorChange continuously so the swatch tracks the drag; this
  // is what lets a whole picker session collapse into a single undo step.
  onColorCommit
}) => {
  const theme = useTheme();
  const mobileState = useMobileDetection();
  // Preset colors
  const [selectedHue, setSelectedHue] = useState(0);
  const [selectedSaturation, setSelectedSaturation] = useState(100);
  const [selectedBrightness, setSelectedBrightness] = useState(55);
  const [hexInput, setHexInput] = useState('');
  const pickerRef = useRef(null);

  // Convert hex to HSV
  const hexToHsv = useCallback((hex) => {
    const r = parseInt(hex.slice(1, 3), 16) / 255;
    const g = parseInt(hex.slice(3, 5), 16) / 255;
    const b = parseInt(hex.slice(5, 7), 16) / 255;

    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const diff = max - min;

    let h = 0;
    if (diff !== 0) {
      if (max === r) h = ((g - b) / diff) % 6;
      else if (max === g) h = (b - r) / diff + 2;
      else h = (r - g) / diff + 4;
    }
    h = Math.round(h * 60);
    if (h < 0) h += 360;

    const s = max === 0 ? 0 : diff / max;
    const v = max;

    return { h, s, v };
  }, []);

  // Convert HSV to hex
  const hsvToHex = useCallback((h, s, v) => {
    const c = v * s;
    const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
    const m = v - c;

    let r, g, b;
    if (h >= 0 && h < 60) { r = c; g = x; b = 0; }
    else if (h >= 60 && h < 120) { r = x; g = c; b = 0; }
    else if (h >= 120 && h < 180) { r = 0; g = c; b = x; }
    else if (h >= 180 && h < 240) { r = 0; g = x; b = c; }
    else if (h >= 240 && h < 300) { r = x; g = 0; b = c; }
    else { r = c; g = 0; b = x; }

    r = Math.round((r + m) * 255);
    g = Math.round((g + m) * 255);
    b = Math.round((b + m) * 255);

    return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
  }, []);

  // Initialize with current color
  useEffect(() => {
    if (currentColor) {
      // Normalize color (handle CSS names, 3-digit hex, etc.)
      const normalizedColor = cssColorToHex(currentColor);

      if (normalizedColor && normalizedColor.startsWith('#')) {
        const hsv = hexToHsv(normalizedColor);
        setSelectedHue(hsv.h);
        setSelectedSaturation(Math.round(hsv.s * 100));
        setSelectedBrightness(Math.round(hsv.v * 100));
        setHexInput(normalizedColor);
      }
    }
  }, [currentColor, hexToHsv]);

  // Close the colour edit when the picker goes away, whichever route it took —
  // outside click, Escape, or the consumer simply unmounting it. Ref'd so the
  // cleanup does not re-run on every prop change, and guarded so a StrictMode
  // double-invoke cannot double-commit.
  const onColorCommitRef = useRef(onColorCommit);
  onColorCommitRef.current = onColorCommit;
  const didCommitRef = useRef(false);

  useEffect(() => {
    if (!isVisible) return;
    didCommitRef.current = false;
    return () => {
      if (didCommitRef.current) return;
      didCommitRef.current = true;
      onColorCommitRef.current?.();
    };
  }, [isVisible]);

  // Handle hue slider change
  const handleHueChange = (e) => {
    const hue = parseInt(e.target.value);
    setSelectedHue(hue);
    const newColor = hsvToHex(hue, selectedSaturation / 100, selectedBrightness / 100);
    setHexInput(newColor);
    onColorChange(newColor);
  };

  // Handle saturation slider change
  const handleSaturationChange = (e) => {
    const saturation = parseInt(e.target.value);
    setSelectedSaturation(saturation);
    const newColor = hsvToHex(selectedHue, saturation / 100, selectedBrightness / 100);
    setHexInput(newColor);
    onColorChange(newColor);
  };

  // Handle brightness slider change
  const handleBrightnessChange = (e) => {
    const brightness = parseInt(e.target.value);
    setSelectedBrightness(brightness);
    const newColor = hsvToHex(selectedHue, selectedSaturation / 100, brightness / 100);
    setHexInput(newColor);
    onColorChange(newColor);
  };

  // Handle hex input change
  const handleHexInputChange = (e) => {
    let value = e.target.value;

    // Allow typing without # and add it automatically
    if (!value.startsWith('#') && value.length > 0) {
      value = '#' + value;
    }

    setHexInput(value);

    // Validate and apply color if valid
    if (/^#[0-9A-Fa-f]{6}$/.test(value)) {
      const hsv = hexToHsv(value);
      setSelectedHue(hsv.h);
      setSelectedSaturation(Math.round(hsv.s * 100));
      setSelectedBrightness(Math.round(hsv.v * 100));
      onColorChange(value);
    }
  };

  // ---- Eyedropper ----------------------------------------------------------
  // One path on every platform — window.EyeDropper (real screen pixels) exists
  // only on Chromium desktop, so leaning on it would mean the picker behaving
  // one way in the desktop app and another in Safari and on iOS. This reads the
  // document's own paint instead; see utils/screenColorSample.js.
  const [isPicking, setIsPicking] = useState(false);
  const [sample, setSample] = useState(null); // { x, y, color, touch }
  const overlayRef = useRef(null);

  const applySampledColor = useCallback((hex) => {
    const hsv = hexToHsv(hex);
    setSelectedHue(hsv.h);
    setSelectedSaturation(Math.round(hsv.s * 100));
    setSelectedBrightness(Math.round(hsv.v * 100));
    setHexInput(hex);
    onColorChange(hex);
  }, [hexToHsv, onColorChange]);

  useEffect(() => {
    if (!isPicking) return;

    const read = (e) => sampleColorAt(e.clientX, e.clientY, [overlayRef.current, pickerRef.current]);

    // Sampling walks the tree under the pointer, so it runs at most once a frame
    // rather than once per pointermove — a trackpad emits several per frame.
    let frame = 0;
    let pending = null;
    const track = (e) => {
      pending = { x: e.clientX, y: e.clientY, touch: e.pointerType === 'touch', event: e };
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        const p = pending;
        if (p) setSample({ x: p.x, y: p.y, touch: p.touch, color: read(p.event) });
      });
    };
    // Everything between pressing and lifting is swallowed in the capture phase,
    // before the canvas (or the picker's own click-away) can act on a pointer
    // that is only here to be sampled.
    const swallow = (e) => { e.preventDefault(); e.stopPropagation(); };
    const start = (e) => { swallow(e); track(e); };
    const commit = (e) => {
      swallow(e);
      const hex = read(e);
      if (hex) applySampledColor(hex);
      setIsPicking(false);
      setSample(null);
    };
    // Escape leaves picking mode without also closing the picker — you're
    // backing out of the eyedropper, not out of the colour you were choosing.
    const onKeyDown = (e) => {
      if (e.key !== 'Escape') return;
      swallow(e);
      setIsPicking(false);
      setSample(null);
    };

    window.addEventListener('pointermove', track, true);
    window.addEventListener('pointerdown', start, true);
    window.addEventListener('pointerup', commit, true);
    window.addEventListener('mousedown', swallow, true);
    window.addEventListener('mouseup', swallow, true);
    window.addEventListener('click', swallow, true);
    window.addEventListener('contextmenu', onKeyDown, true);
    window.addEventListener('keydown', onKeyDown, true);
    return () => {
      window.removeEventListener('pointermove', track, true);
      window.removeEventListener('pointerdown', start, true);
      window.removeEventListener('pointerup', commit, true);
      window.removeEventListener('mousedown', swallow, true);
      window.removeEventListener('mouseup', swallow, true);
      window.removeEventListener('click', swallow, true);
      window.removeEventListener('contextmenu', onKeyDown, true);
      window.removeEventListener('keydown', onKeyDown, true);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [isPicking, applySampledColor]);

  // A picker that goes away mid-pick leaves no listeners behind.
  useEffect(() => {
    if (!isVisible && isPicking) {
      setIsPicking(false);
      setSample(null);
    }
  }, [isVisible, isPicking]);

  // Handle click away
  useEffect(() => {
    const handleClickAway = (e) => {
      // Check if click is outside the color picker
      const isOutsidePicker = pickerRef.current && !pickerRef.current.contains(e.target);

      // Close whenever clicking outside the picker itself, regardless of parent container
      if (isOutsidePicker) {
        onClose();
      }
    };

    // While picking, every click outside the picker is a sample, not a dismissal.
    if (isVisible && !isPicking) {
      // Use 'click' instead of 'mousedown' to avoid conflicts with palette button handlers
      document.addEventListener('click', handleClickAway);
      return () => document.removeEventListener('click', handleClickAway);
    }
  }, [isVisible, isPicking, onClose]);

  // Handle escape key
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    // Escape cancels the eyedropper first (handled above); it only closes the
    // whole picker once you're out of picking mode.
    if (isVisible && !isPicking) {
      document.addEventListener('keydown', handleKeyDown);
      return () => document.removeEventListener('keydown', handleKeyDown);
    }
  }, [isVisible, isPicking, onClose]);

  if (!isVisible) return null;

  // Calculate position based on direction and window bounds
  const getPositionStyle = () => {
    const offset = 8; // Distance from the trigger
    const pickerWidth = 240; // minWidth from the picker style
    // Update pickerHeight estimate for new sliders
    const pickerHeight = 320;

    // On mobile, center the picker on the viewport on both axes. The trigger
    // is usually at the bottom edge (control panel buttons) which puts the
    // anchored picker awkwardly low; centering is more usable on a phone.
    if (mobileState.isMobile) {
      return {
        position: 'fixed',
        left: '50%',
        top: '50%',
        transform: 'translate(-50%, -50%)',
        zIndex: 1000000
      };
    }

    let left, right, top;

    top = position.y + offset;

    if (direction === 'down-right') {
      // Align the picker's left edge with position.x (left edge of trigger)
      left = position.x;
      right = undefined;

      // If it would overflow the right edge, fall back to right-aligned
      if (left + pickerWidth > window.innerWidth) {
        right = Math.max(offset, window.innerWidth - position.x - pickerWidth);
        left = undefined;
      }
    } else {
      // Default 'down-left': align right edge of picker with position.x
      right = window.innerWidth - position.x;
      left = undefined;

      // Check if picker would go off the left edge when right-aligned
      if (window.innerWidth - right < pickerWidth) {
        // Switch to left-aligned positioning
        left = position.x + offset;
        right = undefined;

        // Ensure left-aligned version doesn't go off the right edge
        if (left + pickerWidth > window.innerWidth) {
          left = window.innerWidth - pickerWidth - offset;
        }
      }
    }

    // Check if picker would go off the bottom edge
    if (top + pickerHeight > window.innerHeight) {
      top = position.y - pickerHeight - offset; // Position above the trigger
    }

    // Ensure we don't go off the top edge
    if (top < 0) {
      top = offset;
    }

    const style = {
      position: 'fixed',
      top: Math.max(0, top),
      zIndex: 1000000
    };

    if (left !== undefined) {
      style.left = Math.max(0, left);
    } else {
      style.right = Math.max(0, right);
    }

    return style;
  };

  const currentPreviewColor = hsvToHex(selectedHue, selectedSaturation / 100, selectedBrightness / 100);

  // Generate gradient colors for saturation slider (gray to fully saturated at current hue/brightness)
  const saturationGradientStart = hsvToHex(selectedHue, 0, selectedBrightness / 100);
  const saturationGradientEnd = hsvToHex(selectedHue, 1, selectedBrightness / 100);

  // Generate gradient colors for brightness slider (black to white at current hue/saturation)
  const brightnessGradientStart = hsvToHex(selectedHue, selectedSaturation / 100, 0);
  const brightnessGradientEnd = hsvToHex(selectedHue, selectedSaturation / 100, 1);

  return (
    <div
      ref={pickerRef}
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      onMouseUp={(e) => e.stopPropagation()}
      style={{
        ...getPositionStyle(),
        backgroundColor: theme.canvas.bg,

        border: `2px solid ${theme.canvas.textPrimary}`,
        borderRadius: '8px',
        padding: '16px',
        boxShadow: '0 4px 12px rgba(0, 0, 0, 0.3)',
        minWidth: '240px',
        // Stand aside while picking: the panel usually sits right on top of the
        // Things you want to sample. On the fallback path sampling reads through
        // it either way (it's in sampleColorAt's ignore list), and on the native
        // path the loupe is reading real pixels — so the panel genuinely has to
        // get out of the light.
        opacity: isPicking ? 0.2 : 1,
        transition: 'opacity 0.15s ease'
      }}
    >
      {isPicking && createPortal(
        <>
          {/* Capture layer. It keeps the app underneath from reacting to a
              pointer that is only passing through; the sample itself reads the
              element stack beneath it (sampleColorAt skips this layer and the
              picker). The system cursor is hidden because the swatch below IS
              the cursor. */}
          <div
            ref={overlayRef}
            style={{
              position: 'fixed',
              inset: 0,
              zIndex: 1000001,
              cursor: 'none',
              touchAction: 'none',
              background: 'transparent'
            }}
          />
          {/* The cursor: a square of whatever is under the pointer, nothing else.
              It sits off the point rather than on it — down-right of a mouse, so
              the hotspot reads as its top-left corner the way a cursor's does,
              and up-left of a finger, which would otherwise be covering it. */}
          {sample && (
            <div
              style={{
                position: 'fixed',
                left: sample.x,
                top: sample.y,
                zIndex: 1000002,
                pointerEvents: 'none',
                width: '26px',
                height: '26px',
                boxSizing: 'border-box',
                transform: sample.touch
                  ? 'translate(calc(-100% - 14px), calc(-100% - 14px))'
                  : 'translate(12px, 12px)',
                backgroundColor: sample.color || 'transparent',
                border: '1px solid #cfcfcf'
              }}
            />
          )}
        </>,
        document.body
      )}

      {/* Header: swatch, title, and the eyedropper. The palette icon that used to
          float in the corner said nothing the title didn't already say; the
          eyedropper earns the spot and sits on the header's own baseline
          instead of over the padding. */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        marginBottom: '12px'
      }}>
        <div
          style={{
            width: '24px',
            height: '24px',
            backgroundColor: currentPreviewColor,
            border: `2px solid ${theme.canvas.textPrimary}`,
            borderRadius: '4px',
            flexShrink: 0
          }}
        />
        <span style={{
          color: theme.canvas.textPrimary,
          fontWeight: 'bold',
          fontSize: '14px',
          marginRight: 'auto'
        }}>
          Color Your Thing
        </span>
        {/* Same button the right panel uses everywhere: a bare icon at rest that
            grows into the pie-bubble fill and ring under the cursor. `active`
            holds that state while picking, so the button looks pressed with the
            app's own vocabulary rather than a second one invented here. */}
        <PanelIconButton
          icon={Pipette}
          size={20}
          active={isPicking}
          title={isPicking
            ? 'Picking — click a color, or Esc to cancel'
            : 'Pick a color from anywhere in Redstring'}
          onClick={(e) => {
            e.stopPropagation();
            setSample(null);
            setIsPicking(p => !p);
          }}
        />
      </div>

      {/* Hue slider */}
      <div style={{ marginBottom: '12px' }}>
        <label style={{
          display: 'block',
          color: theme.canvas.textPrimary,
          fontSize: '12px',
          fontWeight: 'bold',
          marginBottom: '4px'
        }}>
          Hue
        </label>
        <div style={{ position: 'relative' }}>
          <style>{`
            .color-picker-slider-${selectedHue}-${selectedSaturation}-${selectedBrightness}::-webkit-slider-thumb {
              appearance: none;
              -webkit-appearance: none;
              width: 20px;
              height: 20px;
              border-radius: 50%;
              background: ${currentPreviewColor};
              border: 2px solid ${theme.canvas.textPrimary};
              cursor: pointer;
              box-shadow: 0 2px 4px rgba(0, 0, 0, 0.3);
            }
            .color-picker-slider-${selectedHue}-${selectedSaturation}-${selectedBrightness}::-moz-range-thumb {
              width: 20px;
              height: 20px;
              border-radius: 50%;
              background: ${currentPreviewColor};
              border: 2px solid ${theme.canvas.textPrimary};
              cursor: pointer;
              box-shadow: 0 2px 4px rgba(0, 0, 0, 0.3);
            }
          `}</style>
          <input
            type="range"
            min="0"
            max="360"
            value={selectedHue}
            onChange={handleHueChange}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
            onMouseUp={(e) => e.stopPropagation()}
            className={`color-picker-slider-${selectedHue}-${selectedSaturation}-${selectedBrightness}`}
            style={{
              width: '100%',
              height: '20px',
              borderRadius: '4px',
              background: `linear-gradient(to right, 
                ${hsvToHex(0, selectedSaturation / 100, selectedBrightness / 100)}, 
                ${hsvToHex(60, selectedSaturation / 100, selectedBrightness / 100)}, 
                ${hsvToHex(120, selectedSaturation / 100, selectedBrightness / 100)}, 
                ${hsvToHex(180, selectedSaturation / 100, selectedBrightness / 100)}, 
                ${hsvToHex(240, selectedSaturation / 100, selectedBrightness / 100)}, 
                ${hsvToHex(300, selectedSaturation / 100, selectedBrightness / 100)}, 
                ${hsvToHex(360, selectedSaturation / 100, selectedBrightness / 100)}
              )`,
              outline: 'none',
              cursor: 'pointer',
              appearance: 'none',
              WebkitAppearance: 'none'
            }}
          />
        </div>
      </div>

      {/* Saturation slider */}
      <div style={{ marginBottom: '12px' }}>
        <label style={{
          display: 'block',
          color: theme.canvas.textPrimary,
          fontSize: '12px',
          fontWeight: 'bold',
          marginBottom: '4px'
        }}>
          Saturation
        </label>
        <div style={{ position: 'relative' }}>
          <style>{`
            .color-picker-saturation-slider-${selectedHue}-${selectedSaturation}-${selectedBrightness}::-webkit-slider-thumb {
              appearance: none;
              -webkit-appearance: none;
              width: 20px;
              height: 20px;
              border-radius: 50%;
              background: ${hsvToHex(selectedHue, selectedSaturation / 100, selectedBrightness / 100)};
              border: 2px solid ${theme.canvas.textPrimary};
              cursor: pointer;
              box-shadow: 0 2px 4px rgba(0, 0, 0, 0.3);
            }
            .color-picker-saturation-slider-${selectedHue}-${selectedSaturation}-${selectedBrightness}::-moz-range-thumb {
              width: 20px;
              height: 20px;
              border-radius: 50%;
              background: ${hsvToHex(selectedHue, selectedSaturation / 100, selectedBrightness / 100)};
              border: 2px solid ${theme.canvas.textPrimary};
              cursor: pointer;
              box-shadow: 0 2px 4px rgba(0, 0, 0, 0.3);
            }
          `}</style>
          <input
            type="range"
            min="0"
            max="100"
            value={selectedSaturation}
            onChange={handleSaturationChange}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
            onMouseUp={(e) => e.stopPropagation()}
            className={`color-picker-saturation-slider-${selectedHue}-${selectedSaturation}-${selectedBrightness}`}
            style={{
              width: '100%',
              height: '20px',
              borderRadius: '4px',
              background: `linear-gradient(to right, ${saturationGradientStart}, ${saturationGradientEnd})`,
              outline: 'none',
              cursor: 'pointer',
              appearance: 'none',
              WebkitAppearance: 'none'
            }}
          />
        </div>
      </div>

      {/* Brightness slider */}
      <div style={{ marginBottom: '12px' }}>
        <label style={{
          display: 'block',
          color: theme.canvas.textPrimary,
          fontSize: '12px',
          fontWeight: 'bold',
          marginBottom: '4px'
        }}>
          Brightness
        </label>
        <div style={{ position: 'relative' }}>
          <style>{`
            .color-picker-brightness-slider-${selectedHue}-${selectedSaturation}-${selectedBrightness}::-webkit-slider-thumb {
              appearance: none;
              -webkit-appearance: none;
              width: 20px;
              height: 20px;
              border-radius: 50%;
              background: ${hsvToHex(selectedHue, selectedSaturation / 100, selectedBrightness / 100)};
              border: 2px solid ${theme.canvas.textPrimary};
              cursor: pointer;
              box-shadow: 0 2px 4px rgba(0, 0, 0, 0.3);
            }
            .color-picker-brightness-slider-${selectedHue}-${selectedSaturation}-${selectedBrightness}::-moz-range-thumb {
              width: 20px;
              height: 20px;
              border-radius: 50%;
              background: ${hsvToHex(selectedHue, selectedSaturation / 100, selectedBrightness / 100)};
              border: 2px solid ${theme.canvas.textPrimary};
              cursor: pointer;
              box-shadow: 0 2px 4px rgba(0, 0, 0, 0.3);
            }
          `}</style>
          <input
            type="range"
            min="0"
            max="100"
            value={selectedBrightness}
            onChange={handleBrightnessChange}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
            onMouseUp={(e) => e.stopPropagation()}
            className={`color-picker-brightness-slider-${selectedHue}-${selectedSaturation}-${selectedBrightness}`}
            style={{
              width: '100%',
              height: '20px',
              borderRadius: '4px',
              background: `linear-gradient(to right, ${brightnessGradientStart}, ${brightnessGradientEnd})`,
              outline: 'none',
              cursor: 'pointer',
              appearance: 'none',
              WebkitAppearance: 'none'
            }}
          />
        </div>
      </div>

      {/* Hex input */}
      <div>
        <label style={{
          display: 'block',
          color: theme.canvas.textPrimary,
          fontSize: '12px',
          fontWeight: 'bold',
          marginBottom: '4px'
        }}>
          Hex Code
        </label>
        <input
          type="text"
          value={hexInput}
          onChange={handleHexInputChange}
          // Typing a hex writes on every keystroke that parses; blur ends that edit.
          onBlur={() => onColorCommit?.()}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()}
          placeholder="#8B0000"
          style={{
            width: '100%',
            maxWidth: '100%',
            minWidth: '0',
            padding: '6px 8px',
            border: `1px solid ${theme.canvas.textPrimary}`,
            borderRadius: '4px',
            backgroundColor: theme.darkMode ? theme.canvas.hover : '#EFE8E5',
            color: theme.canvas.textPrimary,
            fontSize: '14px',
            fontFamily: "'EmOne', sans-serif",
            boxSizing: 'border-box'
          }}
        />
      </div>
    </div>
  );
};

export default ColorPicker; 