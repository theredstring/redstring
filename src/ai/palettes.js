export const PALETTES = {
    "rainbow": {
        name: "Rainbow",
        colors: {
            "red": "#C00909",
            "orange": "#FF4400",
            "yellow": "#FFB33F",
            "green": "#268938",
            "blue": "#144E8E",
            "purple": "#6246B1"
        }
    },
    "coastal": {
        name: "Coastal",
        colors: {
            "navy-blue": "#0B2D72",
            "blue": "#0A92C2",
            "sky-blue": "#0AC4E0",
            "tan": "#F6E7BC"
        }
    },
    "safari": {
        name: "Safari",
        colors: {
            "green": "#849950",
            "tan": "#FFE797",
            "orange": "#FCB53B",
            "red": "#A72706"
        }
    },
    "teal-gradient": {
        name: "Teal Gradient",
        colors: {
            "darkest": "#2E5249",
            "dark": "#437057",
            "mid": "#97B067",
            "light": "#E3DE61"
        }
    },
    "mesa": {
        name: "Mesa",
        colors: {
            "dark-green": "#4C4B16",
            "olive": "#4C4B16",
            "tan": "#E6C767",
            "orange": "#F87A53"
        }
    },
    "retro": {
        name: "Retro",
        colors: {
            "teal": "#219C90",
            "yellow": "#E9B825",
            "orange": "#EE9322",
            "red": "#D83F31"
        }
    },
    "beige-gradient": {
        name: "Beige Gradient",
        colors: {
            "darkest": "#8E806A",
            "dark": "#C3B091",
            "mid": "#C3B091",
            "light": "#FFE6BC"
        }
    },
    "brown-rainbow": {
        name: "Brown Rainbow",
        colors: {
            "brown": "#4A3933",
            "orange": "#F0A500",
            "red": "#E45826",
            "tan": "#B79B88"
        }
    },
    "taffy": {
        name: "Taffy",
        colors: {
            "pink": "#FDB5CE",
            "navy": "#142540",
            "blue": "#16476A",
            "teal": "#16476A"
        }
    },
    "sunset": {
        name: "Sunset",
        colors: {
            "blue": "#0D1164",
            "purple": "#640D5F",
            "pink": "#EA2264",
            "orange": "#F78D60"
        }
    },
    "tropical": {
        name: "Tropical",
        colors: {
            "green": "#78C841",
            "lime": "#B4E50D",
            "orange": "#FF9B2E",
            "red": "#FB4141"
        }
    },
    "clay": {
        name: "Clay",
        colors: {
            "purple": "#604652",
            "mud": "#735557",
            "sage": "#97866A",
            "tan": "#D29F80"
        }
    },
    "purple-gradient": {
        name: "Purple Gradient",
        colors: {
            "darkest": "#5A639C",
            "dark": "#7776B3",
            "mid": "#9B86BD",
            "light": "#E2BBE9"
        }
    }
};

// Helper function to get an array of available palette names
export const getPaletteNames = () => Object.keys(PALETTES);

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
    if (!colorString) {
        const pName = paletteName || getRandomPalette();
        return getRandomColorFromPalette(pName) || '#5B6CFF'; // Default fallback
    }

    // Check if it's already a hex color, tolerating missing #
    const isHex = /^#?([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6}|[0-9A-Fa-f]{8})$/.test(colorString);
    if (isHex) {
        return colorString.startsWith('#') ? colorString : '#' + colorString;
    }

    if (paletteName) {
        // Try to resolve as a palette color name
        const resolvedHex = getColorFromPalette(paletteName, colorString);
        if (resolvedHex) {
            return resolvedHex;
        }
    } else {
        // If no palette provided, try to find this color name in ANY palette
        const matchingPaletteEntry = Object.entries(PALETTES).find(([_, p]) => 
            p.colors[normalizeKey(colorString)]
        );
        if (matchingPaletteEntry) {
            return matchingPaletteEntry[1].colors[normalizeKey(colorString)];
        }
    }

    // Fallback: didn't match anything, pick random from palette or any random palette
    const pName = paletteName || getRandomPalette();
    return getRandomColorFromPalette(pName) || '#5B6CFF';
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
