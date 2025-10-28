import { useState, useEffect } from 'react';

/**
 * Hook for detecting mobile viewport and orientation
 * Returns mobile state and orientation info
 */
export const useMobileDetection = () => {
  const [mobileState, setMobileState] = useState(() => {
    const width = window.innerWidth;
    const height = window.innerHeight;
    const isMobileWidth = width <= 768;
    const isTabletWidth = width > 768 && width <= 1024;
    const isPortrait = height > width;
    const isLandscape = width > height;
    const isTouchDevice = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
    
    return {
      width,
      height,
      isMobile: isMobileWidth,
      isTablet: isTabletWidth,
      isPortrait,
      isLandscape,
      isMobilePortrait: isMobileWidth && isPortrait,
      isMobileLandscape: isMobileWidth && isLandscape,
      isTabletPortrait: isTabletWidth && isPortrait,
      isTabletLandscape: isTabletWidth && isLandscape,
      isTouchDevice,
      isSmallScreen: isMobileWidth || isTabletWidth,
      aspectRatio: width / height
    };
  });

  useEffect(() => {
    const handleResize = () => {
      const width = window.innerWidth;
      const height = window.innerHeight;
      const isMobileWidth = width <= 768;
      const isTabletWidth = width > 768 && width <= 1024;
      const isPortrait = height > width;
      const isLandscape = width > height;
      const isTouchDevice = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
      
      setMobileState({
        width,
        height,
        isMobile: isMobileWidth,
        isTablet: isTabletWidth,
        isPortrait,
        isLandscape,
        isMobilePortrait: isMobileWidth && isPortrait,
        isMobileLandscape: isMobileWidth && isLandscape,
        isTabletPortrait: isTabletWidth && isPortrait,
        isTabletLandscape: isTabletWidth && isLandscape,
        isTouchDevice,
        isSmallScreen: isMobileWidth || isTabletWidth,
        aspectRatio: width / height
      });
    };

    window.addEventListener('resize', handleResize);
    window.addEventListener('orientationchange', handleResize);
    
    return () => {
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('orientationchange', handleResize);
    };
  }, []);

  return mobileState;
};

export default useMobileDetection;

