import {
  NODE_WIDTH,
  NODE_HEIGHT,
  NODE_PADDING,
  EXPANDED_NODE_WIDTH,
  NODE_CORNER_RADIUS,
  NAME_AREA_FACTOR
} from './constants.js'; // Import necessary constants
import useGraphStore from './store/graphStore.js'; // Import store for textSettings
import { measureTextBlockHeight, measureTextWidth, buildNodeFontString } from './services/textMeasurement.js';

// Font-load guard: clear dimension cache once the custom font is ready
let fontLoadListenerAdded = false;

// --- Define constants for preview dimensions ---
const PREVIEW_NODE_WIDTH = 600; // Wider for preview
const PREVIEW_NODE_MIN_HEIGHT = 600; // Making it a square
const PREVIEW_TEXT_AREA_HEIGHT = 100; // Fixed height for name in preview
const DESCRIPTION_LINE_HEIGHT = 24; // Height per line for description text
const DESCRIPTION_MAX_LINES = 3; // Maximum lines to show
const DESCRIPTION_PADDING = 8; // Padding around description text

// PERFORMANCE: Internal cache for dimension calculations
// This provides a second layer of caching beyond the caller's cache
const dimensionCache = new Map();
const MAX_CACHE_SIZE = 1000; // Prevent unbounded growth

