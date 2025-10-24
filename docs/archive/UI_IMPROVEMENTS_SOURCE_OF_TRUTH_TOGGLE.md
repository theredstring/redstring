# UI Improvements: Source of Truth Toggle & Local File Options

## Changes Summary

### 1. Source of Truth Toggle Button

**File:** `src/components/git-federation/UniversesList.jsx`

#### Before:
- Simple "Set as Source of Truth" button (only shown when NOT source of truth)
- No visual feedback when a slot IS the source of truth
- No indication of whether toggle is available

#### After:
- **Toggle-style button** that changes visual state based on source of truth status:
  
  **When IS Source of Truth:**
  - Filled button with `#7A0000` background
  - Canvas-colored text (`#bdb5b5`)
  - Filled star icon
  - Text: "Source of Truth"
  
  **When NOT Source of Truth:**
  - Outline button with `#7A0000` border
  - `#7A0000` text color
  - Hollow star icon
  - Text: "Not Source of Truth"
  
  **When Only 1 Storage Option:**
  - Button remains visible but dimmed (70% opacity)
  - Cursor: `default` (not clickable)
  - Tooltip: "Only storage option (must remain source of truth)"
  - Ensures user understands they can't toggle off the only storage

#### Implementation Details:

```jsx
{(() => {
  const isSourceOfTruth = universe.sourceOfTruth === 'git'; // or 'local'
  const hasOtherStorage = !!(universe.raw?.localFile?.fileHandle); // or gitRepo
  const canToggle = hasOtherStorage; // Only toggle if there's another option
  
  return (
    <button
      onClick={() => canToggle && onSetPrimarySource(slug, type)}
      style={{
        backgroundColor: isSourceOfTruth ? '#7A0000' : 'transparent',
        color: isSourceOfTruth ? '#bdb5b5' : '#7A0000',
        border: '1px solid #7A0000',
        opacity: canToggle ? 1 : 0.7,
        cursor: canToggle ? 'pointer' : 'default'
      }}
    >
      <Star fill={isSourceOfTruth ? '#bdb5b5' : 'none'} />
      {isSourceOfTruth ? 'Source of Truth' : 'Not Source of Truth'}
    </button>
  );
})()}
```

**Benefits:**
- ✅ Clear visual feedback of current source of truth
- ✅ Toggle-style interaction (click to switch)
- ✅ Prevents accidental removal of only storage option
- ✅ Consistent for both Git and Local File storage slots

---

### 2. Local File Options Menu

**File:** `src/components/git-federation/UniversesList.jsx`

#### Before:
- Single "Add Local File" button
- Only triggered file picker to link existing file
- No option to create a new file

#### After:
- **Dropdown menu** with two options:
  
  **Option 1: Create New File**
  - Icon: `<FileText />`
  - Triggers `onDownloadLocalFile(slug)` 
  - Opens browser's "Save As" dialog
  - Creates new `.redstring` file with current universe data
  
  **Option 2: Link Existing File**
  - Icon: `<Link />`
  - Triggers `onLinkLocalFile(slug)`
  - Opens file picker to select existing `.redstring` file
  - Links the file handle for persistent access

#### Implementation Details:

```jsx
const [showLocalFileMenu, setShowLocalFileMenu] = useState(null);

// Dropdown trigger
<button onClick={() => setShowLocalFileMenu(universe.slug)}>
  <Plus size={12} />
  Add Local File
  <ChevronDown size={10} />
</button>

// Dropdown menu
{showLocalFileMenu === universe.slug && (
  <div style={{ /* positioned dropdown */ }}>
    <button onClick={() => onDownloadLocalFile(universe.slug)}>
      <FileText size={12} /> Create New File
    </button>
    <button onClick={() => onLinkLocalFile(universe.slug)}>
      <Link size={12} /> Link Existing File
    </button>
  </div>
)}
```

**Features:**
- Click-outside-to-close behavior
- Per-universe menu state (only one open at a time)
- Centered below the trigger button
- Matching visual style with other dropdowns (Load menu)

