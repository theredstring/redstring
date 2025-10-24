# Universe Import UI Improvements

## Summary
Improved the universe import workflow and made the UI more compact and consistent with better color theming.

## Changes Made

### 1. Load Menu - Added "New from File" Option
**File:** `src/components/git-federation/UniversesList.jsx`

- Added new "New from File" button in the Load dropdown
- Changed "Import From Repository" to "From Repository"  
- Made menu items more compact (reduced padding and font size)
- This gives users a clear way to create a new universe from a file

### 2. ConfirmDialog - Made Scrollable and Compact
**File:** `src/components/shared/ConfirmDialog.jsx`

**Scrollability:**
- Added `maxHeight: '85vh'` to dialog container
- Added `overflow: 'hidden'` to dialog
- Made content area scrollable with `overflowY: 'auto'` and `flex: 1`

**Reduced Vertical Space:**
- Header padding: 20px → stays same (needs room for title)
- Content padding: 24px → 16px 20px
- Message margin: 0 0 16px 0 → 0 0 12px 0
- Message font-size: 0.95rem → 0.9rem
- Message line-height: 1.6 → 1.5
- Input margins: 16px → 12px
- Input padding: 10px 12px → 8px 10px
- Input font-size: 0.9rem → 0.85rem
- Input label font-size: 0.85rem → 0.8rem
- Input label margin: 8px → 6px
- Details margins: 16px → 12px
- Details padding: 12px → 10px
- Details font-size: 0.85rem → 0.8rem
- Details line-height: added 1.4
- Actions padding: 16px 24px → 12px 20px
- Actions gap: 12px → 10px
- Button padding: 10px 20px → 8px 16px
- Button font-size: 0.9rem → 0.85rem

**Color Theming - Red Buttons:**
- Changed all buttons to use #7A0000 red border (was #260000 black)
- Primary button background: #7A0000 (was conditional)
- Primary button hover: #5A0000 (was #1a0000 or #5A0000)
- Cancel button text: #7A0000 (was #260000)
- Cancel button hover background: rgba(122, 0, 0, 0.1) (was rgba(38, 0, 0, 0.1))

### 3. Universe Cards - Removed Folder Path Display & White Lines
**File:** `src/components/git-federation/UniversesList.jsx`

**Local File Section:**
- Removed the file path display (was showing: "File: /path/to/file.redstring")
- Removed the white border line above the path section (`borderTop: '1px solid #979090'`)
- Made layout horizontal with Status and Last saved on same line
- Reduced marginTop from 4px to 2px

**Git Repository Section:**
- Removed the file path display (was showing: "File: universes/slug/slug.redstring")
- Removed the white border line above the status section
- Combined Status and Last saved on same line with flexWrap
- Removed extra padding and made more compact
- Reduced marginTop from 4px to 2px

### 4. Simplified "Link Existing File" Confirmation
**File:** `src/GitNativeFederation.jsx`

- Removed the complex two-option dialog (Link to Existing vs Create New)
- Now only shows a simple warning if file name doesn't match universe name
- Users should use "New from File" from the Load menu if they want to create a new universe
- This makes the workflow clearer and less confusing

## User Benefits

1. **Clear Workflow:** "New from File" in Load menu makes it obvious how to create a new universe from a file
2. **Scrollable Dialogs:** Long content no longer gets cut off
3. **Compact UI:** Takes up ~30% less vertical space in dialogs and cards
4. **Consistent Theming:** All buttons use the same red color scheme
5. **Less Clutter:** Removed redundant file path information that was taking up space
6. **Cleaner Look:** No more white divider lines breaking up the content

## Testing Checklist

- [x] Load → New from File works and creates new universe
- [x] Load → From Repository still works
- [x] ConfirmDialog is scrollable when content is tall
- [x] All buttons are red-themed (#7A0000)
- [x] No folder emoji or path display in Local File section
- [x] No white line under Status in Git section
- [x] No white line under Status in Local File section
- [x] Link Existing File shows simplified confirmation
- [x] No linting errors

## Visual Changes

### Before:
- Black buttons (#260000)
- File path shown with folder emoji in Local File section
- White divider lines between sections
- Dialog content could overflow without scrolling
- Complex two-button dialog for file import

### After:
- Red buttons (#7A0000) matching the app theme
- No file path display (just Last saved info)
- No divider lines - cleaner appearance
- Dialog scrolls when content is tall
- Simple, clear options for importing files

