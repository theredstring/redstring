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

// Helper function to get a specific color's hex code from a palette
// e.g., getColorFromPalette("safari", "tan") -> "#F5F5DC"
export const getColorFromPalette = (paletteName, colorName) => {
    const palette = PALETTES[paletteName];
    if (!palette) return null;
    return palette.colors[colorName] || null;
};

// Helper function to get a random palette name
export const getRandomPalette = () => {
    const keys = Object.keys(PALETTES);
    return keys[Math.floor(Math.random() * keys.length)];
};

// Helper function to get a random color from a specific palette
export const getRandomColorFromPalette = (paletteName) => {
    const palette = PALETTES[paletteName];
    if (!palette) return null;
    const colorKeys = Object.keys(palette.colors);
    if (colorKeys.length === 0) return null;
    const randomColorKey = colorKeys[Math.floor(Math.random() * colorKeys.length)];
    return palette.colors[randomColorKey];
};

/**
 * Resolves a color string to a hex code.
 * If the string is a valid hex code, it returns it as-is.
 * If it's a color name, it attempts to look it up in the given palette.
 * If that fails, it falls back to a random color in the given palette.
 */
export const resolvePaletteColor = (paletteName, colorString) => {
    if (!colorString) {
        return getRandomColorFromPalette(paletteName) || '#5B6CFF'; // Default fallback
    }

    // Check if it's already a hex color
    if (colorString.startsWith('#') && (colorString.length === 4 || colorString.length === 7 || colorString.length === 9)) {
        return colorString;
    }

    // Try to resolve as a palette color name
    const resolvedHex = getColorFromPalette(paletteName, colorString);
    if (resolvedHex) {
        return resolvedHex;
    }

    // Fallback: didn't match anything, pick random from palette
    return getRandomColorFromPalette(paletteName) || '#5B6CFF';
};

/**
 * Builds the text fragment to inject into AI system prompts, 
 * listing all available palettes and their colors.
 */
export const buildPalettePromptFragment = () => {
    let fragment = "## Available Color Palettes\n\n";
    fragment += "When you create maps, nodes, graphs, and connection definitions, you should generally ensure color consistency by picking ONE palette from the options below and sticking to it. For their `color` property, just provide the name of the color in the palette (e.g. \"tan\").\n\n";

    for (const [key, palette] of Object.entries(PALETTES)) {
        const colorNames = Object.keys(palette.colors).join(", ");
        fragment += `- **"${key}"**: ${colorNames}\n`;
    }

    return fragment;
};
