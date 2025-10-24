import React, { useState, useRef, useEffect, useCallback } from 'react';
import { X, Palette, ArrowBigRightDash } from 'lucide-react';
import { NODE_DEFAULT_COLOR, HEADER_HEIGHT, MODAL_CLOSE_ICON_SIZE } from './constants';
import NodeGridItem from './NodeGridItem';
import ColorPicker from './ColorPicker';
import useGraphStore from "./store/graphStore.jsx";

const OldUnifiedSelector = ({ 
  mode, // 'node-creation', 'connection-creation', 'node-typing', or 'abstraction-node-creation'
  isVisible,
  onClose,
  onSubmit,
  initialName = '',
  initialColor = null,
  title,
  subtitle,
  position = null, // Optional custom position
  showCreateNewOption = false,
  searchTerm = '',
  onNodeSelect = null,
  selectedNodes = new Set(),
  abstractionDirection = 'above' // 'above' or 'below' for abstraction mode
}) => {
  const [name, setName] = useState(initialName);
  const lastInitialNameRef = useRef(initialName);
  
  // Update internal name when initialName changes (for clearing)
  useEffect(() => {
    // Only update when initialName actually changes from outside
    // This prevents overriding user input while they're typing
    if (initialName !== lastInitialNameRef.current) {
      lastInitialNameRef.current = initialName;
      setName(initialName);
    }
  }, [initialName]);
  const [color, setColor] = useState(initialColor || NODE_DEFAULT_COLOR);
  const [colorPickerVisible, setColorPickerVisible] = useState(false);
  const [colorPickerPosition, setColorPickerPosition] = useState({ x: 0, y: 0 });
  const scrollContainerRef = useRef(null);

  // Store access
  const nodePrototypesMap = useGraphStore(state => state.nodePrototypes);

  // Calculate position based on mode - simpler approach
  const containerPosition = React.useMemo(() => {
    if (position) return position;
    
    const windowWidth = typeof window !== 'undefined' ? window.innerWidth : 1200;
    const containerWidth = 300;
    const centerX = windowWidth / 2 - containerWidth / 2;
    
    return {
      x: centerX,
      y: HEADER_HEIGHT + 25
    };
  }, [position]);

  // Define showDialog and showGrid early
  const showDialog = mode === 'node-creation' || mode === 'connection-creation' || mode === 'abstraction-node-creation';
  const showGrid = mode === 'node-typing' || mode === 'abstraction-node-creation' || showCreateNewOption || onNodeSelect;

  // Filter prototypes based on search term - use name field as search for creation modes
  const filteredPrototypes = React.useMemo(() => {
    const prototypes = Array.from(nodePrototypesMap.values());
    // For node/connection/abstraction creation modes, use the name field as search
    // For node-typing mode, use the external searchTerm prop
    const searchText = (mode === 'node-creation' || mode === 'connection-creation' || mode === 'abstraction-node-creation') ? name : searchTerm;
    if (!searchText) return prototypes;
    return prototypes.filter(p => 
      p.name && p.name.toLowerCase().includes(searchText.toLowerCase())
    );
  }, [nodePrototypesMap, name, searchTerm, mode]);

  // Handle form submission
  const handleSubmit = useCallback(() => {
    if (name.trim() && onSubmit) {
      onSubmit({ name: name.trim(), color });
      // Clear the field immediately after submission
      setName('');
    }
  }, [name, onSubmit, color]);

  // Handle color picker - toggle behavior like PieMenu
  const handleColorPickerToggle = (element, event) => {
    event.stopPropagation();
    
    if (colorPickerVisible) {
      // If already open, close it (toggle off)
      setColorPickerVisible(false);
    } else {
      // If closed, open it
      const rect = element.getBoundingClientRect();
      setColorPickerPosition({
        x: rect.left,
        y: rect.bottom + 5
      });
      setColorPickerVisible(true);
    }
  };

  const handleColorChange = (newColor) => {
    setColor(newColor);
  };

  // Handle wheel events to prevent NodeCanvas panning
  const handleWheel = useCallback((e) => {
    e.stopPropagation(); // Stop NodeCanvas from receiving the event
    // Let the browser handle the actual scrolling
  }, []);


  // Keyboard handling
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (!isVisible) return;
      
      if (e.key === 'Escape') {
        onClose?.();
      } else if (e.key === 'Enter' && (mode === 'node-creation' || mode === 'connection-creation' || mode === 'abstraction-node-creation')) {
        handleSubmit();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isVisible, mode, onClose, handleSubmit]);

  // Add wheel event listener to prevent NodeCanvas panning
  useEffect(() => {
    const container = scrollContainerRef.current;
    if (container && isVisible) {
      container.addEventListener('wheel', handleWheel, { passive: false });
      return () => {
        container.removeEventListener('wheel', handleWheel, { passive: false });
      };
    }
  }, [isVisible, handleWheel]);




  if (!isVisible) return null;

  return (
    <>
      {/* Backdrop with blur effect */}
      <div 
        style={{ 
          position: 'fixed', 
          inset: 0, 
          backgroundColor: 'rgba(0,0,0,0.3)', 
          backdropFilter: 'blur(2px)',
          WebkitBackdropFilter: 'blur(2px)', // Safari support
          zIndex: 1000 
        }} 
        onClick={(e) => {
          if (e.target === e.currentTarget) {
            // Clear the field and permanently close color picker when clicking off/backing out
            setName('');
            setColorPickerVisible(false);
            onClose?.();
          }
        }}
      />

      {/* Main container with proper flex layout */}
      <div
        style={{
          position: 'fixed',
          left: '50%',
          transform: 'translateX(-50%)',
          top: containerPosition.y,
          bottom: '20px', // Match Panel.jsx bottomOffset={20}
          width: '300px',
          zIndex: 1001,
          display: 'flex',
          flexDirection: 'column',
          gap: '10px',
          pointerEvents: 'auto'
        }}
      >
        {/* Dialog for name input */}
        {showDialog && (
          <div
            style={{
              backgroundColor: '#bdb5b5',
              padding: '20px',
              borderRadius: '10px',
              boxShadow: '0 2px 10px rgba(0,0,0,0.2)',
              flexShrink: 0, // Don't shrink the dialog
              position: 'relative'
            }}
            onClick={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div style={{ position: 'absolute', top: '10px', right: '10px', cursor: 'pointer' }}>
              <X size={MODAL_CLOSE_ICON_SIZE} color="#999" onClick={() => {
                // Clear the field and permanently close color picker when clicking X
                setName('');
                setColorPickerVisible(false);
                onClose?.();
              }} />
            </div>
            
            <div style={{ textAlign: 'center', marginBottom: '15px', color: 'black' }}>
              <strong style={{ fontSize: '18px', fontFamily: "'EmOne', sans-serif" }}>{title}</strong>
            </div>
            
            {subtitle && (
              <div 
                style={{ textAlign: 'center', marginBottom: '15px', color: '#666', fontSize: '14px', fontFamily: "'EmOne', sans-serif" }}
                dangerouslySetInnerHTML={{ __html: subtitle }}
              />
            )}
            
            <div style={{ display: 'flex', alignItems: 'center' }}>
              <Palette
                size={20}
                color="#260000"
                style={{ cursor: 'pointer', flexShrink: 0, marginRight: '8px' }}
                onMouseDown={(e) => e.stopPropagation()}
                onClick={(e) => handleColorPickerToggle(e.currentTarget, e)}
                title="Change color"
              />
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => { 
                  if (e.key === 'Enter') handleSubmit(); 
                  if (e.key === 'Escape') {
                    // Clear the field and permanently close color picker when hitting Escape
                    setName('');
                    setColorPickerVisible(false);
                    onClose?.();
                  }
                }}
                style={{ 
                  flex: 1, 
                  padding: '10px', 
                  borderRadius: '5px', 
                  border: '1px solid #260000', 
                  marginRight: '10px' 
                }}
                autoFocus
              />
              <button
                onClick={handleSubmit}
                style={{ 
                  padding: '10px', 
                  backgroundColor: color, 
                  color: '#bdb5b5', 
                  border: 'none', 
                  borderRadius: '5px', 
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  minWidth: '50px',
                  minHeight: '44px'
                }}
                title={mode === 'connection-creation' ? 'Create connection type' : mode === 'abstraction-node-creation' ? `Create ${abstractionDirection} abstraction` : 'Create node type'}
              >
                <ArrowBigRightDash size={16} color="#bdb5b5" />
              </button>
            </div>
          </div>
        )}

        {/* Grid for node selection */}
        {showGrid && (
          <div
            ref={scrollContainerRef}
            style={{
              flex: 1, // Take up remaining space
              overflowY: 'auto', // Use native scrolling
              minHeight: 0, // Important for flex child to shrink properly
              padding: '12px'
            }}
          >
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr 1fr',
                gap: '12px',
                alignContent: 'start'
              }}
            >
              {/* Existing prototypes */}
              {filteredPrototypes.map(prototype => (
                <NodeGridItem
                  key={prototype.id}
                  nodePrototype={prototype}
                  onClick={() => onNodeSelect?.(prototype)}
                  isSelected={selectedNodes.has(prototype.id)}
                />
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Color Picker */}
      {colorPickerVisible && (
        <ColorPicker
          isVisible={colorPickerVisible}
          onClose={() => setColorPickerVisible(false)}
          onColorChange={handleColorChange}
          currentColor={color}
          position={colorPickerPosition}
          direction="down-left"
          parentContainerRef={null} // Use null since we changed the layout
        />
      )}
    </>
  );
};

export default OldUnifiedSelector;


