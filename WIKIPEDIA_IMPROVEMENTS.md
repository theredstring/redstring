# Wikipedia Integration Improvements

## Overview
Enhanced the Wikipedia linking feature with better disambiguation handling and improved photo extraction from articles.

## Changes Made

### 1. Enhanced Disambiguation Handling

**Previous Behavior:**
- Only showed 3 disambiguation options
- Limited to 5 search results
- Didn't detect actual Wikipedia disambiguation pages

**New Behavior:**
- Detects actual Wikipedia disambiguation pages (pages with type='disambiguation')
- Fetches up to 8 search results for better coverage
- Shows ALL disambiguation options in a scrollable list
- Displays count of available options
- Includes hover effects for better UX
- Maximum height of 300px with scroll for long lists

### 2. Improved Photo Extraction

**Previous Behavior:**
- Only extracted the main infobox image from Wikipedia
- Many articles with photos in sections had no image available
- Single API call to summary endpoint

**New Behavior:**
- Uses Wikipedia's `media-list` API endpoint to fetch all images from the article
- Single additional API call per page (minimal overhead)
- Filters out non-content images (icons, logos, edit buttons, etc.)
- Stores up to 3 quality images as alternatives
- Falls back to article images if main image is not available
- Maintains same total number of API calls when main image exists

**Image Selection UI:**
- "Set as image" button changes to "Choose image ▾" when multiple images available
- Dropdown shows thumbnails (60x60) of all available images
- Click any thumbnail to set it as the node image
- Main image shown first, labeled "Main image"
- Additional images labeled "Image 1", "Image 2", etc.
- Error handling for failed image loads

### 3. API Call Efficiency

**Total API Calls Per Wikipedia Link:**
- Without additional images needed: 1 call (summary API)
- With additional images: 2 calls (summary API + media-list API)

This is the same or minimal increase compared to before, keeping API usage efficient as requested.

### 4. Metadata Storage

New metadata fields added to `semanticMetadata`:
```javascript
{
  wikipediaAdditionalImages: [
    { url: "full-size-image-url", thumbnail: "thumbnail-url" },
    { url: "full-size-image-url", thumbnail: "thumbnail-url" }
  ]
}
```

### 5. Cleanup

All unlink and cleanup functions updated to properly remove:
- `wikipediaAdditionalImages` field
- All other Wikipedia metadata fields

## Technical Details

### New Functions

1. **`getWikipediaImages(pageTitle)`**
   - Fetches media list from Wikipedia
   - Filters for quality content images
   - Returns array of image objects with URL and thumbnail

### Updated Functions

1. **`searchWikipedia(query)`**
   - Detects disambiguation pages
   - Increased search results to 8
   - Better disambiguation detection

2. **`getWikipediaPage(title)`**
   - Calls `getWikipediaImages()` for additional images
   - Stores additional images in response
   - Falls back to article images if main image missing

3. **`applyWikipediaData(pageData)`**
   - Stores additional images in metadata

4. **`unlinkSource(domain)`**
   - Cleans up `wikipediaAdditionalImages`

### UI Components

1. **Disambiguation Display**
   - Shows count: "Multiple Wikipedia pages found (8):"
   - Scrollable container with max-height: 300px
   - Hover effects for better interactivity
   - Shows all options (not limited to 3)

2. **Image Selection Dropdown**
   - Appears when `showImageOptions` is true
   - Shows thumbnails in scrollable list (max-height: 200px)
   - Click to select any image
   - Cancel button to close dropdown

## File Modified

- `src/components/panel/SharedPanelContent.jsx`

## Testing Recommendations

1. Test with articles that have disambiguation pages (e.g., "Mercury", "Lincoln")
2. Test with articles that have photos in sections but not in infobox
3. Test with articles that have no photos at all
4. Verify API call counts remain reasonable
5. Test image selection dropdown with multiple images
6. Test unlinking Wikipedia data cleans up all fields properly

