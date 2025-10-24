/**
 * Device Detection Utility for Redstring
 * Automatically detects mobile/tablet devices and configures optimal settings
 * for Git-Only workflows and cross-platform compatibility
 */

import { debugConfig, isLocalStorageDisabled, isGitOnlyForced } from './debugConfig.js';

/**
 * Comprehensive device detection that identifies mobile/tablet browsers
 * Handles edge cases like iPad Safari reporting as desktop and Android tablets
 */
export const getDeviceInfo = () => {
  ensureInitialized();
  const userAgent = navigator.userAgent;
  const userAgentLower = userAgent.toLowerCase();
  
  // Screen-based detection for modern devices
  const screenWidth = window.screen.width;
  const screenHeight = window.screen.height;
  const maxDimension = Math.max(screenWidth, screenHeight);
  const minDimension = Math.min(screenWidth, screenHeight);
  
  // Touch capability detection
  const hasTouchScreen = 'ontouchstart' in window || 
                        (navigator.maxTouchPoints !== undefined && navigator.maxTouchPoints > 0) ||
                        (navigator.msMaxTouchPoints !== undefined && navigator.msMaxTouchPoints > 0);
  
  // User agent patterns
  const isMobileUA = /android|webos|iphone|ipod|blackberry|iemobile|opera mini/i.test(userAgentLower);
  const isTabletUA = /ipad|android(?!.*mobile)|kindle|silk|playbook|bb10/i.test(userAgentLower);
  
  // iPadOS Safari detection (reports as desktop but has touch)
  const isIPadOS = /macintosh/i.test(userAgentLower) && hasTouchScreen && maxDimension >= 1024;
  
  // Screen-based mobile detection (fallback for devices that report desktop UA)
  const isSmallScreen = maxDimension <= 768;
  const isMediumScreen = maxDimension <= 1024 && minDimension <= 768;
  
  // Determine device type with priority order
  let deviceType = 'desktop';
  
  if (isMobileUA || (hasTouchScreen && isSmallScreen)) {
    deviceType = 'mobile';
  } else if (isTabletUA || isIPadOS || (hasTouchScreen && isMediumScreen)) {
    deviceType = 'tablet';
  } else if (hasTouchScreen && !isMobileUA && !isTabletUA) {
    // Touch-enabled desktop (like Windows tablets or touchscreen laptops)
    deviceType = 'touch-desktop';
  }
  
  return {
    type: deviceType,
    isMobile: deviceType === 'mobile',
    isTablet: deviceType === 'tablet',
    isTouchDesktop: deviceType === 'touch-desktop',
    isDesktop: deviceType === 'desktop',
    isTouchDevice: hasTouchScreen,
    screenWidth,
    screenHeight,
    userAgent,
    
    // Convenience properties
    requiresGitOnly: deviceType === 'mobile' || deviceType === 'tablet',
    supportsFileSystemAPI: 'showSaveFilePicker' in window && 'showOpenFilePicker' in window,
    recommendedMode: (deviceType === 'mobile' || deviceType === 'tablet') ? 'git-only' : 'hybrid'
  };
};

let __loggedLocalStorageDisabledOnce = false;

/**
 * Check if device should use Git-Only mode
 * Considers both device capabilities and File System API availability
 */
export const shouldUseGitOnlyMode = () => {
  ensureInitialized();
  
  // Check debug override first
  if (isGitOnlyForced()) {
    console.log('[DeviceDetection] Git-Only mode FORCED by debug setting');
    return true;
  }
  
  // Check if local storage is disabled for debugging
  if (isLocalStorageDisabled()) {
    if (!__loggedLocalStorageDisabledOnce) {
      __loggedLocalStorageDisabledOnce = true;
      console.log('[DeviceDetection] Git-Only mode enabled due to local storage disabled for debugging');
    }
    return true;
  }
  
  const deviceInfo = getDeviceInfo();
  
  // Force Git-Only mode if:
  // 1. Mobile or tablet device, OR
  // 2. File System Access API not supported, OR  
  // 3. Touch device with small/medium screen
  return deviceInfo.requiresGitOnly || 
         !deviceInfo.supportsFileSystemAPI ||
         (deviceInfo.isTouchDevice && deviceInfo.screenWidth <= 1024);
};

/**
 * Get optimal configuration settings based on device
 */
