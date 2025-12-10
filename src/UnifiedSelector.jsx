import React, { useState, useRef, useEffect, useCallback } from 'react';
import { X, Palette, Plus } from 'lucide-react';
import { NODE_DEFAULT_COLOR, MODAL_CLOSE_ICON_SIZE } from './constants';
import useGraphStore from "./store/graphStore.jsx";
import ColorPicker from './ColorPicker';
import useViewportBounds from './hooks/useViewportBounds';
import useMobileDetection from './hooks/useMobileDetection';
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
  rightPanelExpanded = true,
  gridTitle = 'Browse All Things',
  searchOnly = false,
  allowedPrototypeIds = null
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
  const mobileState = useMobileDetection();

  const showDialog = mode === 'node-creation' || mode === 'connection-creation' || mode === 'abstraction-node-creation' || mode === 'node-typing' || mode === 'node-group-creation';
  const showGrid = mode === 'node-typing' || mode === 'abstraction-node-creation' || mode === 'node-group-creation' || showCreateNewOption || onNodeSelect;

  const filteredPrototypes = React.useMemo(() => {
    let prototypes = Array.from(nodePrototypesMap.values());
    // Restrict to allowed ids if provided
    if (allowedPrototypeIds && (allowedPrototypeIds.size || allowedPrototypeIds.length)) {
      const allowedSet = allowedPrototypeIds instanceof Set ? allowedPrototypeIds : new Set(allowedPrototypeIds);
      prototypes = prototypes.filter(p => allowedSet.has(p.id));
    }
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

  // Mobile detection with enhanced portrait mode support
  const isSmallScreen = mobileState.isMobile || mobileState.isTablet;
  const isMobilePortrait = mobileState.isMobilePortrait;
  const isExtraSmall = mobileState.width <= 480;

  // Layout measurements with responsive margins - minimized vertical space on desktop
  const outerMargin = isMobilePortrait ? 8 : (isSmallScreen ? 12 : 20);
  const sideMargin = isMobilePortrait ? 8 : (isSmallScreen ? 12 : 48);
  const horizontalPadding = outerMargin + sideMargin;
  const overlayMargin = isSmallScreen ? outerMargin : horizontalPadding;
  const overlayWidth = Math.max(
    280,
    bounds.width - (isSmallScreen ? outerMargin * 2 : horizontalPadding * 2)
  );
  const overlayHeight = Math.max(260, bounds.height - outerMargin * 2);
  const containerMaxWidth = isMobilePortrait
    ? Math.min(mobileState.width - 16, overlayWidth)
    : Math.min(overlayWidth, Math.max(600, Math.floor(bounds.windowWidth * 0.9)));
  
  // UPDATED: Increased dialog width and limits
  const dialogWidth = isSmallScreen
    ? containerMaxWidth
    : Math.min(containerMaxWidth * 0.75, Math.max(500, Math.floor(bounds.windowWidth * 0.5)));
    
  const gridOuterWidth = containerMaxWidth;
  const gridInnerPadding = isMobilePortrait ? 10 : (isSmallScreen ? 12 : 16);

  // Grid responsive columns with smaller cards - optimized for mobile portrait, compact on desktop
  const cardMinWidth = isMobilePortrait ? (isExtraSmall ? 110 : 130) : (isSmallScreen ? 120 : 115);
  const minimumColumns = isMobilePortrait ? (isExtraSmall ? 2 : 2) : (isSmallScreen ? 1 : 2);
  const columns = Math.max(
    minimumColumns,
    Math.floor((gridOuterWidth - gridInnerPadding * 2) / (cardMinWidth + 12))
  );
  const dialogTitleSize = isMobilePortrait ? '16px' : (isSmallScreen ? '18px' : '18px');
  const subtitleFontSize = isMobilePortrait ? '13px' : (isSmallScreen ? '14px' : '14px');
  const inputPadding = isMobilePortrait ? '10px' : (isSmallScreen ? '9px' : '9px');
  const actionButtonMinWidth = isMobilePortrait ? '52px' : (isSmallScreen ? '48px' : '48px');
  const actionButtonMinHeight = isMobilePortrait ? '52px' : (isSmallScreen ? '48px' : '40px');
  const cardHeight = isMobilePortrait ? (isExtraSmall ? '100px' : '105px') : (isSmallScreen ? '110px' : '75px');
  const gridTemplateColumns = `repeat(${columns}, 1fr)`;

  // Touch-friendly sizing on mobile, compact on desktop
  const iconSize = isMobilePortrait ? 22 : 18;
  const closeIconSize = isMobilePortrait ? 22 : 18;

  return (
    <>
      <div
        style={{
          position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.3)',
          backdropFilter: 'blur(2px)', WebkitBackdropFilter: 'blur(2px)', zIndex: 1000
        }}
        onPointerDown={(e) => e.stopPropagation()} // Stop propagation on backdrop too to prevent canvas panning
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
          left: `${Math.round(bounds.x + overlayMargin)}px`,
          top: `${Math.round(bounds.y + outerMargin)}px`,
          width: `${Math.round(overlayWidth)}px`,
          height: `${Math.round(overlayHeight)}px`,
          zIndex: 1001,
          display: 'flex',
          flexDirection: 'column',
          gap: isSmallScreen ? '12px' : '18px',
          pointerEvents: 'none'
        }}
      >
        {showDialog && (
          <div
            onPointerDown={(e) => e.stopPropagation()} // Isolate from canvas
            style={{
              alignSelf: 'center',
              width: `${dialogWidth}px`,
              backgroundColor: '#bdb5b5',
              padding: isSmallScreen ? '16px' : '14px 16px',
              borderRadius: '12px',
              boxShadow: '0 2px 10px rgba(0,0,0,0.2)',
              position: 'relative',
              flexShrink: 0,
              maxWidth: '100%',
              pointerEvents: 'auto'
            }}
            onClick={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div
              style={{
                position: 'absolute',
                top: isMobilePortrait ? '8px' : '10px',
                right: isMobilePortrait ? '8px' : '10px',
                cursor: 'pointer',
                padding: isMobilePortrait ? '4px' : '0',
                touchAction: 'manipulation'
              }}
              onPointerDown={(e) => e.stopPropagation()}
            >
              <X size={closeIconSize} color="#999" onClick={() => { setName(''); setColorPickerVisible(false); onClose?.(); }} />
            </div>
            <div style={{ textAlign: 'left', marginBottom: isSmallScreen ? '15px' : '10px', color: 'black' }}>
              <strong style={{ fontSize: dialogTitleSize, fontFamily: "'EmOne', sans-serif" }}>{title}</strong>
            </div>
            {subtitle && (
              <div
                style={{ textAlign: 'left', marginBottom: isSmallScreen ? '15px' : '10px', color: '#666', fontSize: subtitleFontSize, fontFamily: "'EmOne', sans-serif" }}
                dangerouslySetInnerHTML={{ __html: subtitle }}
              />
            )}
            <div style={{ display: 'flex', alignItems: 'center', gap: isSmallScreen ? '6px' : '8px' }}>
              {!searchOnly && (
                <Palette
                  size={iconSize}
                  color="#260000"
                  style={{
                    cursor: 'pointer',
                    flexShrink: 0,
                    touchAction: 'manipulation',
                    padding: isMobilePortrait ? '4px' : '0'
                  }}
                  onPointerDown={(e) => e.stopPropagation()}
                  onMouseDown={(e) => e.stopPropagation()}
                  onClick={(e) => handleColorPickerToggle(e.currentTarget, e)}
                  title="Change color"
                />
              )}
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleSubmit();
                  if (e.key === 'Escape') { setName(''); setColorPickerVisible(false); onClose?.(); }
                }}
                style={{
                  flex: 1,
                  minWidth: 0, // Enable shrinking
                  padding: inputPadding,
                  borderRadius: '6px',
                  border: '1px solid #260000',
                  marginRight: searchOnly ? 0 : (isSmallScreen ? '6px' : '10px'),
                  fontSize: isMobilePortrait ? '15px' : '14px',
                  touchAction: 'manipulation',
                  backgroundColor: '#260000',
                  color: '#bdb5b5',
                  fontFamily: "'EmOne', sans-serif"
                }}
                autoFocus={false}
              />
              {!searchOnly && (
                <button
                  onClick={handleSubmit}
                  onPointerDown={(e) => e.stopPropagation()}
                  style={{
                    padding: inputPadding,
                    backgroundColor: color,
                    color: '#bdb5b5',
                    border: 'none',
                    borderRadius: '8px',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    minWidth: `${actionButtonMinWidth}px`,
                    minHeight: `${actionButtonMinHeight}px`,
                    touchAction: 'manipulation'
                  }}
                  title={mode === 'connection-creation' ? 'Create connection type' : mode === 'abstraction-node-creation' ? `Create ${abstractionDirection} abstraction` : mode === 'node-group-creation' ? 'Create new Thing defined by this Group' : 'Create node type'}
                >
                  <Plus size={iconSize} color="#bdb5b5" strokeWidth={2.5} />
                </button>
              )}
            </div>
          </div>
        )}

        {showGrid && (
          <div
            style={{ flex: 1, overflow: 'hidden', display: 'flex', justifyContent: 'center', width: '100%', minHeight: 0, pointerEvents: 'auto' }}
          >
            {/* Outer rounded rectangle */}
            <div
              onPointerDown={(e) => e.stopPropagation()} // Isolate from canvas
              style={{
                width: isSmallScreen ? '100%' : `${gridOuterWidth}px`,
                maxWidth: `${gridOuterWidth}px`,
                height: '100%',
                backgroundColor: '#bdb5b5',
                borderRadius: isSmallScreen ? '16px' : '14px',
                boxShadow: '0 2px 10px rgba(0,0,0,0.2)',
                display: 'flex',
                flexDirection: 'column',
                minHeight: 0
              }}
            >
              {/* Header area inside outer, reserved for future buttons */}
              <div
                style={{
                  padding: isSmallScreen ? '12px 14px' : '10px 16px',
                  borderTopLeftRadius: '16px',
                  borderTopRightRadius: '16px',
                  color: '#260000',
                  fontFamily: "'EmOne', sans-serif",
                  fontWeight: 'bold',
                  fontSize: isSmallScreen ? '15px' : '14px',
                  flexShrink: 0
                }}
              >
                {gridTitle}
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
                    minHeight: 0,
                    // Custom scrollbar styling
                    scrollbarWidth: 'thin',
                    scrollbarColor: '#bdb5b5 transparent',
                    touchAction: 'pan-y'
                  }}
                  className="unified-selector-scroll"
                >
                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: gridTemplateColumns,
                      gap: isSmallScreen ? '10px' : '8px',
                      alignContent: 'start'
                    }}
                  >
                    {filteredPrototypes.map(prototype => (
                      <div
                        key={prototype.id}
                        style={{
                          background: prototype.color || '#8B0000',
                          borderRadius: isMobilePortrait ? '14px' : (isSmallScreen ? '16px' : '14px'),
                          padding: isMobilePortrait ? '10px' : (isSmallScreen ? '12px' : '10px'),
                          cursor: 'pointer',
                          transition: 'all 0.2s ease',
                          height: cardHeight,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          position: 'relative',
                          touchAction: 'manipulation',
                          WebkitTapHighlightColor: 'transparent'
                        }}
                        onMouseEnter={(e) => {
                          if (!mobileState.isTouchDevice) {
                            e.currentTarget.style.transform = 'scale(1.03)';
                            e.currentTarget.style.filter = 'brightness(1.1)';
                            e.currentTarget.style.boxShadow = '0 4px 12px rgba(0, 0, 0, 0.2)';
                          }
                        }}
                        onMouseLeave={(e) => {
                          if (!mobileState.isTouchDevice) {
                            e.currentTarget.style.transform = 'scale(1)';
                            e.currentTarget.style.filter = 'brightness(1)';
                            e.currentTarget.style.boxShadow = 'none';
                          }
                        }}
                        onPointerDown={(e) => e.stopPropagation()}
                        onClick={(e) => {
                          e.stopPropagation();
                          onNodeSelect?.(prototype);
                        }}
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
                            fontSize: isMobilePortrait ? (isExtraSmall ? '11px' : '12px') : (isSmallScreen ? '13px' : '12px'),
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
