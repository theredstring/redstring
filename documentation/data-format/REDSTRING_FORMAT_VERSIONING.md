# Redstring Format Versioning System

## Overview

As of January 2025, Redstring has implemented a comprehensive versioning and migration system for the `.redstring` file format to protect user data during updates and ensure backward compatibility.

## Version History

### v3.0.0 (Current - 2025-01)
**Changes:**
- Added comprehensive versioning system
- Implemented validation and migration support
- Added format compatibility checks
- Enhanced error messages for version mismatches

**Breaking Changes:** None (fully backward compatible)

### v2.0.0-semantic (2024-12)
**Changes:**
- Added JSON-LD semantic web integration
- Separated storage into `prototypeSpace` and `spatialGraphs`
- Added RDF schema compliance
- Added `legacy` section for backward compatibility

**Breaking Changes:** None (legacy format supported via compatibility layer)

### v1.0.0 (2024-01)
**Changes:**
- Initial format specification

## File Format Structure

Every `.redstring` file now includes version metadata:

```json
{
  "@context": { ... },
  "@type": "redstring:CognitiveSpace",
  "format": "redstring-v3.0.0",
  "metadata": {
    "version": "3.0.0",
    "created": "2025-01-07T12:00:00.000Z",
    "modified": "2025-01-07T12:00:00.000Z",
    "title": "My Universe",
    "formatHistory": {
      "date": "2025-01",
      "changes": [...],
      "breaking": false
    }
  },
  ...
}
```

If a file has been migrated, it will also include:

```json
{
  "metadata": {
    ...
    "migrated": true,
    "originalVersion": "2.0.0-semantic",
    "migrationDate": "2025-01-07T12:00:00.000Z",
    "migrationsApplied": ["v2_to_v3"]
  }
}
```

## How It Works

### 1. Validation

When a `.redstring` file is opened, the system:

1. Reads the `format` and `metadata.version` fields
2. Compares against `CURRENT_FORMAT_VERSION` (3.0.0)
3. Checks against `MIN_SUPPORTED_VERSION` (1.0.0)
4. Returns validation result:
   - `valid`: true/false
   - `needsMigration`: true/false
   - `canAutoMigrate`: true/false
   - `tooOld`/`tooNew`: indicators for incompatible versions

### 2. Migration

If a file needs migration (`needsMigration: true`):

1. System logs migration intent
2. Shows user-facing message about migration
3. Applies migrations sequentially (v1 → v2 → v3)
4. Updates `format` and `metadata` fields
5. Returns migrated data with version metadata

### 3. User Feedback

The system provides clear feedback at each stage:

- **Loading old file:** "Migrating file from format 2.0.0-semantic to 3.0.0..."
- **Migration complete:** "File migrated from format 2.0.0-semantic to 3.0.0"
- **Too old:** "This file format is too old (0.5.0) and cannot be opened..."
- **Too new:** "This file was created with a newer version of Redstring (4.0.0)..."

## For Developers

### Adding a New Version

When making changes to the `.redstring` format:

1. **Update version constants** in `src/formats/redstringFormat.js`:
   ```javascript
   export const CURRENT_FORMAT_VERSION = '3.1.0';
   ```

2. **Add version history entry**:
   ```javascript
   export const VERSION_HISTORY = {
     '3.1.0': {
       date: '2025-02',
       changes: [
         'Added new feature X',
         'Improved Y handling'
       ],
       breaking: false // or true if breaking
     },
     ...
   };
   ```

3. **Add migration logic** if needed in `migrateFormat()`:
   ```javascript
   if (compareVersions(fromVersion, '3.1.0') === -1) {
     console.log('[Format Migration] Applying v3.0 -> v3.1 migration');
     migrations.push('v3.0_to_v3.1');
     
     // Apply transformations here
     migrated.newField = transformData(migrated.oldField);
   }
   ```

4. **Update export function** if format changes:
   ```javascript
   return {
     ...
     "format": `redstring-v${CURRENT_FORMAT_VERSION}`,
     "metadata": {
       "version": CURRENT_FORMAT_VERSION,
       ...
     }
   };
   ```

5. **Update import function** if new fields need special handling:
   ```javascript
   if (processedData.newField) {
     // Handle new field
   }
   ```

6. **Test migration** with files from all supported versions

### Testing Migrations

To test migrations:

