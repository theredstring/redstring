import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Palette } from 'lucide-react';
import { cssColorToHex } from './utils/colorUtils';

const ColorPicker = ({
  isVisible,
  onClose,
  onColorChange,
  currentColor = '#8B0000',
  position = { x: 0, y: 0 },
  direction = 'down-left', // 'down-left' or 'down-right'
  parentContainerRef = null // Optional parent container to consider as "inside"
}) => {
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

    if (isVisible) {
      // Use 'click' instead of 'mousedown' to avoid conflicts with palette button handlers
      document.addEventListener('click', handleClickAway);
      return () => document.removeEventListener('click', handleClickAway);
    }
  }, [isVisible, onClose]);

  // Handle escape key
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    if (isVisible) {
      document.addEventListener('keydown', handleKeyDown);
      return () => document.removeEventListener('keydown', handleKeyDown);
    }
  }, [isVisible, onClose]);

  if (!isVisible) return null;

  // Calculate position based on direction and window bounds
  const getPositionStyle = () => {
    const offset = 8; // Distance from the trigger
    const pickerWidth = 240; // minWidth from the picker style
    // Update pickerHeight estimate for new sliders
    const pickerHeight = 320;

    let left, right, top;

    // Always try to align the right edge of the color picker with the right edge of the icon
    // This gives a nice visual alignment
    right = window.innerWidth - position.x;
    left = undefined;

    top = position.y + offset;

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
      zIndex: 30000
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
        backgroundColor: '#bdb5b5',
        border: '2px solid #260000',
        borderRadius: '8px',
        padding: '16px',
        boxShadow: '0 4px 12px rgba(0, 0, 0, 0.3)',
        minWidth: '240px'
      }}
    >
      {/* Color preview */}
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
            border: '2px solid #260000',
            borderRadius: '4px'
          }}
        />
        <span style={{ color: '#260000', fontWeight: 'bold', fontSize: '14px' }}>
          Color Your Thing
        </span>
      </div>

      {/* Hue slider */}
      <div style={{ marginBottom: '12px' }}>
        <label style={{
          display: 'block',
          color: '#260000',
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
              border: 2px solid #260000;
              cursor: pointer;
              box-shadow: 0 2px 4px rgba(0, 0, 0, 0.3);
            }
            .color-picker-slider-${selectedHue}-${selectedSaturation}-${selectedBrightness}::-moz-range-thumb {
              width: 20px;
              height: 20px;
              border-radius: 50%;
              background: ${currentPreviewColor};
              border: 2px solid #260000;
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
          color: '#260000',
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
              border: 2px solid #260000;
              cursor: pointer;
              box-shadow: 0 2px 4px rgba(0, 0, 0, 0.3);
            }
            .color-picker-saturation-slider-${selectedHue}-${selectedSaturation}-${selectedBrightness}::-moz-range-thumb {
              width: 20px;
              height: 20px;
              border-radius: 50%;
              background: ${hsvToHex(selectedHue, selectedSaturation / 100, selectedBrightness / 100)};
              border: 2px solid #260000;
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
          color: '#260000',
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
              border: 2px solid #260000;
              cursor: pointer;
              box-shadow: 0 2px 4px rgba(0, 0, 0, 0.3);
            }
            .color-picker-brightness-slider-${selectedHue}-${selectedSaturation}-${selectedBrightness}::-moz-range-thumb {
              width: 20px;
              height: 20px;
              border-radius: 50%;
              background: ${hsvToHex(selectedHue, selectedSaturation / 100, selectedBrightness / 100)};
              border: 2px solid #260000;
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
          color: '#260000',
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
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()}
          placeholder="#8B0000"
          style={{
            width: '100%',
            maxWidth: '100%',
            minWidth: '0',
            padding: '6px 8px',
            border: '1px solid #260000',
            borderRadius: '4px',
            backgroundColor: '#EFE8E5',
            color: '#260000',
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