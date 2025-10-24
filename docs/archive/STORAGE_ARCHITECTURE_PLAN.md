# Redstring Storage Architecture Plan

## Executive Summary

The Redstring codebase already has excellent foundations for implementing a dual-storage system that maintains 1:1 format consistency between local .redstring files and Git semantic web format. The architecture is well-designed with clear separation of concerns.

## Current Architecture Analysis

### ✅ Strengths
- **Dual Format Export**: `redstringFormat.js` already exports both native Redstring and RDF statements
- **Git Provider Ready**: Sophisticated `gitNativeProvider.js` with GitHub/Gitea support
- **Complete Test Coverage**: Comprehensive Vitest test suite with proper mocking
- **Semantic Web Integration**: JSON-LD context and TTL export capabilities built-in
- **1:1 Fidelity**: Round-trip preservation already implemented

### 🔄 Current Data Flow
```
Zustand Store (Maps) → redstringFormat.js → {fileStorage.js, gitStorage.js} → {.redstring files, Git repos}
```

## Implementation Plan

### Phase 1: Format Consistency Tests
Create automated tests to ensure 1:1 fidelity between formats:

```javascript
// test/formats/consistency.test.js
describe('Format Consistency', () => {
  it('should maintain 1:1 fidelity between local and git formats', async () => {
    const originalState = createComplexTestState();
    
    // Export to both formats
    const redstringData = exportToRedstring(originalState);
    const gitData = await exportToGitFormat(originalState);
    
    // Import from both formats
    const fromRedstring = importFromRedstring(redstringData);
    const fromGit = importFromGitFormat(gitData);
    
    // Assert perfect equality
    expect(normalizeForComparison(fromRedstring.storeState))
      .toEqual(normalizeForComparison(fromGit.storeState));
  });
});
```

### Phase 2: Enhanced Git Storage
Extend the existing `gitStorage.js` to support semantic decomposition:

```javascript
// Enhanced git storage with semantic files
export const saveToGitSemantic = async (storeState) => {
  const redstringData = exportToRedstring(storeState);
  
  // Save main .redstring file
  await currentProvider.writeFileRaw('universe.redstring', 
    JSON.stringify(redstringData, null, 2));
  
  // Decompose and save semantic files
  await saveNodePrototypesToTTL(storeState.nodePrototypes);
  await saveGraphsToTTL(storeState.graphs);
  await saveEdgesToTTL(storeState.edges);
};
```

### Phase 3: Abstraction Carousel Integration
Ensure the decomposition view and abstraction carousel work with both formats:

```javascript
// test/integration/abstraction-carousel.test.js
describe('Abstraction Carousel Integration', () => {
  it('should work identically with local and git storage', async () => {
    const stateWithCarousel = createStateWithAbstractionChains();
    
    // Test local storage round-trip
    const localSaved = await saveToLocalFile(stateWithCarousel);
    const localLoaded = await loadFromLocalFile(localSaved);
    
    // Test git storage round-trip  
    const gitSaved = await saveToGitSemantic(stateWithCarousel);
    const gitLoaded = await loadFromGitSemantic(gitSaved);
    
    // Carousel should work identically
    expect(getAbstractionChains(localLoaded))
      .toEqual(getAbstractionChains(gitLoaded));
  });
});
```

## Test Automation Strategy

### 1. Round-Trip Tests
```bash
npm run test:roundtrip   # Tests format consistency
npm run test:semantic   # Tests semantic web compliance
npm run test:carousel   # Tests abstraction carousel integration
```

### 2. Property-Based Testing
Use property-based testing to generate complex graph structures and ensure format preservation:

```javascript
import { fc } from 'fast-check';

const arbitraryGraphState = fc.record({
  graphs: fc.dictionary(fc.string(), arbitraryGraph()),
  nodePrototypes: fc.dictionary(fc.string(), arbitraryNode()),
  edges: fc.dictionary(fc.string(), arbitraryEdge())
});

fc.assert(fc.property(arbitraryGraphState, (state) => {
  const exported = exportToRedstring(state);
  const imported = importFromRedstring(exported);
  return deepEqual(state, imported.storeState);
}));
```

### 3. Continuous Integration
Add CI checks for format consistency:

```yaml
# .github/workflows/storage-consistency.yml
- name: Test Storage Format Consistency
  run: |
    npm run test:roundtrip
    npm run test:semantic
    npm run test:carousel
```

## Implementation Files Needed

### Test Files
- `test/formats/consistency.test.js` - Core format consistency tests
- `test/formats/roundtrip.test.js` - Round-trip fidelity tests  
- `test/integration/abstraction-carousel.test.js` - Carousel integration tests
- `test/property/graph-generation.test.js` - Property-based tests

### Enhanced Storage
- `src/formats/gitSemanticFormat.js` - Git-specific semantic decomposition
- `src/storage/unifiedStorage.js` - Unified storage interface
- `test/storage/unified.test.js` - Unified storage tests

## Next Steps

1. **Create comprehensive test suite** for format consistency
2. **Enhance git storage** with semantic file decomposition  
3. **Implement property-based testing** for complex graph structures
4. **Add CI/CD checks** for format consistency
5. **Document storage patterns** for contributors

## Benefits

- ✅ **Guaranteed 1:1 fidelity** between local and Git formats
- ✅ **Semantic web compliance** with TTL decomposition
- ✅ **Automated testing** prevents format drift
- ✅ **Future-proof architecture** supports new storage backends
- ✅ **Developer confidence** through comprehensive test coverage

The foundation is excellent - we just need to add the comprehensive testing and semantic decomposition layers!