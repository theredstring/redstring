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
- Only extracted the main infobox image from Wikipedia REST API summary endpoint
- Many articles with photos in sections had no image available
- REST API `media-list` endpoint was not working reliably

**New Behavior:**
- Uses Wikipedia's **action API** with multiple strategies for comprehensive image retrieval:
  1. First tries REST API summary endpoint for main image (fast, single call)
  2. If no image, tries action API `prop=pageimages&piprop=original` for main page image
  3. If still no image, queries `prop=images` to get all article images
  4. Always fetches additional images from article content for alternatives
- Properly handles action API responses with image title queries and imageinfo
- Filters out non-content images (icons, logos, edit buttons, flags, symbols, etc.)
- Stores up to 3 quality images as alternatives
- Falls back gracefully through multiple strategies
- 2-4 API calls per page depending on image availability (optimized batch requests)

**Image Selection UI:**
- "Set as image" button changes to "Choose image ▾" when multiple images available
- Dropdown shows thumbnails (60x60) of all available images
- Click any thumbnail to set it as the node image
- Main image shown first, labeled "Main image"
- Additional images labeled "Image 1", "Image 2", etc.
- Error handling for failed image loads

### 3. API Call Efficiency

**Total API Calls Per Wikipedia Link:**
- Best case (main image in summary): 2-3 calls
  - 1 call to REST API summary
  - 1-2 calls to action API for additional images (list + batch imageinfo)
- Fallback case (no main image): 3-4 calls
  - 1 call to REST API summary
  - 1 call to action API pageimages for main image
  - 1-2 calls to action API for additional images (list + batch imageinfo)

All additional image queries are batched to minimize API calls. This ensures reliable image retrieval while keeping API usage reasonable.

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
   - Uses Wikipedia **action API** instead of REST API media-list
   - Makes initial query with `prop=images&imlimit=10` to get image titles
   - Filters out non-content images (icons, logos, flags, symbols)
   - Batch queries image URLs with `prop=imageinfo&iiprop=url`
   - Returns array of image objects with URL and thumbnail
   - Properly handles action API response structure

### Updated Functions

1. **`searchWikipedia(query)`**
   - Detects disambiguation pages
   - Increased search results to 8
   - Better disambiguation detection

2. **`getWikipediaPage(title)`** - MAJOR UPDATE
   - Multi-strategy approach for robust image retrieval:
     1. First tries REST API summary for fast main image lookup
     2. Falls back to action API `prop=pageimages&piprop=original` if no summary image
     3. Falls back to `getWikipediaImages()` to search all article images
   - Properly handles action API response structure (query.pages)
   - Intelligently manages additionalImages array (removes first if used as main)
   - Always fetches additional images for alternatives
   - Stores all images in response metadata

3. **`applyWikipediaData(pageData)`**
   - Stores additional images in metadata
   - Unchanged from previous implementation

4. **`unlinkSource(domain)`**
   - Cleans up `wikipediaAdditionalImages`
   - Unchanged from previous implementation

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

## Fix Applied (Latest)

### Issue
The original implementation attempted to use Wikipedia's REST API `media-list` endpoint which was not working reliably. This caused Wikipedia image fetching to fail when no main image was present in the summary endpoint.

### Solution
Migrated from REST API to Wikipedia's **action API** for image retrieval:
- Changed from `https://en.wikipedia.org/api/rest_v1/page/media-list/` (broken)
- To `https://en.wikipedia.org/w/api.php?action=query&prop=images` (working)
- Added fallback to `prop=pageimages&piprop=original` for main images
- Properly handles action API response structure with `query.pages`
- Batch queries image URLs with `prop=imageinfo` for efficiency

This fix ensures images are reliably pulled from Wikipedia articles even when:
- No infobox image exists
- REST API summary doesn't provide an image
- Images are embedded in article sections rather than the lead

## Testing Recommendations

1. Test with articles that have disambiguation pages (e.g., "Mercury", "Lincoln")
2. Test with articles that have photos in sections but not in infobox (e.g., "Albert Einstein")
3. Test with articles that have no photos at all
4. Verify API call counts remain reasonable (2-4 calls per article)
5. Test image selection dropdown with multiple images
6. Test unlinking Wikipedia data cleans up all fields properly
7. **NEW:** Test articles where REST API summary has no image but action API pageimages does
8. **NEW:** Test articles where only embedded images exist (not in pageimages)