**Benefits:**
- ✅ Users can create new local files directly
- ✅ Users can link existing files (original functionality preserved)
- ✅ Clear visual distinction between two actions
- ✅ Consistent with "Load" dropdown pattern

---

## Related Code Changes

### Added Icons:
```jsx
import { Link, FileText } from 'lucide-react';
```

### State Management:
```jsx
const [showLocalFileMenu, setShowLocalFileMenu] = useState(null); 
// null or universe.slug
```

### Click-Outside Handler:
```jsx
useEffect(() => {
  const handleClickOutside = (event) => {
    if (localFileMenuRef.current && !localFileMenuRef.current.contains(event.target)) {
      setShowLocalFileMenu(null);
    }
  };
  
  if (showLocalFileMenu) {
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }
}, [showLocalFileMenu]);
```

---

## User Workflows

### Workflow 1: Creating a Local File for Existing Universe

1. User has universe with only Git storage
2. Clicks "Add Local File" → Dropdown opens
3. Selects "Create New File"
4. Browser shows "Save As" dialog
5. User picks location and saves
6. File handle is linked to universe
7. Local file slot appears with "Not Source of Truth" button
8. User can click button to promote local file to primary

### Workflow 2: Linking Existing Local File

1. User has universe with only browser storage
2. Clicks "Add Local File" → Dropdown opens
3. Selects "Link Existing File"
4. Browser shows file picker
5. User selects existing `.redstring` file
6. File is uploaded and linked
7. Local file slot appears with "Source of Truth" button (default for browser→local upgrade)

### Workflow 3: Toggling Source of Truth

1. Universe has BOTH Git and Local File storage
2. Git is currently primary (filled button: "Source of Truth")
3. Local file shows outline button: "Not Source of Truth"
4. User clicks "Not Source of Truth" on local file
5. System promotes local to primary
6. Buttons swap:
   - Local file: filled "Source of Truth"
   - Git: outline "Not Source of Truth"

### Workflow 4: Only One Storage Option

1. Universe has ONLY Git storage
2. Git button shows filled "Source of Truth" but dimmed (70% opacity)
3. Cursor changes to `default` (not clickable)
4. Hover tooltip: "Only storage option (must remain source of truth)"
5. User must add second storage slot before toggling

---

## Visual Design

### Colors:
- Primary: `#7A0000` (Redstring brand red)
- Canvas: `#bdb5b5` (light neutral background)
- Border/outline: `#260000` (dark border)
- Hover: `#f5f5f5` (light gray)

### Typography:
- Button text: `0.65rem` to `0.75rem`
- Weight: `600` (semi-bold)

### Spacing:
- Button padding: `2px 6px` (compact for inline display)
- Icon-text gap: `4px` to `6px`
- Dropdown margin-top: `4px`

---

## Testing Checklist

- [x] Source of truth toggle shows correct state for Git
- [x] Source of truth toggle shows correct state for Local
- [x] Toggle disabled when only 1 storage option
- [x] Toggle works to switch primary storage
- [x] Filled button uses canvas color for text/icon
- [x] Outline button uses brand red for text/icon
- [x] Local file dropdown opens on click
- [x] Dropdown closes on click outside
- [x] "Create New File" triggers save dialog
- [x] "Link Existing File" triggers file picker
- [ ] Verify file handle persists after linking
- [ ] Verify new file is created with current data
- [ ] Verify source of truth switches correctly
- [ ] Test on mobile/tablet (may need touch optimizations)

---

## Known Issues / Future Enhancements

1. **"Create New File" terminology**: Currently triggers download/save. Could be clearer as "Save to New File" or "Export to File"
2. **File System Access API**: Not available on all browsers. May need fallback messaging
3. **Mobile experience**: Dropdown may need adjustments for touch devices
4. **Accessibility**: Could add ARIA labels and keyboard navigation

---

## Related Files

- `src/components/git-federation/UniversesList.jsx` - Main UI component
- `src/GitNativeFederation.jsx` - Parent component, handles callbacks
- `src/services/gitFederationService.js` - Backend service for storage management
- `TWO_SLOT_STORAGE_FIX.md` - Documentation of the underlying storage system
