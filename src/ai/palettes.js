import { NODE_DEFAULT_COLOR } from '../constants.js';

export const PALETTES = {
    "rainbow": {
        name: "Rainbow",
        colors: {
            "red": "#8B0000",
            "orange": "#d13800",
            "yellow": "#c47600",
            "green": "#22752d",
            "blue": "#1965b5",
            "purple": "#732ac7"
        }
    },
    "coastal": {
        name: "Coastal",
        colors: {
            "navy-blue": "#0B2D72",
            "blue": "#1b70b5",
            "sky-blue": "#98d6ed",
            "tan": "#cfb469"
        }
    },
    "safari": {
        name: "Safari",
        colors: {
            "green": "#4a9950",
            "tan": "#FFE797",
            "orange": "#FCB53B",
            "red": "#A72706"
        }
    },
    "teal-gradient": {
        name: "Teal Gradient",
        colors: {
            "darkest": "#203b34",
            "dark": "#2f523d",
            "mid": "#97B067",
            "light": "#dfe362"
        }
    },
    "piedmont": {
        name: "Piedmont",
        colors: {
            "dark-green": "#263d11",
            "olive": "#4C4B16",
            "tan": "#5e442a",
            "orange": "#b0563a"
        }
    },
    "retro": {
        name: "Retro",
        colors: {
            "teal": "#26b5a7",
            "yellow": "#E9B825",
            "orange": "#EE9322",
            "red": "#f24738"
        }
    },
    "beige-gradient": {
        name: "Beige Gradient",
        colors: {
            "darkest": "#453f32",
            "dark": "#615745",
            "mid": "#786c59",
            "light": "#d1bc9b"
        }
    },
    "brown-rainbow": {
        name: "Brown Rainbow",
        colors: {
            "brown": "#4f2215",
            "orange": "#d66b00",
            "red": "#c42f21",
            "tan": "#967159"
        }
    },
    "taffy": {
        name: "Taffy",
        colors: {
            "pink": "#FDB5CE",
            "navy": "#0e1a2e",
            "blue": "#27a0c2",
            "teal": "#1d8a86"
        }
    },
    "sunset": {
        name: "Sunset",
        colors: {
            "blue": "#1b1b4a",
            "purple": "#660a66",
            "pink": "#b01a4c",
            "orange": "#F78D60"
        }
    },
    "tropical": {
        name: "Tropical",
        colors: {
            "green": "#3d6921",
            "lime": "#a4d600",
            "orange": "#d46d00",
            "red": "#bd2626"
        }
    },
    "clay": {
        name: "Clay",
        colors: {
            "purple": "#543d4e",
            "mud": "#735557",
            "sage": "#82725b",
            "tan": "#D29F80"
        }
    },
    "purple-gradient": {
        name: "Purple Gradient",
        colors: {
            "darkest": "#192247",
            "dark": "#323273",
            "mid": "#6d5c96",
            "light": "#E2BBE9"
        }
    }
};

// Helper function to get an array of available palette names
export const getPaletteNames = () => Object.keys(PALETTES);

/**
 * Validates that a string is a usable CSS color (hex or named color).
 * Returns false for invalid hex lengths, objects, empty strings, etc.
 */
export const isValidColor = (c) =>
    typeof c === 'string' && c.trim() !== '' &&
    (/^#([0-9A-Fa-f]{3,4}|[0-9A-Fa-f]{6}|[0-9A-Fa-f]{8})$/.test(c) || /^[a-zA-Z]+$/.test(c));

// Normalize a palette or color key: lowercase and replace spaces with hyphens
// so AI-provided strings like "Rainbow" or "navy blue" still resolve correctly
const normalizeKey = (str) => str?.toLowerCase().replace(/\s+/g, '-') ?? '';

// Helper function to get a specific color's hex code from a palette
// e.g., getColorFromPalette("safari", "tan") -> "#FFE797"
export const getColorFromPalette = (paletteName, colorName) => {
    const palette = PALETTES[normalizeKey(paletteName)];
    if (!palette) return null;
    return palette.colors[normalizeKey(colorName)] || null;
};

// Helper function to get a random palette name
export const getRandomPalette = () => {
    const keys = Object.keys(PALETTES);
    return keys[Math.floor(Math.random() * keys.length)];
};

// Helper function to get a random color from a specific palette
export const getRandomColorFromPalette = (paletteName) => {
    const palette = PALETTES[normalizeKey(paletteName)];
    if (!palette) return null;
    const colorKeys = Object.keys(palette.colors);
    if (colorKeys.length === 0) return null;
    const randomColorKey = colorKeys[Math.floor(Math.random() * colorKeys.length)];
    return palette.colors[randomColorKey];
};

export const resolvePaletteColor = (paletteName, colorString) => {
    let resolved;

    if (!colorString) {
        const pName = paletteName || getRandomPalette();
        resolved = getRandomColorFromPalette(pName) || NODE_DEFAULT_COLOR;
    } else {
        // Check if it's already a hex color, tolerating missing #
        const isHex = /^#?([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6}|[0-9A-Fa-f]{8})$/.test(colorString);
        if (isHex) {
            resolved = colorString.startsWith('#') ? colorString : '#' + colorString;
        } else if (paletteName) {
            // Try to resolve as a palette color name
            resolved = getColorFromPalette(paletteName, colorString);
        } else {
            // If no palette provided, try to find this color name in ANY palette
            const matchingPaletteEntry = Object.entries(PALETTES).find(([_, p]) =>
                p.colors[normalizeKey(colorString)]
            );
            if (matchingPaletteEntry) {
                resolved = matchingPaletteEntry[1].colors[normalizeKey(colorString)];
            }
        }

        if (!resolved) {
            // Fallback: didn't match anything, pick random from palette or any random palette
            const pName = paletteName || getRandomPalette();
            resolved = getRandomColorFromPalette(pName) || NODE_DEFAULT_COLOR;
        }
    }

    // Final safety: ensure the resolved color is actually valid before returning
    return isValidColor(resolved) ? resolved : NODE_DEFAULT_COLOR;
};

/**
 * Builds the text fragment to inject into AI system prompts, 
 * listing all available palettes and their colors.
 */
export const buildPalettePromptFragment = () => {
    let fragment = "## Available Color Palettes\n\n";
    fragment += "When creating maps, nodes, and graphs, you are STRONGLY ENCOURAGED to use ONE of the predefined palettes listed below for color consistency. For every `color` property, provide the exact name of the color from your chosen palette (e.g., \"tan\").\n\n";
    fragment += "You may only invent a custom thematic palette (and use raw hex codes) if the user explicitly requests one, or if the domain strictly requires specific semantic colors not available below (e.g., subway lines). Otherwise, stick to these palettes:\n\n";

    for (const [key, palette] of Object.entries(PALETTES)) {
        const colorNames = Object.keys(palette.colors).join(", ");
        fragment += `- **"${key}"**: ${colorNames}\n`;
    }

    return fragment;
};

/**
 * Builds a compact description of available palettes and colors
 * suitable for inclusion in JSON schema descriptions for MCP tools.
 */
export const getPaletteSchemaDescription = () => {
    let desc = "REQUIRED: You MUST choose one of these available palettes and strictly use its color names: ";
    const entries = Object.entries(PALETTES).map(([key, palette]) => {
        return `"${key}" (${Object.keys(palette.colors).join(", ")})`;
    });
    return desc + entries.join("; ") + ".";
};
