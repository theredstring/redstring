# Universe Import Options Update

## Summary
Added the ability to create a new universe when importing/linking a universe file, rather than only being able to overwrite an existing universe.

## Changes Made

### File Modified: `src/GitNativeFederation.jsx`

#### Function: `handleLinkLocalFile`
**Location:** Lines 2330-2500

**What Changed:**
When a user clicks "Link Existing File" on a universe, they now get a dialog with two options:

1. **Link to Existing** - Replace the current universe's data with the file's contents (original behavior)
2. **Create New Universe** - Create a brand new universe from the file (new feature)

**User Flow:**
1. User clicks "Add Local File" → "Link Existing File" on any universe
2. User selects a `.redstring` file from their computer
3. Dialog appears: "How would you like to import [filename]?"
   - **Link to Existing**: Overwrites the current universe with the file data
   - **Create New Universe**: Creates a new universe using the filename as the base name
   - User can also press Escape or click outside to cancel

**Benefits:**
- Prevents accidental data loss when users want to import a file as a new universe
- Provides flexibility in workflow - users can now import multiple universe files without overwriting existing ones
- More intuitive UX - users get to choose their intent explicitly

## Related Flows (No Changes Needed)

### `handleLoadFromLocal` 
This flow already creates a new universe by default when using "Load → From Local File" from the universes list. No changes needed.

### Git Repository Import
Git imports already create new universes by default when using the "Import From Repository" option. No changes needed.

## Testing

To test the new functionality:

1. Start the dev server: `npm run dev`
2. Create or open a universe
3. Click "Add Local File" → "Link Existing File"
4. Select a `.redstring` file
5. Verify the dialog appears with both options
6. Test "Link to Existing" - should overwrite current universe
7. Test "Create New Universe" - should create a new universe with the file name
8. Test canceling - should close without changes

## Code Quality

- ✅ No linting errors
- ✅ Consistent with existing code patterns
- ✅ Proper error handling
- ✅ Loading states handled
- ✅ UI refresh after creating new universe
- ✅ Success messages shown to user

## Implementation Details

### Key Changes:
1. Modified the `handleLinkLocalFile` function to always show a confirmation dialog
2. Removed the old "name mismatch" warning (which only appeared sometimes)
3. Added logic to create a new universe when user clicks "Create New Universe"
4. Reused the `gitFederationService.createUniverse` method
5. Properly handles the new universe slug and updates the payload
6. Calls `refreshState()` to update the UI after creating the new universe

### Dialog Configuration:
```javascript
{
  title: 'Import Universe File',
  message: `How would you like to import "${file.name}"?`,
  details: `• Link to Existing: Replace "${universe?.name || slug}" data with this file's contents.\n\n• Create New Universe: Make a new universe from this file.\n\n(Press Escape or click outside to cancel)`,
  variant: 'default',
  confirmLabel: 'Link to Existing',
  cancelLabel: 'Create New Universe'
}
```

## Future Enhancements

Possible future improvements:
- Add keyboard shortcuts (e.g., Ctrl+N for new, Ctrl+L for link)
- Remember user's last choice as a default
- Add "Always ask" / "Don't ask again" option
- Show preview of file contents before importing
- Batch import multiple files at once

