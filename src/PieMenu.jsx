import React, { useState, useEffect, useRef, useCallback } from 'react';
import { NODE_CORNER_RADIUS } from './constants'; // Import node corner radius
import './PieMenu.css'; // Animation styles

const BUBBLE_SIZE = 60; // Diameter of the bubble (1.5x original 40)
const BUBBLE_PADDING = 16; // Slightly further from node than original 10
const ICON_SIZE = 30; // Icon size (1.5x original 20)
const NUM_FIXED_POSITIONS = 8;
const FIXED_ANGLE_STEP = (2 * Math.PI) / NUM_FIXED_POSITIONS; // PI/4 or 45 degrees
const START_ANGLE_OFFSET = -Math.PI / 2; // Start at the top position (North)

const POP_ANIMATION_DURATION = 400; // ms, matches CSS
const SHRINK_ANIMATION_DURATION = 150; // ms, matches CSS (FASTER)
const STAGGER_DELAY = 40; // ms, slightly reduced
const EXIT_ANIMATION_BUFFER = 50; // ms, extra buffer for animation to complete visually

const PieMenu = ({
  node,
  buttons,
  nodeDimensions,
  isVisible,
  onExitAnimationComplete,
  focusedNode,
  onHoverChange = () => {}
}) => {
  // animationState can be: null (initial/hidden), 'popping', 'visible_steady', 'shrinking'
  const [animationState, setAnimationState] = useState(null);

  const bubbleRefs = useRef([]);
  // Ensure bubbleRefs array is the same length as buttons
  // This needs to be robust against buttons array changing length
  useEffect(() => {
    bubbleRefs.current = Array(buttons.length).fill().map((_, i) => bubbleRefs.current[i] || React.createRef());
  }, [buttons.length]);

  const animationsEndedCountRef = useRef(0);

  // Primary effect to react to visibility changes from parent
  useEffect(() => {
    ////console.log(`[PieMenu] useEffect[isVisible]: prop is ${isVisible}. Current animationState: ${animationState}`);
    if (isVisible) {
      // If not already popping or steady, start popping
      if (animationState !== 'popping' && animationState !== 'visible_steady') {
        ////console.log("[PieMenu] Setting animationState to 'popping'");
        setAnimationState('popping');
        animationsEndedCountRef.current = 0; // Reset for pop-in (though not strictly needed for pop yet)
      }
    } else { // isVisible is false
      // If it was popping or is steady, start shrinking
      if (animationState === 'popping' || animationState === 'visible_steady') {
        ////console.log("[PieMenu] Setting animationState to 'shrinking'");
        setAnimationState('shrinking');
        animationsEndedCountRef.current = 0; // Reset for shrink-out listeners
      } else if (animationState === null && buttons && buttons.length > 0 && node) {
        // Edge case: component was mounted with isVisible=false but had data (e.g. quick toggle by parent)
        // It might have briefly been set to 'popping' then immediately to 'shrinking'.
        // If it ends up here (isVisible=false, animationState=null, but has data), it implies it should be hidden.
        // This state should ideally be caught by the render null logic.
      }
    }
  }, [isVisible, animationState, buttons, node]); // Added buttons/node to handle edge cases like initial hide with data

  const handleAnimationEnd = useCallback((event, buttonIndex) => {
    //console.log(`[PieMenu] handleAnimationEnd for button ${buttonIndex}. Animation: ${event.animationName}, current animationState: ${animationState}`);
    if (event.target === bubbleRefs.current[buttonIndex]?.current) {
      if (animationState === 'popping' && event.animationName === 'pie-bubble-pop') {
        animationsEndedCountRef.current += 1;
        if (animationsEndedCountRef.current >= buttons.length) {
          //console.log("[PieMenu] All pop-in animations ended. Setting animationState to 'visible_steady'.");
          setAnimationState('visible_steady');
          animationsEndedCountRef.current = 0;
        }
      } else if (animationState === 'shrinking' && event.animationName === 'pie-bubble-shrink-out') {
        animationsEndedCountRef.current += 1;
        if (animationsEndedCountRef.current >= buttons.length) {
          //console.log("[PieMenu] All shrink animations ended. Calling onExitAnimationComplete.");
          onExitAnimationComplete && onExitAnimationComplete();
          setAnimationState(null); // Reset state after exit is complete
          animationsEndedCountRef.current = 0;
        }
      }
    }
  }, [animationState, buttons, onExitAnimationComplete]);

  // Effect to add/remove event listeners for exit animation
  useEffect(() => {
    //console.log(`[PieMenu] useEffect[animationState for listeners]: current state is ${animationState}.`);
    // Add listeners for both pop and shrink, as we need to count them to transition state
    if (animationState === 'popping' || animationState === 'shrinking') {
      //console.log(`[PieMenu] Adding animationend listeners for state: ${animationState}`);
      bubbleRefs.current.forEach((ref, index) => {
        const currentRef = ref.current;
        if (currentRef) {
          const listener = (event) => handleAnimationEnd(event, index);
          currentRef.addEventListener('animationend', listener);
          // Store listener for cleanup
          currentRef._animationEndListener = listener; 
        }
      });
    }

    return () => {
      //console.log("[PieMenu] Cleanup: Removing animationend listeners.");
      bubbleRefs.current.forEach(ref => {
        const currentRef = ref.current;
        if (currentRef && currentRef._animationEndListener) {
          currentRef.removeEventListener('animationend', currentRef._animationEndListener);
          delete currentRef._animationEndListener; // Clean up stored listener
        }
      });
    };
  }, [animationState, handleAnimationEnd]);

  // Render null if essential data is missing
  if (!node || !buttons || !buttons.length || !nodeDimensions) {
    ////console.log("[PieMenu] Render: Rendering NULL due to missing essential data.");
    // If we were previously visible and now hiding due to missing data,
    // ensure exit animation callback is called if it hasn't been.
    // This can happen if the node providing data is suddenly removed.
    if (animationState !== null && animationState !== 'shrinking' && onExitAnimationComplete) {
      ////console.log("[PieMenu] Missing data, but was visible. Triggering onExitAnimationComplete.");
      onExitAnimationComplete(); // Ensure parent knows we are gone.
      setAnimationState(null); // Reset internal state.
    }
    return null;
  }

  // If animationState is null (meaning it's fully reset/hidden internally)
  // AND the parent also says it's not visible (prop), then it should definitely be null.
  // This primarily handles the initial mount if isVisible starts as false, or after a full exit sequence.
  if (animationState === null && !isVisible) {
    ////console.log(`[PieMenu] Render: Rendering NULL because animationState is null and isVisible is false.`);
    return null;
  }
  // If animationState is NOT null, it means we are either popping, steady, or shrinking.
  // In these cases, we must render the component to allow animations.
  // The case where isVisible is false AND animationState is shrinking is handled by NodeCanvas unmounting later.
  if (animationState === null && isVisible) {
    // This is an inconsistent state, implies isVisible became true but animationState hasn't caught up to 'popping'.
    // It should resolve in the next render due to useEffect. For now, render null to avoid issues.
    //console.log("[PieMenu] Render: Rendering NULL due to inconsistent state (animationState null, isVisible true). Waiting for effect.");
    return null;
  }

  const { x, y } = node;
  const { currentWidth, currentHeight } = nodeDimensions;

  const nodeCenterX = x + currentWidth / 2;
  const nodeCenterY = y + currentHeight / 2;

  const totalVisualOffset = BUBBLE_PADDING + BUBBLE_SIZE / 2;
  const cornerRadius = NODE_CORNER_RADIUS;

  let dynamicClassName = 'pie-menu-bubble-inner';
  if (animationState === 'popping') {
    dynamicClassName += ' is-popping';
  } else if (animationState === 'visible_steady') {
    dynamicClassName += ' is-visible-steady';
  } else if (animationState === 'shrinking') {
    dynamicClassName += ' is-shrinking';
  } else if (isVisible) {
    // Fallback if isVisible is true but animationState is somehow null (should become 'popping')
    // Or if it just became visible and 'popping' state is next render cycle
    dynamicClassName += ' is-popping'; // Attempt to pop
  }

  //console.log(`[PieMenu] Render: Rendering PieMenu. isVisible=${isVisible}, animationState=${animationState}`);
  
  // Check if this is a carousel mode (buttons have position property)
  const isCarouselMode = buttons.some(button => button.position);
  
  return (
    <g className="pie-menu">
      {buttons.map((button, index) => {
        let bubbleX, bubbleY;
        
        if (isCarouselMode) {
          // Carousel mode: position buttons based on actual current node dimensions
          // nodeDimensions now contains the actual current scaled dimensions from AbstractionCarousel
          const currentNodeHalfWidth = nodeDimensions.currentWidth / 2;
          const padding = BUBBLE_PADDING + BUBBLE_SIZE / 2;
          const outerOffset = BUBBLE_SIZE + BUBBLE_PADDING; // Additional offset for outer buttons
          
          if (button.position === 'left-outer') {
            bubbleX = nodeCenterX - currentNodeHalfWidth - padding - outerOffset;
            bubbleY = nodeCenterY;
          } else if (button.position === 'left' || button.position === 'left-inner') {
            bubbleX = nodeCenterX - currentNodeHalfWidth - padding;
            bubbleY = nodeCenterY;
          } else if (button.position === 'right' || button.position === 'right-inner') {
            bubbleX = nodeCenterX + currentNodeHalfWidth + padding;
            bubbleY = nodeCenterY;
          } else if (button.position === 'right-second') {
            bubbleX = nodeCenterX + currentNodeHalfWidth + padding + outerOffset * 0.67;
            bubbleY = nodeCenterY;
          } else if (button.position === 'right-third') {
            bubbleX = nodeCenterX + currentNodeHalfWidth + padding + outerOffset * 1.33;
            bubbleY = nodeCenterY;
          } else if (button.position === 'right-middle') {
            bubbleX = nodeCenterX + currentNodeHalfWidth + padding + outerOffset;
            bubbleY = nodeCenterY;
          } else if (button.position === 'right-outer') {
            bubbleX = nodeCenterX + currentNodeHalfWidth + padding + outerOffset * 2;
            bubbleY = nodeCenterY;
          } else if (button.position === 'right-top') {
            // Vertical stack on right side - top button
            bubbleX = nodeCenterX + currentNodeHalfWidth + padding;
            bubbleY = nodeCenterY - (BUBBLE_SIZE + BUBBLE_PADDING);
          } else if (button.position === 'right-bottom') {
            // Vertical stack on right side - bottom button
            bubbleX = nodeCenterX + currentNodeHalfWidth + padding;
            bubbleY = nodeCenterY + (BUBBLE_SIZE + BUBBLE_PADDING);
          } else {
            // Fallback to center if no position specified
            bubbleX = nodeCenterX;
            bubbleY = nodeCenterY;
          }
        } else {
          // Original circular positioning logic
          // Determine the effective index for positioning.
          // If there's only one button, it should always take the "top-right" slot (index 1).
          const effectiveIndex = buttons.length === 1 ? 1 : index;

          if (effectiveIndex >= NUM_FIXED_POSITIONS) return null; // Use effectiveIndex for check

          const angle = START_ANGLE_OFFSET + effectiveIndex * FIXED_ANGLE_STEP; // Use effectiveIndex for angle

          // Determine position based on effectiveIndex
          switch (effectiveIndex) { // Use effectiveIndex for positioning
          case 0: // Top (North)
            bubbleX = nodeCenterX;
            bubbleY = nodeCenterY - (currentHeight / 2 + totalVisualOffset);
            break;
          case 1: // Top-Right (North-East)
            bubbleX = nodeCenterX + (currentWidth / 2 - cornerRadius) + (cornerRadius + totalVisualOffset) * Math.cos(angle);
            bubbleY = nodeCenterY - (currentHeight / 2 - cornerRadius) + (cornerRadius + totalVisualOffset) * Math.sin(angle);
            break;
          case 2: // Right (East)
            bubbleX = nodeCenterX + (currentWidth / 2 + totalVisualOffset);
            bubbleY = nodeCenterY;
            break;
          case 3: // Bottom-Right (South-East)
            bubbleX = nodeCenterX + (currentWidth / 2 - cornerRadius) + (cornerRadius + totalVisualOffset) * Math.cos(angle);
            bubbleY = nodeCenterY + (currentHeight / 2 - cornerRadius) + (cornerRadius + totalVisualOffset) * Math.sin(angle);
            break;
          case 4: // Bottom (South)
            bubbleX = nodeCenterX;
            bubbleY = nodeCenterY + (currentHeight / 2 + totalVisualOffset);
            break;
          case 5: // Bottom-Left (South-West)
            bubbleX = nodeCenterX - (currentWidth / 2 - cornerRadius) + (cornerRadius + totalVisualOffset) * Math.cos(angle);
            bubbleY = nodeCenterY + (currentHeight / 2 - cornerRadius) + (cornerRadius + totalVisualOffset) * Math.sin(angle);
            break;
          case 6: // Left (West)
            bubbleX = nodeCenterX - (currentWidth / 2 + totalVisualOffset);
            bubbleY = nodeCenterY;
            break;
          case 7: // Top-Left (North-West)
            bubbleX = nodeCenterX - (currentWidth / 2 - cornerRadius) + (cornerRadius + totalVisualOffset) * Math.cos(angle);
            bubbleY = nodeCenterY - (currentHeight / 2 - cornerRadius) + (cornerRadius + totalVisualOffset) * Math.sin(angle);
            break;
          default:
            // Fallback, though should not happen with NUM_FIXED_POSITIONS
            bubbleX = nodeCenterX + (currentWidth / 2 + totalVisualOffset) * Math.cos(angle);
            bubbleY = nodeCenterY + (currentHeight / 2 + totalVisualOffset) * Math.sin(angle);
          }
        }

        const IconComponent = button.icon;

        // Distance from bubble final position back to node center (for animation start)
        const startDX = nodeCenterX - bubbleX;
        const startDY = nodeCenterY - bubbleY;

        let animationDelayMs;
        if (buttons.length === 1) {
          animationDelayMs = 0; // No delay if only one button
        } else if (animationState === 'shrinking') {
          // Reverse stagger for shrinking: last button (index N-1) gets 0 delay, first (index 0) gets (N-1)*delay
          animationDelayMs = (buttons.length - 1 - index) * STAGGER_DELAY;
        } else { // For popping or steady
          animationDelayMs = index * STAGGER_DELAY;
        }

        return (
          <g
            key={button.id || index}
            transform={`translate(${bubbleX}, ${bubbleY})`}
            style={{ cursor: 'pointer' }}
            onTouchStart={(e) => { e.stopPropagation(); if (e.cancelable) e.preventDefault(); }}
            onMouseDown={(e) => { e.stopPropagation(); e.preventDefault(); }}
            onMouseEnter={() => onHoverChange({ id: button.id, label: button.label })}
            onMouseLeave={() => onHoverChange(null)}
            onClick={(e) => {
              // Allow carousel stage transition buttons to work even during shrinking
              const isCarouselStageTransition = button.id === 'carousel-plus' || button.id === 'carousel-back' || button.id === 'carousel-back-stage2' || button.id === 'carousel-add-above' || button.id === 'carousel-add-below';
              
              // Prevent clicks during shrinking animation unless it's a carousel transition button
              if (animationState === 'shrinking' && !isCarouselStageTransition) {
                e.stopPropagation();
                return; 
              }
              
              // Always stop propagation to prevent canvas clicks
              e.stopPropagation();
              
              // Prevent action if menu is supposed to be hidden but animation not complete
              if (!isVisible && !isCarouselStageTransition) {
                return; 
              }
              
              // Additional safety check: prevent compose-preview during carousel transitions
              if (button.id === 'compose-preview' && animationState === 'shrinking') {
                console.log('[PieMenu] Blocking compose-preview during carousel shrink');
                return;
              }
              
              // Execute the button action
              button.action(node.id);
            }}
          >
            {/* Inner wrapper so CSS transform does not conflict with outer absolute positioning */}
            <g
              className={dynamicClassName}
              style={{
                // Custom properties used by CSS keyframes to calculate initial offset
                '--start-x': `${startDX}px`,
                '--start-y': `${startDY}px`,
                animationDelay: `${animationDelayMs}ms`,
              }}
              ref={bubbleRefs.current[index]} // Assign ref to the inner g
            >
              <circle
                cx="0"
                cy="0"
                r={BUBBLE_SIZE / 2}
                fill="#DEDADA"
                stroke="maroon"
                strokeWidth={3}
              />
              {IconComponent && (
                <IconComponent
                  x={-ICON_SIZE / 2}
                  y={-ICON_SIZE / 2}
                  width={ICON_SIZE}
                  height={ICON_SIZE}
                  color="maroon"
                  fill={button.fill || 'none'}
                />
              )}
            </g>
          </g>
        );
      })}
    </g>
  );
};

export default PieMenu; 