// --- getNodeDimensions Utility Function ---
export const getNodeDimensions = (node, isPreviewing = false, descriptionContent = null, lineHeightBase = 39) => {
  // --- ADDED: Handle undefined nodes gracefully ---
  if (!node) {
    console.warn('[getNodeDimensions] Received undefined node, returning default dimensions');
    return {
      currentWidth: NODE_WIDTH,
      currentHeight: NODE_HEIGHT,
      textAreaHeight: NODE_HEIGHT,
      imageWidth: 0,
      calculatedImageHeight: 0,
      innerNetworkWidth: 0,
      innerNetworkHeight: 0,
      descriptionAreaHeight: 0
    };
  }

  // --- ADDED: Handle placeholder nodes from AbstractionCarousel ---
  if (node && (node.type === 'add_generic' || node.type === 'add_specific')) {
    const placeholderWidth = NODE_WIDTH * 1.2;
    return {
      currentWidth: placeholderWidth,
      currentHeight: NODE_HEIGHT,
      textAreaHeight: NODE_HEIGHT,
      imageWidth: 0,
      calculatedImageHeight: 0,
      innerNetworkWidth: 0,
      innerNetworkHeight: 0,
      descriptionAreaHeight: 0
    };
  }

  // Use getters to access node properties
  const nodeName = node.getName ? node.getName() : (node.name || 'Unnamed Node'); // Handle potential plain objects gracefully for now?
  const thumbnailSrc = node.getThumbnailSrc ? node.getThumbnailSrc() : node.thumbnailSrc; // Use getter
  // const imageSrc = node.getImageSrc ? node.getImageSrc() : node.imageSrc; // If needed for dimensions

  // PERFORMANCE: Check cache first
  // Create cache key based on all properties that affect dimensions
  // Include text settings to invalidate cache when text size changes
  const textSettings = useGraphStore.getState().textSettings;
  const nodeScale = textSettings.nodeScale ?? 1.0;
  const cacheKey = `${nodeName}-${thumbnailSrc || 'noimg'}-${isPreviewing}-${descriptionContent || 'nodesc'}-${textSettings.fontSize}-${textSettings.lineSpacing}-${nodeScale}-${lineHeightBase}`;

  const cached = dimensionCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const hasImage = Boolean(thumbnailSrc); // Check based on thumbnail
  // We can't easily get naturalWidth/Height from a src string here.
  // We might need to pass pre-calculated image dimensions into the node data itself,
  // or adjust the logic to not rely on naturalWidth/Height if possible.
  // For now, let's assume hasValidImageDimensions might be simplified or handled differently.
  // const hasValidImageDimensions = hasImage && node.image.naturalWidth > 0; // This needs re-evaluation
  const hasValidImageDimensions = hasImage; // Simplification for now

  // Scaled geometry constants — all node geometry scales proportionally with nodeScale
  const sW   = NODE_WIDTH * 1.4 * nodeScale;
  const sH   = NODE_HEIGHT * 1.4 * nodeScale;
  const sP   = NODE_PADDING * 1.4 * nodeScale;
  const sEW  = EXPANDED_NODE_WIDTH * 1.4 * nodeScale;
  const sCR  = NODE_CORNER_RADIUS * 1.4 * nodeScale;
  const sPW  = PREVIEW_NODE_WIDTH * 1.4 * nodeScale;
  const sPMH = PREVIEW_NODE_MIN_HEIGHT * 1.4 * nodeScale;
  const sPTA = PREVIEW_TEXT_AREA_HEIGHT * 1.4 * nodeScale;
  const sICP = 24 * 1.4 * nodeScale; // INNER_CANVAS_PADDING

  // Augment textSettings so font measurement uses the proportionally scaled font size
  const augTs = { ...textSettings, fontSize: textSettings.fontSize * nodeScale };

  // --- Text Measurement (via Pretext — no DOM reflow) ---
  const fontString = buildNodeFontString(augTs);
  const textWidth = measureTextWidth(nodeName, fontString);

  // Set up font-load listener to clear dimension cache when custom font loads
  if (!fontLoadListenerAdded && typeof document !== 'undefined' && document.fonts) {
    fontLoadListenerAdded = true;
    document.fonts.ready.then(() => {
      dimensionCache.clear();
    });
  }

  // --- Determine base dimensions based on state ---
  let baseWidth, baseHeight, textWidthTarget;
  if (isPreviewing) {
    baseWidth = sPW;
    baseHeight = sPMH;
    // We want the text to wrap EXACTLY as it did in the unexpanded node.
    const textWidthWithBuffer = textWidth + 20;
    const unexpandedWidth = Math.max(sW, Math.min(textWidthWithBuffer + 2 * sP, sEW));
    textWidthTarget = unexpandedWidth - 2 * sP;
  } else if (hasImage) {
    baseWidth = sEW;
    baseHeight = sH; // Start with base, image adds later
    textWidthTarget = baseWidth - 2 * sP;
  } else {
    baseWidth = sW;
    baseHeight = sH;
    textWidthTarget = baseWidth - 2 * sP;
  }

  // --- Shared Constant ---
  const TEXT_V_PADDING_TOTAL = Math.round(79 * nodeScale); // Total vertical padding for preview mode

  // --- Calculate Dimensions Based on State ---
  let currentWidth, currentHeight, textAreaHeight, imageWidth, calculatedImageHeight, innerNetworkWidth, innerNetworkHeight, descriptionAreaHeight;

  // Shared: compute scaled line height
  const scaledLineHeightShared = (lineHeightBase || 28) * nodeScale * augTs.lineSpacing;

  if (isPreviewing) {
    currentWidth = baseWidth;
    // Calculate textAreaHeight dynamically based on actual text wrapping with correct width
    // augTs.fontSize already folds in nodeScale, so this measures with a line height that
    // scales with font size (matches Node.jsx render: base * fontSize * lineSpacing * nodeScale).
    const textBlockHeight = measureTextBlockHeight(nodeName, textWidthTarget, augTs, lineHeightBase * augTs.fontSize);
    textAreaHeight = Math.max(sPTA, textBlockHeight + TEXT_V_PADDING_TOTAL);

    innerNetworkWidth = currentWidth - 2 * sP;

    // Calculate description area height dynamically based on actual content
    if (descriptionContent && descriptionContent.trim() && descriptionContent !== 'No description.') {
      // Measure actual text to determine how many lines we need
      const actualHeight = measureTextBlockHeight(descriptionContent, innerNetworkWidth, augTs, DESCRIPTION_LINE_HEIGHT * augTs.fontSize);

      // Cap at maximum 3 lines but use actual height if smaller (fontSize-scaled to match render)
      const maxAllowedHeight = DESCRIPTION_MAX_LINES * DESCRIPTION_LINE_HEIGHT * augTs.fontSize;
      const contentHeight = Math.min(actualHeight, maxAllowedHeight);
      descriptionAreaHeight = contentHeight + 16 * nodeScale; // Padding (12px top + 4px bottom, matches Node.jsx)
    } else {
      // If no description, set height to 0
      descriptionAreaHeight = 0;
    }
    // Calculate network height based on dynamic textAreaHeight and description area, ensuring minimum height
    const availableHeightForNetwork = sPMH - textAreaHeight - descriptionAreaHeight;
    const minNetworkHeight = 300 * nodeScale;
    innerNetworkHeight = Math.max(minNetworkHeight, availableHeightForNetwork);

    // Final node height: text area + network + description spacing + description + inner canvas padding + border inset
    const DESCRIPTION_SPACING = descriptionAreaHeight > 0 ? 8 * nodeScale : 0;
    currentHeight = textAreaHeight + innerNetworkHeight + DESCRIPTION_SPACING + descriptionAreaHeight + sICP + 6;

    // Reset image dimensions
    imageWidth = 0;
    calculatedImageHeight = 0;
  } else if (hasImage) {
    currentWidth = baseWidth;
    // Calculate text block height based on expanded width
    // augTs.fontSize already folds in nodeScale, so this measures with a line height that
    // scales with font size (matches Node.jsx render: base * fontSize * lineSpacing * nodeScale).
    const textBlockHeight = measureTextBlockHeight(nodeName, textWidthTarget, augTs, lineHeightBase * augTs.fontSize);
    // Text area height is text height + vertical padding, with a minimum.
    textAreaHeight = Math.max(sH, textBlockHeight + TEXT_V_PADDING_TOTAL);

    // Calculate image dimensions
    imageWidth = currentWidth - 2 * sP;
    if (hasValidImageDimensions) {
      // Get stored aspect ratio or use a default (e.g., 1 for square)
      const aspectRatio = node.getImageAspectRatio ? node.getImageAspectRatio() : 1;

      // Calculate height based on width and aspect ratio
      calculatedImageHeight = aspectRatio ? imageWidth * aspectRatio : 0;

      // Adjust overall node height to accommodate image
      // Height = Text Area + Image Area + Bottom Padding
      currentHeight = textAreaHeight + calculatedImageHeight + sP;
    } else {
      calculatedImageHeight = 0; // Handle invalid image data
      currentHeight = textAreaHeight; // Just the text area height
    }
    // Reset network and description dimensions for non-preview modes
    innerNetworkWidth = 0;
    innerNetworkHeight = 0;
    descriptionAreaHeight = 0;
  } else {
    // --- Node WITHOUT Image ---
    const isSingleWord = !nodeName.includes(' ');

    // Determine width based on text length, clamped between sW and sEW
    const textWidthWithBuffer = textWidth * 1.1;
    currentWidth = Math.max(sW, Math.min(textWidthWithBuffer + 2 * sP, sEW));

    // Line height scales with both font size and nodeScale (augTs.fontSize already includes nodeScale)
    const fontSizeScaledLineHeight = 45 * augTs.fontSize * augTs.lineSpacing;

    let textBlockHeight;
    // If it's a single word and not at max width, don't let it wrap.
    if (isSingleWord && currentWidth < sEW) {
      textBlockHeight = fontSizeScaledLineHeight;
    } else {
      const actualTextWidth = currentWidth - 2 * sP;
      textBlockHeight = measureTextBlockHeight(nodeName, actualTextWidth, augTs, 45 * augTs.fontSize);

      // For multi-line nodes at max width, try to find a narrower width that still
      // fits the same number of lines — avoids wide rectangular nodes with excess side space.
      if (currentWidth >= sEW) {
        const effectiveLineHeight = 45 * augTs.fontSize * augTs.lineSpacing;
        const numLines = Math.round(textBlockHeight / effectiveLineHeight);
        if (numLines > 1) {
          // Candidate: average line width * 1.3 buffer
          const candidateTextWidth = Math.ceil((textWidth / numLines) * 1.3);
          const candidateWidth = Math.max(sW, Math.min(candidateTextWidth + 2 * sP, currentWidth));
          if (candidateWidth < currentWidth) {
            const candidateHeight = measureTextBlockHeight(nodeName, candidateTextWidth, augTs, 45 * augTs.fontSize);
            const candidateLines = Math.round(candidateHeight / effectiveLineHeight);
            if (candidateLines <= numLines) {
              currentWidth = candidateWidth;
              textBlockHeight = candidateHeight;
            }
          }
        }
      }
    }

    // Total height = text block + vertical padding, minimum sH.
    currentHeight = Math.max(sH, textBlockHeight + Math.round(67 * nodeScale));

    // The text area itself now effectively is the full height to allow vertical centering.
    textAreaHeight = currentHeight;

    // Reset image, network, and description dimensions for non-preview modes
    imageWidth = 0;
    calculatedImageHeight = 0;
    innerNetworkWidth = 0;
    innerNetworkHeight = 0;
    descriptionAreaHeight = 0;
  }

  // Ensure minimum height (redundant check, but safe)
  currentHeight = Math.max(currentHeight, sH);

  // Ensure all return values are numbers (prevent NaN)
  currentWidth = Number(currentWidth) || sW;
  currentHeight = Number(currentHeight) || sH;
  textAreaHeight = Number(textAreaHeight) || sH;
  imageWidth = Number(imageWidth) || 0;
  calculatedImageHeight = Number(calculatedImageHeight) || 0;
  innerNetworkWidth = Number(innerNetworkWidth) || 0;
  innerNetworkHeight = Number(innerNetworkHeight) || 0;
  descriptionAreaHeight = Number(descriptionAreaHeight) || 0;

  const result = {
    currentWidth,
    currentHeight,
    textAreaHeight,
    imageWidth,
    calculatedImageHeight,
    innerNetworkWidth,
    innerNetworkHeight,
    descriptionAreaHeight,
    scaledPadding: sP,
    scaledCornerRadius: sCR,
  };

  // PERFORMANCE: Store in cache with LRU eviction
  dimensionCache.set(cacheKey, result);

  // Implement simple LRU: if cache is too large, delete oldest entries
  if (dimensionCache.size > MAX_CACHE_SIZE) {
    const keysToDelete = [];
    let count = 0;
    const deleteCount = Math.floor(MAX_CACHE_SIZE * 0.2); // Delete oldest 20%

    for (const key of dimensionCache.keys()) {
      if (count++ < deleteCount) {
        keysToDelete.push(key);
      } else {
        break;
      }
    }

    keysToDelete.forEach(key => dimensionCache.delete(key));
  }

  return result;
};

