# GraphStore File Clarification

## TL;DR

**There is only ONE graph store file:** `src/store/graphStore.jsx`

## History

The file was originally `graphStore.js` and was renamed to `graphStore.jsx` in commit `7b766ee`:

```
7b766ee - Refactor: Update import paths for useGraphStore to use .jsx extension
          across all components and services, ensuring consistency and
          compatibility with the new file structure.
```

## Current State

### File Location
- **Single file:** `src/store/graphStore.jsx`
- **No other store files** (only `fileStorage.js` and `gitStorage.js` exist alongside it)

### Import Patterns

Due to the gradual migration, there are **mixed import patterns** in the codebase:

```javascript
// Some files use .jsx extension explicitly
import useGraphStore from "./store/graphStore.jsx";

// Some files omit extension (modern module resolution handles this)
import useGraphStore from './store/graphStore';
```

**Both patterns work correctly** - Vite/ESBuild module resolution handles both.

### Why the Confusion?

Many documentation files still reference `graphStore.js` (with `.js` extension):
- Legacy documentation not updated during rename
- Documentation generators that auto-detect imports
- Comments and references in older code

## Verification

Run these commands to verify:

```bash
# Only one graphStore file exists
ls -la src/store/graphStore.*
# Output: src/store/graphStore.jsx

# Check all store files
find src/store -name "*.js" -o -name "*.jsx"
# Output:
# src/store/fileStorage.js
# src/store/gitStorage.js
# src/store/graphStore.jsx
```

## Documentation Status

Updated files to use correct `.jsx` extension:
- ✅ `CLAUDE.md` - Fixed reference to `graphStore.jsx`
- ✅ `SAVE_PERFORMANCE_OPTIMIZATIONS.md` - Added clarification note
- ⚠️ Other docs may still reference `graphStore.js` - this is cosmetic only

## For Developers

When referencing the graph store in documentation or comments:

**Correct:**
```
src/store/graphStore.jsx
```

**Also works (but less explicit):**
```javascript
// In imports - module resolution handles both
import useGraphStore from './store/graphStore';      // ✅ Works
import useGraphStore from './store/graphStore.jsx';  // ✅ Also works
```

## Key Takeaway

**There is no duplicate store or confusion in the actual codebase** - just documentation inconsistency in file extension references. All imports resolve to the same single file: `src/store/graphStore.jsx`
