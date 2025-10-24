import React, { useState, useRef, useEffect, useCallback } from 'react';
import { X, Palette, Plus } from 'lucide-react';
import { NODE_DEFAULT_COLOR, MODAL_CLOSE_ICON_SIZE } from './constants';
import useGraphStore from "./store/graphStore.jsx";
import ColorPicker from './ColorPicker';
import useViewportBounds from './hooks/useViewportBounds';
import './UnifiedSelector.css';

const UnifiedSelector = ({ 
  mode,
  isVisible,
  onClose,
  onSubmit,
  initialName = '',
  initialColor = null,
  title,
  subtitle,
  showCreateNewOption = false,
  searchTerm = '',
  onNodeSelect = null,
  selectedNodes = new Set(),
  abstractionDirection = 'above',
  leftPanelExpanded = true,
  rightPanelExpanded = true
}) => {
  const [name, setName] = useState(initialName);
  const lastInitialNameRef = useRef(initialName);

  useEffect(() => {
    if (initialName !== lastInitialNameRef.current) {
      lastInitialNameRef.current = initialName;
      setName(initialName);
    }
  }, [initialName]);

  const [color, setColor] = useState(() => {
    if (initialColor) return initialColor;
    // Use red for connections, normal default for nodes
    if (mode === 'connection-creation') {
      return '#8B0000'; // Red for connections
    }
    return NODE_DEFAULT_COLOR; // Normal default for nodes
  });
  const [colorPickerVisible, setColorPickerVisible] = useState(false);
  const [colorPickerPosition, setColorPickerPosition] = useState({ x: 0, y: 0 });

  const nodePrototypesMap = useGraphStore(state => state.nodePrototypes);

  const bounds = useViewportBounds(leftPanelExpanded, rightPanelExpanded);

  const showDialog = mode === 'node-creation' || mode === 'connection-creation' || mode === 'abstraction-node-creation' || mode === 'node-typing' || mode === 'node-group-creation';
  const showGrid = mode === 'node-typing' || mode === 'abstraction-node-creation' || mode === 'node-group-creation' || showCreateNewOption || onNodeSelect;

  const filteredPrototypes = React.useMemo(() => {
    const prototypes = Array.from(nodePrototypesMap.values());
    // Always use 'name' for live search when typing, fallback to searchTerm for initial filter
    const searchText = name || searchTerm;
    if (!searchText) return prototypes;
    return prototypes.filter(p => p.name && p.name.toLowerCase().includes(searchText.toLowerCase()));
  }, [nodePrototypesMap, name, searchTerm]);

  const handleSubmit = useCallback(() => {
    if (name.trim() && onSubmit) {
      onSubmit({ name: name.trim(), color });
      setName('');
    }
  }, [name, onSubmit, color]);

  const handleColorPickerToggle = (element, event) => {
    event.stopPropagation();
    if (colorPickerVisible) {
      setColorPickerVisible(false);
    } else {
      const rect = element.getBoundingClientRect();
      setColorPickerPosition({ x: rect.left, y: rect.bottom + 5 });
      setColorPickerVisible(true);
    }
  };

  const handleColorChange = (newColor) => setColor(newColor);

  const scrollContainerRef = useRef(null);

  // Handle wheel events for scrolling
  const handleWheel = useCallback((e) => {
    e.stopPropagation(); // Prevent NodeCanvas from receiving the event
    // Let the browser handle the actual scrolling naturally
  }, []);

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (!isVisible) return;
      if (e.key === 'Escape') onClose?.();
      else if (e.key === 'Enter' && (mode === 'node-creation' || mode === 'connection-creation' || mode === 'abstraction-node-creation' || mode === 'node-typing' || mode === 'node-group-creation')) {
        handleSubmit();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isVisible, mode, onClose, handleSubmit]);

  // Add wheel event listener to the scroll container
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

  // Layout measurements with more margins
  const outerMargin = 32; // Increased outer margin for more breathing room
  const sideMargin = 48; // Additional left/right margins
  const containerMaxWidth = Math.min(bounds.width - (outerMargin + sideMargin) * 2, Math.max(720, Math.floor(bounds.windowWidth * 0.8)));
  const dialogWidth = Math.min(containerMaxWidth * 0.6, Math.max(420, Math.floor(bounds.windowWidth * 0.4))); // Even narrower dialog
  const gridOuterWidth = Math.min(containerMaxWidth, bounds.width - (outerMargin + sideMargin) * 2);
  const gridInnerPadding = 16;

  // Grid responsive columns with smaller cards
  const cardMinWidth = 140; // Smaller minimum width for more columns
  const columns = Math.max(2, Math.floor((gridOuterWidth - gridInnerPadding * 2) / (cardMinWidth + 12)));
  const gridTemplateColumns = `repeat(${columns}, 1fr)`;

  return (
    <>
      <div 
        style={{ 
          position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.3)',
          backdropFilter: 'blur(2px)', WebkitBackdropFilter: 'blur(2px)', zIndex: 1000 
        }} 
        onClick={(e) => {
          if (e.target === e.currentTarget) {
            setName('');
            setColorPickerVisible(false);
            onClose?.();
          }
        }}
      />

      <div
        style={{
          position: 'fixed',
          left: `${Math.round(bounds.x + outerMargin + sideMargin)}px`,
          top: `${Math.round(bounds.y + outerMargin)}px`,
          width: `${Math.round(bounds.width - (outerMargin + sideMargin) * 2)}px`,
          height: `${Math.round(bounds.height - outerMargin * 2)}px`,
          zIndex: 1001,
          display: 'flex',
          flexDirection: 'column',
          gap: '18px',
          pointerEvents: 'auto'
        }}
      >
        {showDialog && (
          <div
            style={{
              alignSelf: 'center',
              width: `${dialogWidth}px`,
              backgroundColor: '#bdb5b5',
              padding: '20px',
              borderRadius: '12px',
              boxShadow: '0 2px 10px rgba(0,0,0,0.2)',
              position: 'relative',
              flexShrink: 0
            }}
            onClick={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div style={{ position: 'absolute', top: '10px', right: '10px', cursor: 'pointer' }}>
              <X size={MODAL_CLOSE_ICON_SIZE} color="#999" onClick={() => { setName(''); setColorPickerVisible(false); onClose?.(); }} />
            </div>
            <div style={{ textAlign: 'left', marginBottom: '15px', color: 'black' }}>
              <strong style={{ fontSize: '22px', fontFamily: "'EmOne', sans-serif" }}>{title}</strong>
            </div>
            {subtitle && (
              <div 
                style={{ textAlign: 'left', marginBottom: '15px', color: '#666', fontSize: '16px', fontFamily: "'EmOne', sans-serif" }}
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
                  if (e.key === 'Escape') { setName(''); setColorPickerVisible(false); onClose?.(); }
                }}
                style={{ flex: 1, padding: '10px', borderRadius: '6px', border: '1px solid #260000', marginRight: '10px' }}
                autoFocus
              />
              <button
                onClick={handleSubmit}
                style={{ padding: '10px', backgroundColor: color, color: '#bdb5b5', border: 'none', borderRadius: '8px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', minWidth: '56px', minHeight: '44px' }}
                title={mode === 'connection-creation' ? 'Create connection type' : mode === 'abstraction-node-creation' ? `Create ${abstractionDirection} abstraction` : mode === 'node-group-creation' ? 'Create new Thing defined by this Group' : 'Create node type'}
              >
                <Plus size={18} color="#bdb5b5" strokeWidth={2.5} />
              </button>
            </div>
          </div>
        )}

        {showGrid && (
          <div
            style={{ flex: 1, overflow: 'hidden', display: 'flex', justifyContent: 'center' }}
          >
            {/* Outer rounded rectangle */}
            <div
              style={{
                width: `${gridOuterWidth}px`,
                height: '100%',
                backgroundColor: '#bdb5b5',
                borderRadius: '16px',
                boxShadow: '0 2px 10px rgba(0,0,0,0.2)',
                display: 'flex',
                flexDirection: 'column',
              }}
            >
              {/* Header area inside outer, reserved for future buttons */}
              <div
                style={{
                  padding: '14px 18px',
                  borderTopLeftRadius: '16px',
                  borderTopRightRadius: '16px',
                  color: '#260000',
                  fontFamily: "'EmOne', sans-serif",
                  fontWeight: 'bold',
                  fontSize: '16px',
                  flexShrink: 0
                }}
              >
                Browse All Things
              </div>
              {/* Inner rectangle with 5px border spacing on all sides */}
              <div
                style={{
                  flex: 1,
                  margin: '0 5px 5px 5px',
                  backgroundColor: '#979090',
                  borderRadius: '11px', // Fully rounded inner rectangle
                  overflow: 'hidden',
                  display: 'flex',
                  flexDirection: 'column'
                }}
              >
                <div
                  ref={scrollContainerRef}
                  style={{
                    flex: 1,
                    overflowY: 'auto',
                    padding: `${gridInnerPadding}px`,
                    // Custom scrollbar styling
                    scrollbarWidth: 'thin',
                    scrollbarColor: '#bdb5b5 transparent',
                  }}
                  className="unified-selector-scroll"
                >
                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: gridTemplateColumns,
                      gap: '10px',
                      alignContent: 'start'
                    }}
                  >
                    {filteredPrototypes.map(prototype => (
                      <div 
                        key={prototype.id} 
                        style={{ 
                          background: prototype.color || '#8B0000', 
                          borderRadius: '16px', // More rounding
                          padding: '12px',
                          cursor: 'pointer',
                          transition: 'all 0.2s ease',
                          height: '90px', // Fixed smaller height
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          position: 'relative'
                        }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.transform = 'scale(1.03)';
                          e.currentTarget.style.filter = 'brightness(1.1)';
                          e.currentTarget.style.boxShadow = '0 4px 12px rgba(0, 0, 0, 0.2)';
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.transform = 'scale(1)';
                          e.currentTarget.style.filter = 'brightness(1)';
                          e.currentTarget.style.boxShadow = 'none';
                        }}
                        onClick={() => onNodeSelect?.(prototype)}
                      >
                        {/* Thumbnail background if available */}
                        {prototype.thumbnailSrc && (
                          <div
                            style={{
                              position: 'absolute',
                              top: 0, left: 0, right: 0, bottom: 0,
                              backgroundImage: `url(${prototype.thumbnailSrc})`,
                              backgroundSize: 'cover',
                              backgroundPosition: 'center',
                              borderRadius: '16px', // Match container rounding
                              opacity: 0.3
                            }}
                          />
                        )}
                        <span 
                          style={{ 
                            color: '#bdb5b5', 
                            fontWeight: 'bold', 
                            fontFamily: "'EmOne', sans-serif", 
                            textAlign: 'center',
                            fontSize: '13px',
                            lineHeight: '1.2',
                            wordWrap: 'break-word',
                            position: 'relative',
                            zIndex: 1,
                            textShadow: '0 1px 2px rgba(0, 0, 0, 0.5)',
                            maxWidth: '100%',
                            overflow: 'hidden',
                            display: '-webkit-box',
                            WebkitLineClamp: 3,
                            WebkitBoxOrient: 'vertical'
                          }}
                        >
                          {prototype.name}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {colorPickerVisible && (
        <ColorPicker
          isVisible={colorPickerVisible}
          onClose={() => setColorPickerVisible(false)}
          onColorChange={handleColorChange}
          currentColor={color}
          position={colorPickerPosition}
          direction="down-left"
          parentContainerRef={null}
        />
      )}
    </>
  );
};

export default UnifiedSelector;