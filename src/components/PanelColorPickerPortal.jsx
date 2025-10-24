import React from 'react';
import { createPortal } from 'react-dom';
import ColorPicker from '../ColorPicker';

const PanelColorPickerPortal = ({ 
  isVisible, 
  onClose, 
  onColorChange, 
  currentColor, 
  position, 
  direction = 'down-left' 
}) => {
  if (!isVisible) return null;

  // Render the color picker in a portal at the document body level
  // This prevents it from being clipped by panel overflow boundaries
  return createPortal(
    <ColorPicker
      isVisible={isVisible}
      onClose={onClose}
      onColorChange={onColorChange}
      currentColor={currentColor}
      position={position}
      direction={direction}
    />,
    document.body
  );
};

export default PanelColorPickerPortal;
