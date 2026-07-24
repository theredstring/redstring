import React, { useState, useEffect, useRef, useCallback } from 'react';
import { NODE_CORNER_RADIUS } from './constants'; // Import node corner radius
import './PieMenu.css'; // Animation styles
import useGraphStore from './store/graphStore.js';

const BUBBLE_SIZE = 120; // Diameter of the bubble
const BUBBLE_PADDING = 32; // Gap between node edge and bubble
const ICON_SIZE = 60; // Icon size
const NUM_FIXED_POSITIONS = 8;
const FIXED_ANGLE_STEP = (2 * Math.PI) / NUM_FIXED_POSITIONS; // PI/4 or 45 degrees
const START_ANGLE_OFFSET = -Math.PI / 2; // Start at the top position (North)

const POP_ANIMATION_DURATION = 200; // ms, matches CSS
const SHRINK_ANIMATION_DURATION = 100; // ms, matches CSS (FASTER)
const STAGGER_DELAY = 20; // ms, slightly reduced
const EXIT_ANIMATION_BUFFER = 50; // ms, extra buffer for animation to complete visually

const PieMenu = ({
  node,
  buttons,
  nodeDimensions,
  isVisible,
  onExitAnimationComplete,
  focusedNode,
  onHoverChange = () => {},
  onAutoClose = () => {},
  anchor = null, // { x, y } in SVG canvas coords — alternative to node+nodeDimensions
  anchorAngle = 0, // radians — rotates line mode to match edge slope
  nodeScale = 1.0, // global node scale — bubbles and icons scale proportionally
  pageCount = 1, // number of selectable pages; chevrons render only when > 1
  currentPage = 0, // active page index
  onPageChange = null, // (nextPageIndex) => void — invoked by the ◀ / ▶ chevrons
}) => {
  const pieMenuScale = useGraphStore(s => s.textSettings?.pieMenuScale ?? 1.0);

  // animationState can be: null (initial/hidden), 'popping', 'visible_steady', 'shrinking'
  const [animationState, setAnimationState] = useState(null);

  // Page-change transition: the buttons we actually render lag the incoming `buttons`
  // prop so the outgoing page can shrink out before the incoming page pops in.
  // pagePhase: 'steady' | 'out' | 'in'
  const PAGE_OUT_MS = 160;
  const PAGE_IN_MS = 320;
  const [displayedButtons, setDisplayedButtons] = useState(buttons);
  const [pagePhase, setPagePhase] = useState('steady');
  const prevPageRef = useRef(currentPage);
  const pageTimersRef = useRef([]);
  // Tracks which node the menu is on, so a page change that coincides with a node
  // change (e.g. Duplicate re-selecting the new copy) is treated as a fresh open
  // rather than an animated page flip.
  const prevNodeIdRef = useRef(node?.id ?? null);
  // Always points at the freshest buttons prop so a transition swap picks up the
  // latest page contents even if the parent re-syncs `buttons` mid-animation.
  const latestButtonsRef = useRef(buttons);
  latestButtonsRef.current = buttons;
  const transitioningRef = useRef(false);

  useEffect(() => {
    const clearTimers = () => { pageTimersRef.current.forEach(clearTimeout); pageTimersRef.current = []; };
    // While the menu is closing/hidden, freeze what's displayed: the shrink animation
    // must play on the exact page + button state that was showing. Don't react to the
    // parent resetting the page or flipping button state (e.g. Save) during the exit,
    // and cancel any in-flight page transition so it can't swap content mid-shrink.
    if (!isVisible) {
      clearTimers();
      transitioningRef.current = false;
      return;
    }
    // A different node → this is a fresh menu, not a page flip. Swap instantly
    // (no out/in animation) and re-baseline the page so no transition fires.
    const nodeId = node?.id ?? null;
    if (nodeId !== prevNodeIdRef.current) {
      prevNodeIdRef.current = nodeId;
      clearTimers();
      transitioningRef.current = false;
      prevPageRef.current = currentPage;
      setPagePhase('steady');
      setDisplayedButtons(buttons);
      return;
    }
    if (currentPage !== prevPageRef.current) {
      prevPageRef.current = currentPage;
      clearTimers();
      transitioningRef.current = true;
      // Shrink the currently displayed page out...
      setPagePhase('out');
      const t1 = setTimeout(() => {
        // ...then swap in the new page's buttons and pop them in.
        setDisplayedButtons(latestButtonsRef.current);
        setPagePhase('in');
        const t2 = setTimeout(() => {
          setPagePhase('steady');
          setDisplayedButtons(latestButtonsRef.current); // final sync to latest contents
          transitioningRef.current = false;
        }, PAGE_IN_MS);
        pageTimersRef.current.push(t2);
      }, PAGE_OUT_MS);
      pageTimersRef.current.push(t1);
    } else if (!transitioningRef.current) {
      // Same page and not mid-transition — keep displayed buttons in sync with
      // prop-level changes (e.g. Save/Unsave label + fill flips), no transition.
      setDisplayedButtons(buttons);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [buttons, currentPage, node?.id]);

  // Clean up any pending page-transition timers on unmount
  useEffect(() => () => { pageTimersRef.current.forEach(clearTimeout); }, []);

  const bubbleRefs = useRef([]);
  // Ensure bubbleRefs array matches the buttons actually rendered (displayedButtons,
  // which lags `buttons` during page transitions / freezes on close), so the
  // pop/shrink animation-end counting below lines up with what's on screen.
  useEffect(() => {
    bubbleRefs.current = Array(displayedButtons.length).fill().map((_, i) => bubbleRefs.current[i] || React.createRef());
  }, [displayedButtons.length]);

  const animationsEndedCountRef = useRef(0);
  const autoCloseTimerRef = useRef(null);

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
      } else if (animationState === null && displayedButtons && displayedButtons.length > 0 && node) {
        // Edge case: component was mounted with isVisible=false but had data (e.g. quick toggle by parent)
        // It might have briefly been set to 'popping' then immediately to 'shrinking'.
        // If it ends up here (isVisible=false, animationState=null, but has data), it implies it should be hidden.
        // This state should ideally be caught by the render null logic.
      }
    }
  }, [isVisible, animationState, displayedButtons, node]); // displayedButtons/node handle edge cases like initial hide with data

  const handleAnimationEnd = useCallback((event, buttonIndex) => {
    //console.log(`[PieMenu] handleAnimationEnd for button ${buttonIndex}. Animation: ${event.animationName}, current animationState: ${animationState}`);
    if (event.target === bubbleRefs.current[buttonIndex]?.current) {
      if (animationState === 'popping' && event.animationName === 'pie-bubble-pop') {
        animationsEndedCountRef.current += 1;
        if (animationsEndedCountRef.current >= displayedButtons.length) {
          //console.log("[PieMenu] All pop-in animations ended. Setting animationState to 'visible_steady'.");
          setAnimationState('visible_steady');
          animationsEndedCountRef.current = 0;
        }
      } else if (animationState === 'shrinking' && event.animationName === 'pie-bubble-shrink-out') {
        animationsEndedCountRef.current += 1;
        if (animationsEndedCountRef.current >= displayedButtons.length) {
          //console.log("[PieMenu] All shrink animations ended. Calling onExitAnimationComplete.");
          onExitAnimationComplete && onExitAnimationComplete();
          setAnimationState(null); // Reset state after exit is complete
          animationsEndedCountRef.current = 0;
        }
      }
    }
  }, [animationState, displayedButtons, onExitAnimationComplete]);

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

  // Auto-close timer: DISABLED - PieMenu should remain open until user explicitly closes it
  // useEffect(() => {
  //   // Clear any existing timer
  //   if (autoCloseTimerRef.current) {
  //     clearTimeout(autoCloseTimerRef.current);
  //     autoCloseTimerRef.current = null;
  //   }

  //   // Start a new timer when the menu becomes visible (visible_steady state)
  //   if (animationState === 'visible_steady' && isVisible) {
  //     console.log('[PieMenu] Starting 5-second auto-close timer');
  //     autoCloseTimerRef.current = setTimeout(() => {
  //       console.log('[PieMenu] Auto-close timer expired, triggering close');
  //       onAutoClose();
  //     }, 5000); // 5 seconds
  //   }

  //   // Cleanup function
  //   return () => {
  //     if (autoCloseTimerRef.current) {
  //       clearTimeout(autoCloseTimerRef.current);
  //       autoCloseTimerRef.current = null;
  //     }
  //   };
  // }, [animationState, isVisible, onAutoClose]);

  // Render null if essential data is missing
  const hasAnchorMode = anchor !== null;
  if (!buttons || !buttons.length || (!hasAnchorMode && (!node || !nodeDimensions))) {
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

  const scale = nodeScale * pieMenuScale;
  const bSize = BUBBLE_SIZE * scale;
  const bPad = BUBBLE_PADDING * scale;
  const iSize = ICON_SIZE * scale;
  const strokeWidth = Math.max(1, 6 * scale);

  let nodeCenterX, nodeCenterY, totalVisualOffset, cornerRadius, currentWidth, currentHeight;
  if (hasAnchorMode) {
    nodeCenterX = anchor.x;
    nodeCenterY = anchor.y;
    totalVisualOffset = bPad + bSize / 2;
    cornerRadius = NODE_CORNER_RADIUS;
    currentWidth = 0;
    currentHeight = 0;
  } else {
    const { x, y } = node;
    currentWidth = nodeDimensions.currentWidth;
    currentHeight = nodeDimensions.currentHeight;
    nodeCenterX = x + currentWidth / 2;
    nodeCenterY = y + currentHeight / 2;
    totalVisualOffset = bPad + bSize / 2;
    cornerRadius = NODE_CORNER_RADIUS;
  }

  let dynamicClassName = 'pie-menu-bubble-inner';
  if (animationState === 'popping') {
    dynamicClassName += ' is-popping';
  } else if (animationState === 'shrinking') {
    // Menu-close shrink takes priority over any in-flight page transition
    dynamicClassName += ' is-shrinking';
  } else if (pagePhase === 'out') {
    dynamicClassName += ' is-page-out';
  } else if (pagePhase === 'in') {
    dynamicClassName += ' is-page-in';
  } else if (animationState === 'visible_steady') {
    dynamicClassName += ' is-visible-steady';
  } else if (isVisible) {
    // Fallback if isVisible is true but animationState is somehow null (should become 'popping')
    // Or if it just became visible and 'popping' state is next render cycle
    dynamicClassName += ' is-popping'; // Attempt to pop
  }

  //console.log(`[PieMenu] Render: Rendering PieMenu. isVisible=${isVisible}, animationState=${animationState}`);
  
  // Check if this is a carousel mode (buttons have position property)
  const isCarouselMode = !hasAnchorMode && displayedButtons.some(button => button.position);
  const isLineMode = hasAnchorMode; // anchor mode = horizontal line of buttons

  // Page-switching chevrons: bare < / > arrows (stroked, no surrounding shape)
  // flanking the outer bounds of the circular menu. The hitbox is an invisible
  // rectangle around the arm bounds. Only shown for the default (circular) node
  // menu with >1 page.
  const showChevrons = pageCount > 1 && typeof onPageChange === 'function' && !isLineMode && !isCarouselMode;
  let chevronGeometry = null;
  if (showChevrons) {
    // Distance from the node center out to the outer edge of the East/West bubbles.
    const halfExtentX = currentWidth / 2 + totalVisualOffset + bSize / 2;
    const maxChevronHeight = bSize * 2.5;             // ceiling so tall image nodes don't over-stretch it
    const chevronHeight = Math.min(currentHeight, maxChevronHeight); // vertical span, capped
    // Depth & thickness keep growing past the height cap, up to their own larger ceiling.
    const girthHeight = Math.min(currentHeight, bSize * 6);
    const chevronDepth = 26 * scale + girthHeight * 0.1; // widens with height, but only gently
    const fillThickness = 14 * scale + girthHeight * 0.03; // band thickness, grows slightly with height
    const border = strokeWidth;                 // maroon outline weight (matches bubbles)
    const gap = bPad * 1.5;                      // space between menu edge and the arrow point
    chevronGeometry = {
      chevronHeight,
      chevronDepth,
      fillThickness,
      border,
      leftX: nodeCenterX - halfExtentX - gap - chevronDepth / 2,
      rightX: nodeCenterX + halfExtentX + gap + chevronDepth / 2,
      centerY: nodeCenterY,
    };
  }

  const renderChevron = (side) => {
    if (!chevronGeometry) return null;
    const { chevronHeight: h, chevronDepth: d, fillThickness, border, leftX, rightX, centerY } = chevronGeometry;
    const isLeft = side === 'left';
    const cx = isLeft ? leftX : rightX;
    const outerWidth = fillThickness + border * 2; // maroon band = fill + outline on both sides
    const halfOuter = outerWidth / 2;
    // Two arms meeting at a horizontal point: '<' points left, '>' points right.
    const points = isLeft
      ? `${d / 2},${-h / 2} ${-d / 2},0 ${d / 2},${h / 2}`
      : `${-d / 2},${-h / 2} ${d / 2},0 ${-d / 2},${h / 2}`;
    // Both chevrons are always present and loop around: left wraps to the last page,
    // right wraps to the first.
    const available = true;
    const nextPage = isLeft
      ? (currentPage - 1 + pageCount) % pageCount
      : (currentPage + 1) % pageCount;
    const activate = (e) => {
      e.stopPropagation();
      if (e.cancelable) e.preventDefault();
      if (!available || animationState === 'shrinking' || !isVisible) return;
      onPageChange(nextPage);
    };

    // Intro/outro is driven by the shared pie-menu animation state; the delayed
    // pop-in is handled in CSS (animation-delay on .pie-chevron-intro.is-popping).
    let introClass = 'is-steady';
    if (animationState === 'popping') introClass = 'is-popping';
    else if (animationState === 'shrinking') introClass = 'is-shrinking';

    return (
      <g
        key={`pie-chevron-${side}`}
        transform={`translate(${cx}, ${centerY})`}
        style={{
          cursor: 'pointer',
          WebkitTapHighlightColor: 'transparent',
          touchAction: 'manipulation',
        }}
        onMouseDown={(e) => { e.stopPropagation(); e.preventDefault(); }}
        onTouchStart={(e) => { e.stopPropagation(); if (e.cancelable) e.preventDefault(); }}
        onTouchEnd={activate}
        onClick={activate}
      >
        {/* Availability wrapper: fades/scales the chevron out (and stops it eating
            taps) when there's no page in its direction, so it animates on page change.
            Timings mirror the bubble page transition — an appearing chevron waits out
            the out-phase then grows in over PAGE_IN_MS; a disappearing one leaves over
            PAGE_OUT_MS — so it stays in lockstep with the incoming/outgoing page. */}
        <g
          style={{
            opacity: available ? 1 : 0,
            transform: available ? 'scale(1)' : 'scale(0.6)',
            transition: available
              ? `opacity ${PAGE_IN_MS}ms ease ${PAGE_OUT_MS}ms, transform ${PAGE_IN_MS}ms cubic-bezier(0.34, 1.56, 0.64, 1) ${PAGE_OUT_MS}ms`
              : `opacity ${PAGE_OUT_MS}ms ease, transform ${PAGE_OUT_MS}ms cubic-bezier(0.6, -0.28, 0.735, 0.045)`,
            pointerEvents: available ? 'auto' : 'none',
          }}
        >
        {/* Delayed intro / outro wrapper */}
        <g className={`pie-chevron-intro ${introClass}`}>
          {/* Hover-grow wrapper (nested so it doesn't fight the intro transform) */}
          <g className="pie-chevron-hover">
            {/* Invisible rectangular hitbox around the (thick) arm bounds */}
            <rect
              x={-(d / 2 + halfOuter)}
              y={-(h / 2 + halfOuter)}
              width={d + halfOuter * 2}
              height={h + halfOuter * 2}
              fill="transparent"
            />
            {/* Maroon outer band (drawn wider, underneath) forms the outline */}
            <polyline
              points={points}
              fill="none"
              stroke="maroon"
              strokeWidth={outerWidth}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            {/* #DEDADA interior (bubble fill) sits on top, leaving the maroon as an outline */}
            <polyline
              points={points}
              fill="none"
              stroke="#DEDADA"
              strokeWidth={fillThickness}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </g>
        </g>
        </g>
      </g>
    );
  };

  return (
    <g className="pie-menu">
      {showChevrons && renderChevron('left')}
      {showChevrons && renderChevron('right')}
      {displayedButtons.map((button, index) => {
        let bubbleX, bubbleY;

        if (isLineMode) {
          // Line mode: buttons along the edge slope, offset perpendicular (upward side)
          const step = bSize + bPad;
          const n = displayedButtons.length;
          const t = index - (n - 1) / 2; // centered index: -1.5, -0.5, 0.5, 1.5 for n=4

          // Along-edge unit vector
          const alongX = Math.cos(anchorAngle);
          const alongY = Math.sin(anchorAngle);

          // Perpendicular unit vector pointing upward (angle is always in [-π/2, π/2] so this is guaranteed)
          const perpX = Math.sin(anchorAngle);
          const perpY = -Math.cos(anchorAngle);

          const PERP_OFFSET = bSize + bPad * 2; // perpendicular offset from edge

          bubbleX = nodeCenterX + t * step * alongX + PERP_OFFSET * perpX;
          bubbleY = nodeCenterY + t * step * alongY + PERP_OFFSET * perpY;
        } else if (isCarouselMode) {
          // Carousel mode: position buttons based on actual current node dimensions
          // nodeDimensions now contains the actual current scaled dimensions from AbstractionCarousel
          const currentNodeHalfWidth = nodeDimensions.currentWidth / 2;
          const padding = bPad + bSize / 2;
          const outerOffset = bSize + bPad; // Additional offset for outer buttons

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
            bubbleY = nodeCenterY - (bSize + bPad);
          } else if (button.position === 'right-bottom') {
            // Vertical stack on right side - bottom button
            bubbleX = nodeCenterX + currentNodeHalfWidth + padding;
            bubbleY = nodeCenterY + (bSize + bPad);
          } else if (button.position === 'top') {
            // Decomposition layout: a horizontal row of buttons across the node's top
            // edge, right-aligned so the rightmost (compose) sits at the top-right corner.
            // topIndex 0 = leftmost, topCount-1 = rightmost.
            const step = bSize + bPad;
            const nodeRight = nodeCenterX + currentNodeHalfWidth;
            const nodeTop = nodeCenterY - nodeDimensions.currentHeight / 2;
            const fromRight = (button.topCount - 1) - button.topIndex;
            bubbleX = nodeRight - (bSize / 2) - fromRight * step;
            bubbleY = nodeTop - padding;
          } else {
            // Fallback to center if no position specified
            bubbleX = nodeCenterX;
            bubbleY = nodeCenterY;
          }
        } else {
          // Original circular positioning logic
          // Determine the effective index for positioning.
          // If there's only one button, it should always take the "top-right" slot (index 1).
          const effectiveIndex = displayedButtons.length === 1 ? 1 : index;

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
        if (pagePhase === 'out' || pagePhase === 'in') {
          // Page transitions run without stagger so the swap timing stays deterministic
          animationDelayMs = 0;
        } else if (displayedButtons.length === 1) {
          animationDelayMs = 0; // No delay if only one button
        } else if (animationState === 'shrinking') {
          // Reverse stagger for shrinking: last button (index N-1) gets 0 delay, first (index 0) gets (N-1)*delay
          animationDelayMs = (displayedButtons.length - 1 - index) * STAGGER_DELAY;
        } else { // For popping or steady
          animationDelayMs = index * STAGGER_DELAY;
        }

        return (
          <g
            key={button.id || index}
            transform={`translate(${bubbleX}, ${bubbleY})`}
            style={{ 
              cursor: 'pointer',
              WebkitTapHighlightColor: 'transparent',
              touchAction: 'manipulation'
            }}
            onTouchStart={(e) => { e.stopPropagation(); if (e.cancelable) e.preventDefault(); }}
            onMouseDown={(e) => { e.stopPropagation(); e.preventDefault(); }}
            onMouseEnter={() => onHoverChange({ id: button.id, label: button.label })}
            onMouseLeave={() => onHoverChange(null)}
            onTouchEnd={(e) => {
              e.stopPropagation();
              if (e.cancelable) e.preventDefault();

              if (button.hidden) return; // collapsed/animating-out button is not interactive

              const isCarouselStageTransition = button.id === 'carousel-plus' || button.id === 'carousel-back' || button.id === 'carousel-back-stage2' || button.id === 'carousel-add-above' || button.id === 'carousel-add-below';

              if (animationState === 'shrinking' && !isCarouselStageTransition) return;
              if (!isVisible && !isCarouselStageTransition) return;
              if (button.id === 'compose-preview' && animationState === 'shrinking') return;

              const touch = e.changedTouches && e.changedTouches[0];
              const buttonPosition = touch ? { x: touch.clientX, y: touch.clientY } : null;

              button.action(node?.id ?? null, buttonPosition);
            }}
            onClick={(e) => {
              if (button.hidden) { e.stopPropagation(); return; } // collapsed/animating-out button is not interactive
              // Allow carousel stage transition buttons to work even during shrinking
              const isCarouselStageTransition = button.id === 'carousel-plus' || button.id === 'carousel-back' || button.id === 'carousel-back-stage2' || button.id === 'carousel-add-above' || button.id === 'carousel-add-below';

              // Prevent clicks during shrinking animation unless it's a carousel transition button
              if (animationState === 'shrinking' && !isCarouselStageTransition) {
                e.stopPropagation();
                return;
              }

              // Always stop propagation to prevent canvas clicks
              e.stopPropagation();

              // Calculate button's screen position for actions that need it (like color picker)
              const svgElement = e.currentTarget.ownerSVGElement;
              const buttonPosition = svgElement ? {
                x: e.clientX,
                y: e.clientY
              } : null;

              // Prevent action if menu is supposed to be hidden but animation not complete
              if (!isVisible && !isCarouselStageTransition) {
                return;
              }

              // Additional safety check: prevent compose-preview during carousel transitions
              if (button.id === 'compose-preview' && animationState === 'shrinking') {
                console.log('[PieMenu] Blocking compose-preview during carousel shrink');
                return;
              }

              // Execute the button action - pass buttonPosition as second parameter for actions that need it
              button.action(node?.id ?? null, buttonPosition);
            }}
          >
            {/* Visibility wrapper: animates per-button appear/disappear (e.g. the ◀/▶
                definition-nav arrows toggling as you reach the first/last definition)
                by scaling/fading rather than mounting/unmounting. Scales about the bubble
                center (0,0), so it collapses to a point. */}
            <g
              style={{
                transform: button.hidden ? 'scale(0)' : 'scale(1)',
                opacity: button.hidden ? 0 : 1,
                transition: 'transform 0.2s ease, opacity 0.2s ease',
                pointerEvents: button.hidden ? 'none' : 'auto',
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
                {/* Hover-grow wrapper: nested so its scale transition does not fight the
                    pop/shrink transform on the parent. */}
                <g className="pie-bubble-hover">
                  <circle
                    cx="0"
                    cy="0"
                    r={bSize / 2}
                    fill="#DEDADA"
                    stroke="maroon"
                    strokeWidth={strokeWidth}
                  />
                  {IconComponent && (
                    <IconComponent
                      x={-iSize / 2}
                      y={-iSize / 2}
                      width={iSize}
                      height={iSize}
                      color="maroon"
                      fill={button.fill || 'none'}
                    />
                  )}
                </g>
              </g>
            </g>
          </g>
        );
      })}
    </g>
  );
};

export default PieMenu; 
