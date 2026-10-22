import React, { useState, useRef, useEffect, useCallback } from 'react';
import { sanitizeColor } from './utils/safeColor.js';
import { cssImageUrl } from './utils/safeUrl.js';
import { createPortal } from 'react-dom';
import { Palette, Plus, ChevronLeft, Search } from 'lucide-react';
import { NODE_DEFAULT_COLOR } from './constants';
import { getTextColor } from './utils/colorUtils';
import { LIGHT_MODE_BG_COLOR } from './utils/themeColors';
import useGraphStore from "./store/graphStore.js";
import ColorPicker from './ColorPicker';
import useViewportBounds from './hooks/useViewportBounds';
import useMobileDetection from './hooks/useMobileDetection';
import { useTheme } from './hooks/useTheme.js';
import PanelIconButton from './components/shared/PanelIconButton';
import { haptic } from './services/haptics.js';
import './components/canvas/formats/formats.css';
import './UnifiedSelector.css';


const UnifiedSelector = ({
  mode,
  isVisible,
  onClose,
  onSubmit,
  initialName = '',
  initialColor = null,
  // The prompt's one line of copy, a call to action ("Name a Thing"). It
  // heads the box of Things; with no box, it sits above the name field.
  title,
  placeholder = '',
  showCreateNewOption = false,
  searchTerm = '',
  onNodeSelect = null,
  selectedNodes = new Set(),
  abstractionDirection = 'above',
  leftPanelExpanded = true,
  rightPanelExpanded = true,
  searchOnly = false,
  allowedPrototypeIds = null,
  // A page of something else in the grid's box (its own cards) instead of the
  // Things, with a Back to Things pill in place of the name field: a second
  // step that keeps the first step's layout (canvas/thingGroupPrompt).
  gridContent = null,
  onBack = null,
}) => {
  const theme = useTheme();
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

  const bounds = useViewportBounds(false, false);
  const mobileState = useMobileDetection();

  // 'web-creation' names the Thing that defines a new Web. It wants both halves:
  // the dialog authors a new defining Thing, the grid hands the job to one that
  // already exists.
  const showDialog = (searchOnly || mode === 'node-creation' || mode === 'connection-creation' || mode === 'abstraction-node-creation' || mode === 'node-typing' || mode === 'node-group-creation' || mode === 'web-creation');
  const showGrid = !!gridContent || mode === 'node-typing' || mode === 'abstraction-node-creation' || mode === 'node-group-creation' || mode === 'web-creation' || showCreateNewOption || onNodeSelect;

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
      // The + button, its touch path, and the Enter key all funnel through here,
      // past the empty-name guard, so this is the one place that means "something
      // was actually created". Medium impact rather than the menuSelect that
      // opened this dialog: every mode here brings a new Thing, connection type,
      // abstraction, or group into existence, and creation carries the weight.
      haptic('nodeSpawn');
      onSubmit({ name: name.trim(), color });
      setName('');
    }
  }, [name, onSubmit, color]);

  /**
   * A card in the grid is chosen. Both the touch path and the click path funnel
   * through here so the feedback can't diverge between them.
   *
   * menuSelect, not the nodeSpawn that handleSubmit fires a few pixels above it,
   * and the gap between them is the point: picking a card reuses a Thing that
   * already exists — as a type, an abstraction layer, a group member — where the
   * + button authors a new one. That's this table's standing rule (see nodeSpawn),
   * and honouring it here means the same dialog can say "reused" and "created"
   * in two different weights.
   */
  const handleNodeSelect = useCallback((prototype) => {
    haptic('menuSelect');
    onNodeSelect?.(prototype);
  }, [onNodeSelect]);

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
  const touchHandledRef = useRef(false);
  const cardTouchRef = useRef({ x: 0, y: 0, moved: false });

  // Handle wheel events for scrolling
  const handleWheel = useCallback((e) => {
    e.stopPropagation(); // Prevent NodeCanvas from receiving the event
    // Let the browser handle the actual scrolling naturally
  }, []);

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (!isVisible) return;
      if (e.key === 'Escape') onClose?.();
      else if (e.key === 'Enter' && (mode === 'node-creation' || mode === 'connection-creation' || mode === 'abstraction-node-creation' || mode === 'node-typing' || mode === 'node-group-creation' || mode === 'web-creation')) {
        handleSubmit();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isVisible, mode, onClose, handleSubmit]);

  /**
   * While any selector is open, Backspace/Delete must never reach the canvas.
   *
   * The name field is deliberately not autofocused, so a Backspace aimed at the
   * text lands on document.body instead, bubbles to the window listener in
   * useCanvasKeyboard, and deletes whatever node is still selected underneath —
   * most visibly the node whose abstraction carousel opened this dialog. Every
   * caller would otherwise need its own prompt flag threaded into that hook's
   * isInputActive check; owning it here covers all of them at once.
   *
   * Capture on window fires ahead of every bubble-phase listener, and
   * stopImmediatePropagation covers the other window-capture listeners too.
   * Editable targets are passed through untouched so typing still erases text.
   */
  useEffect(() => {
    if (!isVisible) return;
    const swallowDestructiveKeys = (e) => {
      if (e.key !== 'Backspace' && e.key !== 'Delete') return;
      const t = e.target;
      const isEditableTarget = t && (
        t.tagName === 'INPUT' ||
        t.tagName === 'TEXTAREA' ||
        t.isContentEditable === true
      );
      if (isEditableTarget) return;
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
    };
    window.addEventListener('keydown', swallowDestructiveKeys, true);
    return () => window.removeEventListener('keydown', swallowDestructiveKeys, true);
  }, [isVisible]);

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

  // Grid responsive columns - now handled via CSS auto-fill for true dynamic behavior
  const cardMinWidth = isMobilePortrait ? (isExtraSmall ? 110 : 130) : (isSmallScreen ? 120 : 115);
  // The pill's two round buttons, one size so the pill's ends match.
  const buttonSize = isMobilePortrait ? '44px' : '38px';
  const iconSize = isMobilePortrait ? 24 : 20;
  const cardHeight = isMobilePortrait ? (isExtraSmall ? '100px' : '105px') : (isSmallScreen ? '110px' : '75px');

  const content = (
    <>
      <div
        className="unified-selector-overlay"
        style={{
          position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.3)',
          backdropFilter: 'blur(2px)', WebkitBackdropFilter: 'blur(2px)', zIndex: 999998,
          touchAction: 'manipulation'
        }}
        onPointerDown={(e) => e.stopPropagation()} // Stop propagation on backdrop too to prevent canvas panning
        onTouchEnd={(e) => {
          if (e.target === e.currentTarget) {
            // Cancel the compat mouse sequence before it can reach the canvas
            // this backdrop is about to stop covering — see the close button
            // below. The touchHandledRef window stays as well, for the case
            // where the backdrop survives the tap.
            if (e.cancelable) e.preventDefault();
            touchHandledRef.current = true;
            setName('');
            setColorPickerVisible(false);
            onClose?.();
            setTimeout(() => { touchHandledRef.current = false; }, 400);
          }
        }}
        onClick={(e) => {
          if (touchHandledRef.current) return;
          if (e.target === e.currentTarget) {
            setName('');
            setColorPickerVisible(false);
            onClose?.();
          }
        }}
      />

      <div
        className="unified-selector-overlay"
        style={{
          position: 'fixed',
          left: `${Math.round(bounds.x + overlayMargin)}px`,
          top: `${Math.round(bounds.y + outerMargin)}px`,
          width: `${Math.round(overlayWidth)}px`,
          height: `${Math.round(overlayHeight)}px`,
          zIndex: 999999,
          display: 'flex',
          flexDirection: 'column',
          // On mobile, vertically center the dialog inside the bounds rather
          // than letting it sit at the top. The dialog already uses
          // alignSelf: 'center' for the horizontal axis.
          justifyContent: mobileState.isMobile ? 'center' : 'flex-start',
          gap: isSmallScreen ? '12px' : '18px',
          pointerEvents: 'none'
        }}
      >
        {showDialog && (
          // The name field as a pill: the formula composer's (formats.css), so
          // the prompts read as the same family. No close button; the backdrop
          // and Escape close it.
          <div
            className="unified-selector-prompt"
            onPointerDown={(e) => e.stopPropagation()} // Isolate from canvas
            style={{
              width: `${dialogWidth}px`,
              marginTop: isSmallScreen ? '8px' : '28px',
              fontSize: isMobilePortrait ? '15px' : '14px'
            }}
            onClick={(e) => e.stopPropagation()}
            onTouchEnd={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
          >
            {onBack ? (
              // The whole pill is the button, like Back to Civilization.
              <span style={{ display: 'contents' }} onTouchEnd={(e) => { if (e.cancelable) e.preventDefault(); }}>
                <button type="button" className="format-pill" onClick={onBack}>
                  <ChevronLeft size={16} strokeWidth={2.75} />
                  Back to Things
                </button>
              </span>
            ) : !showGrid && (
              <div className="unified-selector-label">
                <span className="unified-selector-label-text">{title}</span>
              </div>
            )}
            {!gridContent && (
              <div className="format-pill unified-selector-pill">
                {searchOnly ? (
                  <span className="unified-selector-pill-icon" aria-hidden="true" style={{ width: buttonSize, height: buttonSize }}>
                    <Search size={iconSize - 2} strokeWidth={2.5} />
                  </span>
                ) : (
                  <PanelIconButton
                    icon={Palette}
                    size={iconSize}
                    color="maroon"
                    active={colorPickerVisible}
                    // Handles for the game controller: the first marks this as a
                    // walkable row in the top dialog, the second is what Y clicks
                    // to open and close the picker.
                    className="unified-selector-control unified-selector-color-button"
                    onClick={(e) => handleColorPickerToggle(e.currentTarget, e)}
                    title="Change color"
                    ariaExpanded={colorPickerVisible}
                    ariaHasPopup="dialog"
                    style={{ minWidth: buttonSize, minHeight: buttonSize, flexShrink: 0, touchAction: 'manipulation' }}
                  />
                )}
                <input
                  className="unified-selector-control"
                  type="text"
                  value={name}
                  placeholder={placeholder}
                  onChange={(e) => setName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleSubmit();
                    if (e.key === 'Escape') { setName(''); setColorPickerVisible(false); onClose?.(); }
                  }}
                  autoFocus={false}
                />
                {!searchOnly && (
                  // display: contents so this adds no box to the row — it exists
                  // only to catch the button's touchend on the way up and suppress
                  // the delayed synthesized click that would otherwise land on the
                  // canvas after this dialog closes, cancelling the morphing plus
                  // sign or spawning a stray one.
                  <span
                    style={{ display: 'contents' }}
                    onTouchEnd={(e) => { if (e.cancelable) e.preventDefault(); }}
                  >
                    <PanelIconButton
                      className="unified-selector-control"
                      icon={Plus}
                      size={iconSize}
                      strokeWidth={2.5}
                      // The glyph carries the colour the node's own text would
                      // take on this fill, so the button previews the node it
                      // is about to make. Hover hands both back to
                      // PanelIconButton's pie-bubble treatment.
                      color={getTextColor(color, theme.darkMode)}
                      onClick={handleSubmit}
                      title={mode === 'connection-creation' ? 'Create connection type' : mode === 'abstraction-node-creation' ? `Create ${abstractionDirection} abstraction` : mode === 'node-group-creation' ? 'Create new Thing defined by this Group' : mode === 'web-creation' ? 'Create new Thing and open its Web' : 'Create node type'}
                      // Square, so the component's 50% radius reads as a circle.
                      style={{ backgroundColor: color, minWidth: buttonSize, minHeight: buttonSize, flexShrink: 0, touchAction: 'manipulation' }}
                    />
                  </span>
                )}
              </div>
            )}
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
                // The pill's colours (formats.css .format-pill), so the box
                // reads as the same family as the name field above it.
                backgroundColor: '#DEDADA',
                border: '2px solid maroon',
                borderRadius: isSmallScreen ? '16px' : '14px',
                boxShadow: '0 2px 10px rgba(0,0,0,0.2)',
                display: 'flex',
                flexDirection: 'column',
                minHeight: 0,
                boxSizing: 'border-box'
              }}
            >
              {/* Header area inside outer, reserved for future buttons */}
              <div
                style={{
                  padding: isSmallScreen ? '12px 14px' : '10px 16px',
                  borderTopLeftRadius: '16px',
                  borderTopRightRadius: '16px',
                  color: 'maroon',
                  fontFamily: "'EmOne', sans-serif",
                  fontWeight: 'bold',
                  fontSize: isSmallScreen ? '15px' : '14px',
                  flexShrink: 0
                }}
              >
                {title}
              </div>
              {/* Inner rectangle with 5px border spacing on all sides */}
              <div
                style={{
                  flex: 1,
                  margin: '0 5px 5px 5px',
                  // The light canvas colour in both modes: a step darker than
                  // the pill-coloured frame, like the frame itself unthemed.
                  backgroundColor: LIGHT_MODE_BG_COLOR,
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
                    touchAction: 'pan-y'
                  }}
                  className="unified-selector-scroll"
                >
                  {gridContent || <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: `repeat(auto-fill, minmax(${cardMinWidth}px, 1fr))`,
                      gap: isSmallScreen ? '10px' : '8px',
                      alignContent: 'start'
                    }}
                  >
                    {filteredPrototypes.map(prototype => (
                      <div
                        key={prototype.id}
                        // Handle for the game controller's grid walker — the
                        // cards are otherwise styled entirely inline, with no
                        // selector to navigate by. See utils/gamepadMenuNav.js.
                        className="unified-selector-card"
                        style={{
                          background: sanitizeColor(prototype.color, '#8B0000'),
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
                        onTouchStart={(e) => {
                          const t = e.touches[0];
                          cardTouchRef.current = { x: t.clientX, y: t.clientY, moved: false };
                        }}
                        onTouchMove={(e) => {
                          const t = e.touches[0];
                          const dx = t.clientX - cardTouchRef.current.x;
                          const dy = t.clientY - cardTouchRef.current.y;
                          if (dx * dx + dy * dy > 100) {
                            cardTouchRef.current.moved = true;
                          }
                        }}
                        onTouchEnd={(e) => {
                          e.stopPropagation();
                          if (cardTouchRef.current.moved) return;
                          // Suppress the delayed synthesized click that would
                          // otherwise land on the canvas after this dialog closes
                          // (a scroll gesture already bailed above, so taps only).
                          if (e.cancelable) e.preventDefault();
                          touchHandledRef.current = true;
                          handleNodeSelect(prototype);
                          setTimeout(() => { touchHandledRef.current = false; }, 400);
                        }}
                        onClick={(e) => {
                          if (touchHandledRef.current) return;
                          e.stopPropagation();
                          handleNodeSelect(prototype);
                        }}
                      >
                        {/* Thumbnail background if available */}
                        {cssImageUrl(prototype.thumbnailSrc) && (
                          <div
                            style={{
                              position: 'absolute',
                              top: 0, left: 0, right: 0, bottom: 0,
                              backgroundImage: cssImageUrl(prototype.thumbnailSrc),
                              backgroundSize: 'cover',
                              backgroundPosition: 'center',
                              borderRadius: '16px', // Match container rounding
                              opacity: 0.3
                            }}
                          />
                        )}
                        <span
                          style={{
                            color: getTextColor(sanitizeColor(prototype.color, '#8B0000'), theme.darkMode),
                            fontWeight: 'bold',
                            fontFamily: "'EmOne', sans-serif",
                            textAlign: 'center',
                            fontSize: isMobilePortrait ? (isExtraSmall ? '11px' : '12px') : (isSmallScreen ? '13px' : '12px'),
                            lineHeight: '1.2',
                            wordWrap: 'break-word',
                            position: 'relative',
                            zIndex: 1,
                            textShadow: 'none',
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
                  </div>}
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
          direction="down-right"
          parentContainerRef={null}
        />
      )}
    </>
  );

  return createPortal(content, document.body);
};

export default UnifiedSelector;