// Add other utility functions here if needed

/**
 * Generates a thumbnail data URL from an image source.
 * @param {string | File} imageSource - The image source (data URL or File object).
 * @param {number} maxDimension - The maximum width or height for the thumbnail.
 * @returns {Promise<string>} A promise that resolves with the thumbnail data URL.
 */
export const generateThumbnail = (imageSource, maxDimension) => {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');

      let { width, height } = img;

      // Calculate new dimensions
      if (width > height) {
        if (width > maxDimension) {
          height = Math.round(height * (maxDimension / width));
          width = maxDimension;
        }
      } else {
        if (height > maxDimension) {
          width = Math.round(width * (maxDimension / height));
          height = maxDimension;
        }
      }

      canvas.width = width;
      canvas.height = height;

      // Draw the image onto the canvas
      ctx.drawImage(img, 0, 0, width, height);

      // Keep PNG for PNG sources (preserves transparency), JPEG for everything else
      const isPng = typeof imageSource === 'string' &&
        (imageSource.startsWith('data:image/png') || imageSource.toLowerCase().endsWith('.png'));
      const thumbnailDataUrl = isPng
        ? canvas.toDataURL('image/png')
        : canvas.toDataURL('image/jpeg', 0.8);
      resolve(thumbnailDataUrl);
    };
    img.onerror = (error) => {
      console.error("Error loading image for thumbnail generation:", error);
      reject(new Error("Could not load image"));
    };

    // Set the image source
    if (imageSource instanceof File) {
      const reader = new FileReader();
      reader.onload = (e) => {
        img.src = e.target.result;
      };
      reader.onerror = (error) => {
        console.error("Error reading file for thumbnail generation:", error);
        reject(new Error("Could not read file"));
      };
      reader.readAsDataURL(imageSource);
    } else if (typeof imageSource === 'string') {
      img.src = imageSource;
    } else {
      reject(new Error("Invalid image source type"));
    }
  });
}; 