1. Create test files for each version (v1.0.0, v2.0.0-semantic, v3.0.0)
2. Load each file and verify:
   - Validation passes
   - Migration is applied correctly
   - Data is preserved
   - Version metadata is updated
3. Save migrated file and re-open to ensure stability

### Version Comparison Logic

The system uses semantic versioning (MAJOR.MINOR.PATCH):

- **MAJOR:** Breaking changes that require manual intervention
- **MINOR:** New features, backward compatible
- **PATCH:** Bug fixes, no format changes

Comparison function:
```javascript
compareVersions('2.0.0', '3.0.0')  // Returns -1 (v2 < v3)
compareVersions('3.0.0', '3.0.0')  // Returns 0 (equal)
compareVersions('3.1.0', '3.0.0')  // Returns 1 (v3.1 > v3.0)
```

## Critical Principles

1. **Never lose data:** Migrations must preserve all user data
2. **Clear communication:** Users must understand what's happening
3. **Automatic when safe:** Auto-migrate when possible, prompt when not
4. **Version everywhere:** Every exported file includes version info
5. **Test thoroughly:** Test migrations with real-world files
6. **Document changes:** Update VERSION_HISTORY for every change
7. **Minimum supported version:** Set realistically based on migration complexity

## Future Considerations

### Breaking Changes (v4.0.0+)

If you need to make a breaking change:

1. Set `breaking: true` in VERSION_HISTORY
2. Update `MIN_SUPPORTED_VERSION` if old versions can't be migrated
3. Implement manual migration UI for complex cases
4. Provide export/import tools for downgrading if needed
5. Give users advance notice (deprecation warnings)

### Format Extensions

To add non-breaking extensions:

1. Make new fields optional with defaults
2. Ensure old versions ignore unknown fields gracefully
3. Use feature detection instead of version checks where possible
4. Document extensions in version history

### External Format Support

To support importing from external formats:

1. Detect format type before validation
2. Convert to Redstring format
3. Apply current version number
4. Mark as imported in metadata

## API Reference

### `validateFormatVersion(redstringData)`

Validates file format version and checks compatibility.

**Parameters:**
- `redstringData` (Object): Parsed .redstring file data

**Returns:**
```javascript
{
  valid: boolean,
  version: string,
  currentVersion: string,
  needsMigration: boolean,
  canAutoMigrate: boolean,
  tooOld: boolean,   // (optional)
  tooNew: boolean,   // (optional)
  error: string      // (if !valid)
}
```

### `migrateFormat(redstringData, fromVersion, toVersion)`

Migrates data from one format version to another.

**Parameters:**
- `redstringData` (Object): Data to migrate
- `fromVersion` (string): Source version
- `toVersion` (string): Target version (defaults to CURRENT_FORMAT_VERSION)

**Returns:**
- Migrated data object with updated version metadata

### `importFromRedstring(redstringData, storeActions)`

Imports .redstring data with automatic validation and migration.

**Parameters:**
- `redstringData` (Object): Parsed .redstring file data
- `storeActions` (Object): Zustand store actions (optional)

**Returns:**
```javascript
{
  storeState: Object,    // Converted store state
  errors: Array,         // Import errors
  version: {
    imported: string,    // Original version
    current: string,     // Current version
    migrated: boolean,   // Whether migration was applied
    migratedTo: string   // Target version (if migrated)
  }
}
```

## Changelog

### January 2025
- ✅ Implemented comprehensive versioning system
- ✅ Added validation and migration functions
- ✅ Updated export to include version metadata
- ✅ Updated import to validate and migrate
- ✅ Added user-facing migration feedback
- ✅ Created documentation

## Related Files

- `src/formats/redstringFormat.js` - Main format handler with versioning
- `src/GitNativeFederation.jsx` - UI component that uses validation
- `GIT_FEDERATION.md` - Git federation documentation
- `redstring-format-spec.md` - Format specification

## Questions or Issues?

If you encounter version-related issues:

1. Check the console for validation/migration logs
2. Verify the file's `format` and `metadata.version` fields
3. Ensure `CURRENT_FORMAT_VERSION` matches the latest version
4. Test migration logic with example files
5. Update VERSION_HISTORY when making changes

---

**Last Updated:** January 7, 2025
**Current Version:** 3.0.0
**Minimum Supported:** 1.0.0

