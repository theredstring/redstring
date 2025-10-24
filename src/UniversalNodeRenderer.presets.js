/**
 * Preset configurations for UniversalNodeRenderer
 * 
 * These presets can be used across the app for consistent rendering
 * in different contexts like panels, modals, previews, etc.
 */

export const RENDERER_PRESETS = {
  // For connection control panels
  CONNECTION_PANEL: {
    containerWidth: 400,
    containerHeight: 160,
    scaleMode: 'fit',
    minNodeSize: 50,
    maxNodeSize: 100,
    backgroundColor: 'transparent',
    routingStyle: 'smart',
    padding: 16,
    interactive: true,
    showHoverEffects: true,
    showConnectionDots: true,
    alignNodesHorizontally: true
  },

  // For small previews in lists/cards
  THUMBNAIL: {
    containerWidth: 200,
    containerHeight: 100,
    scaleMode: 'fit',
    minNodeSize: 20,
    maxNodeSize: 60,
    backgroundColor: 'transparent',
    routingStyle: 'straight',
    padding: 8,
    interactive: false,
    showHoverEffects: false,
    showConnectionDots: false
  },

  // For larger modal displays
  MODAL_PREVIEW: {
    containerWidth: 600,
    containerHeight: 400,
    scaleMode: 'fit',
    minNodeSize: 80,
    maxNodeSize: 150,
    backgroundColor: '#f8f9fa',
    routingStyle: 'curved',
    padding: 32,
    interactive: true,
    showHoverEffects: true,
    showConnectionDots: true,
    showGrid: true
  },

  // For right panel node definitions
  DEFINITION_PANEL: {
    containerWidth: 300,
    containerHeight: 200,
    scaleMode: 'fit',
    minNodeSize: 40,
    maxNodeSize: 80,
    backgroundColor: 'transparent',
    routingStyle: 'smart',
    padding: 12,
    interactive: true,
    showHoverEffects: true,
    showConnectionDots: false
  },

  // For abstraction carousel context
  ABSTRACTION_CONTEXT: {
    containerWidth: 250,
    containerHeight: 150,
    scaleMode: 'fit',
    minNodeSize: 30,
    maxNodeSize: 70,
    backgroundColor: 'transparent',
    routingStyle: 'curved',
    padding: 16,
    interactive: false,
    showHoverEffects: false,
    showConnectionDots: false
  },

  // For tiny status indicators
  ICON: {
    containerWidth: 40,
    containerHeight: 40,
    scaleMode: 'fit',
    minNodeSize: 15,
    maxNodeSize: 35,
    backgroundColor: 'transparent',
    routingStyle: 'straight',
    padding: 2,
    interactive: false,
    showHoverEffects: false,
    showConnectionDots: false
  }
};

/**
 * Helper function to apply a preset with optional overrides
 */
export const applyPreset = (presetName, overrides = {}) => {
  const preset = RENDERER_PRESETS[presetName];
  if (!preset) {
    console.warn(`Unknown preset: ${presetName}`);
    return overrides;
  }
  return { ...preset, ...overrides };
};

/**
 * Common size presets for different contexts
 */
export const SIZE_PRESETS = {
  TINY: { containerWidth: 60, containerHeight: 40, minNodeSize: 15, maxNodeSize: 25 },
  SMALL: { containerWidth: 150, containerHeight: 100, minNodeSize: 25, maxNodeSize: 50 },
  MEDIUM: { containerWidth: 300, containerHeight: 200, minNodeSize: 40, maxNodeSize: 80 },
  LARGE: { containerWidth: 500, containerHeight: 350, minNodeSize: 60, maxNodeSize: 120 },
  XLARGE: { containerWidth: 800, containerHeight: 600, minNodeSize: 80, maxNodeSize: 150 }
};

/**
 * Create a configured UniversalNodeRenderer component with preset
 * Note: This would need to be used in a React component context
 */
export const createPresetConfig = (presetName, additionalProps = {}) => {
  return applyPreset(presetName, additionalProps);
};

// Example usage:
// import { RENDERER_PRESETS, applyPreset } from './UniversalNodeRenderer.presets';
// 
// // Use a preset directly:
// <UniversalNodeRenderer {...RENDERER_PRESETS.CONNECTION_PANEL} nodes={nodes} connections={connections} />
//
// // Use a preset with overrides:
// <UniversalNodeRenderer {...applyPreset('THUMBNAIL', { containerWidth: 250 })} nodes={nodes} />
//
// // Create a config and use it:
// const thumbnailConfig = createPresetConfig('THUMBNAIL');
// <UniversalNodeRenderer {...thumbnailConfig} nodes={nodes} connections={connections} />