export const getOptimalDeviceConfig = () => {
  ensureInitialized();
  const deviceInfo = getDeviceInfo();
  const gitOnlyMode = shouldUseGitOnlyMode();
  const localStorageDisabled = isLocalStorageDisabled();
  
  return {
    // Core mode settings
    gitOnlyMode,
    sourceOfTruth: gitOnlyMode ? 'git' : 'local',
    
    // Storage preferences (respect debug settings)
    preferBrowserStorage: !deviceInfo.supportsFileSystemAPI || localStorageDisabled,
    enableLocalFileStorage: deviceInfo.supportsFileSystemAPI && !gitOnlyMode && !localStorageDisabled,
    
    // UI optimizations
    touchOptimizedUI: deviceInfo.isTouchDevice,
    showMobileAuthFlow: deviceInfo.isMobile || deviceInfo.isTablet,
    compactInterface: deviceInfo.isMobile,
    
    // Feature flags
    enableQRCodeSharing: deviceInfo.isMobile || deviceInfo.isTablet,
    showCrossDeviceContinuity: true,
    prioritizeGitFeatures: shouldUseGitOnlyMode(),
    
    // Technical settings
    autoSaveFrequency: deviceInfo.isMobile ? 2000 : 1000, // Slower on mobile to save battery
    syncBatchSize: deviceInfo.isMobile ? 5 : 10, // Smaller batches on mobile
    enableServiceWorker: deviceInfo.isMobile || deviceInfo.isTablet,
    
    // Debug information
    debugInfo: {
      localStorageDisabled,
      gitOnlyForced: isGitOnlyForced(),
      debugMode: debugConfig.isDebugMode()
    },
    
    deviceInfo
  };
};

/**
 * Show user-friendly device capability explanation
 */
export const getDeviceCapabilityMessage = () => {
  ensureInitialized();
  const deviceInfo = getDeviceInfo();
  const config = getOptimalDeviceConfig();
  
  // Check for debug mode overrides
  if (config.debugInfo.localStorageDisabled) {
    return {
      type: 'warning',
      title: '🐛 Debug Mode: Local Storage Disabled',
      message: 'Local storage has been disabled for debugging purposes. All data will be lost on browser reload unless saved to Git.',
      icon: '⚠️'
    };
  }
  
  if (config.debugInfo.gitOnlyForced) {
    return {
      type: 'warning', 
      title: '🐛 Debug Mode: Git-Only Forced',
      message: 'Git-Only mode has been forced via debug settings, overriding device detection.',
      icon: '🔧'
    };
  }
  
  if (config.gitOnlyMode) {
    if (deviceInfo.isMobile) {
      return {
        type: 'info',
        title: 'Mobile-Optimized Experience',
        message: 'Redstring is running in Git-Only mode for the best mobile experience. Your universes will sync directly with Git repositories.',
        icon: '📱'
      };
    } else if (deviceInfo.isTablet) {
      return {
        type: 'info',
        title: 'Tablet-Optimized Experience', 
        message: 'Redstring is optimized for tablet use with Git-based universe management and touch-friendly interface.',
        icon: '📲'
      };
    } else {
      return {
        type: 'info',
        title: 'Git-Only Mode Active',
        message: 'File system access is limited on this device. Redstring will work directly with Git repositories.',
        icon: '🔄'
      };
    }
  }
  
  return {
    type: 'success',
    title: 'Full Desktop Experience',
    message: 'All Redstring features are available including local file management and Git synchronization.',
    icon: '💻'
  };
};

/**
 * Initialize optimal device configuration
 * Should be called at app startup to configure the optimal experience
 */
export const initializeDeviceOptimizedConfig = () => {
  const config = getOptimalDeviceConfig();
  
  // Store device configuration for other components
  if (typeof window !== 'undefined') {
    window.RedstringDeviceConfig = config;
    
    // Emit custom event for components that need to react to device changes
    window.dispatchEvent(new CustomEvent('redstring:device-config-ready', { 
      detail: config 
    }));
  }
  
  return config;
};

/**
 * Get current device configuration (memoized)
 */
export const getCurrentDeviceConfig = () => {
  ensureInitialized();
  if (typeof window !== 'undefined' && window.RedstringDeviceConfig) {
    return window.RedstringDeviceConfig;
  }
  return initializeDeviceOptimizedConfig();
};

/**
 * Check if a specific capability is available on current device
 */
export const hasCapability = (capability) => {
  ensureInitialized();
  const config = getCurrentDeviceConfig();
  
  const capabilities = {
    'local-files': config.enableLocalFileStorage,
    'git-sync': true, // Always available
    'browser-storage': true, // Always available
    'touch-interface': config.touchOptimizedUI,
    'qr-sharing': config.enableQRCodeSharing,
    'cross-device': config.showCrossDeviceContinuity,
    'service-worker': config.enableServiceWorker,
    'full-screen': config.deviceInfo.supportsFileSystemAPI
  };
  
  return capabilities[capability] ?? false;
};

// Lazy initialization - only initialize when first accessed
let isInitialized = false;

const ensureInitialized = () => {
  if (!isInitialized && typeof window !== 'undefined') {
    isInitialized = true; // Set this BEFORE calling initializeDeviceOptimizedConfig to prevent recursion
    initializeDeviceOptimizedConfig();
    
    // Set up resize handler for device orientation changes
    let resizeTimeout;
    window.addEventListener('resize', () => {
      clearTimeout(resizeTimeout);
      resizeTimeout = setTimeout(() => {
        initializeDeviceOptimizedConfig();
      }, 250);
    });
  }
};