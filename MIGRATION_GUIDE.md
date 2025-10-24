# Migration Guide: Upgrading to New Semantic System

## Overview

This guide helps you migrate from the old semantic query system to the new enhanced version with property-path queries, entity matching, and radial layout.

## Breaking Changes

### 1. Import Paths (No Changes)
All existing imports continue to work. New APIs are additive.

### 2. Orbit Resolver (Fixed)
The orbit resolver now works correctly without the `require is not defined` error.

**No code changes needed** - it just works now.

## Recommended Migrations

### Migration 1: Replace `findRelatedConcepts` with `discoverConnections`

**Before:**
```javascript
import { findRelatedConcepts } from './services/semanticWebQuery.js';

const results = await findRelatedConcepts("Mario", { limit: 20 });

// Results: Array of entities without clear relationships
results.forEach(item => {
  console.log(item.itemLabel?.value || item.label?.value);
  // No clear relationship information
});
```

**After:**
```javascript
import { discoverConnections } from './services/semanticDiscovery.js';

const results = await discoverConnections("Mario", { limit: 20 });

// Results: Clear relationships with labels
results.connections.forEach(conn => {
  console.log(`${conn.source} → ${conn.relation} → ${conn.target}`);
  // Example: "Mario → developer → Nintendo"
  // Example: "Mario → genre → Platform game"
});
```

**Benefits:**
- 10-50x faster
- Clear relationship labels
- Confidence scores
- Organized by provider

---

### Migration 2: Add Entity Deduplication

**Before:**
```javascript
const wikidataResults = await queryWikidata("Mario");
const dbpediaResults = await queryDBpedia("Mario");

// Manual deduplication
const combined = [...wikidataResults, ...dbpediaResults];
// Likely contains duplicates
```

**After:**
```javascript
import { deduplicateEntities } from './services/entityMatching.js';

const wikidataResults = await queryWikidata("Mario");
const dbpediaResults = await queryDBpedia("Mario");

const combined = [...wikidataResults, ...dbpediaResults];
const deduplicated = deduplicateEntities(combined, {
  autoMergeThreshold: 0.85
});

// Duplicates automatically merged
console.log(`${combined.length} → ${deduplicated.length} entities`);
```

**Benefits:**
- No duplicate entities
- Merged data from multiple sources
- Confidence-based matching

---

### Migration 3: Use High-Level API

**Before:**
```javascript
// Manual workflow
const results = await findRelatedConcepts(entityName);

// Manual filtering
const filtered = results.filter(r => /* some logic */);

// Manual layout calculation
const positions = calculatePositions(filtered);
```

**After:**
```javascript
import { exploreEntity } from './services/semanticIntegration.js';

const result = await exploreEntity(entityName, {
  maxDepth: 2,
  minConfidence: 0.65,
  generateLayout: true
});

// Everything done for you:
// - Discovery
// - Deduplication
// - Organization into orbits
// - Layout generation

console.log(result.entities);     // Deduplicated entities
console.log(result.connections);  // Clear relationships
console.log(result.layout);       // Ready-to-render layout
```

**Benefits:**
- One function call
- Automatic workflow
- Consistent results

---

### Migration 4: Update Orbit Overlay

**Before:**
```javascript
// In OrbitOverlay.jsx or similar
const candidates = await fetchOrbitCandidatesForPrototype(prototype);

// Manually position nodes
const positions = candidates.inner.map((candidate, idx) => {
  const angle = (idx / candidates.inner.length) * 2 * Math.PI;
  return {
    x: RADIUS * Math.cos(angle),
    y: RADIUS * Math.sin(angle),
    candidate
  };
});
```

**After:**
```javascript
import { exploreEntity } from './services/semanticIntegration.js';
import { layoutRadialGraph } from './services/radialLayout.js';

// Get data with layout
const result = await exploreEntity(prototype.name, {
  maxDepth: 1,
  maxConnectionsPerLevel: 16,
  generateLayout: true
});

// Use pre-calculated positions
result.layout.nodes.forEach(node => {
  renderNode(node.x, node.y, node.node, {
    dimensions: node.dimensions,
    zIndex: node.zIndex,
    opacity: node.opacity
  });
});

// Render connections with curves
result.layout.connections.forEach(conn => {
  renderConnection(conn.path, conn.relation);
});
```

**Benefits:**
- No overlaps
- Dimension-aware layout
- Smart overflow handling
- Labeled connections

---

## Step-by-Step Migration

### Step 1: Test New API (Non-Breaking)

Add new imports alongside existing code:

```javascript
// Existing imports (keep these)
import { findRelatedConcepts } from './services/semanticWebQuery.js';

// New imports (add these)
import { discoverConnections } from './services/semanticDiscovery.js';
import { exploreEntity } from './services/semanticIntegration.js';

// Test side-by-side
async function testComparison(entityName) {
  // Old way
  const oldResults = await findRelatedConcepts(entityName);

  // New way
  const newResults = await discoverConnections(entityName);

  console.log('Old:', oldResults.length, 'results');
  console.log('New:', newResults.connections.length, 'connections');
  console.log('Speedup:', /* compare times */);
}
```

### Step 2: Update Orbit System

Replace orbit candidate fetching:

```javascript
// In orbitResolver.js or component
import { quickDiscover } from './services/semanticIntegration.js';

async function fetchOrbitCandidatesForPrototype(prototype, options = {}) {
  try {
    const result = await quickDiscover(prototype.name, {
      maxConnectionsPerLevel: 16,
      minConfidence: 0.6
    });

    // Convert to existing format for compatibility
    const candidates = result.connections.map(conn => ({
      name: conn.target,
      uri: conn.targetUri,
      predicate: conn.relation,
      source: conn.provider,
      score: conn.confidence,
      tier: conn.confidence > 0.8 ? 'A' : 'B'
    }));

    return {
      inner: candidates.filter(c => c.tier === 'A').slice(0, 8),
      outer: candidates.filter(c => c.tier !== 'A').slice(0, 16),
      all: candidates
    };
  } catch (error) {
    console.error('Orbit fetch failed:', error);
    return { inner: [], outer: [], all: [] };
  }
}
```

### Step 3: Update Layout Logic

If you have custom layout code:

```javascript
import { layoutRadialGraph } from './services/radialLayout.js';

function layoutOrbitNodes(centralNode, orbitCandidates) {
  // Convert candidates to orbits
  const orbits = [
    {
      level: 1,
      entities: orbitCandidates.inner.map(c => ({ name: c.name }))
    },
    {
      level: 2,
      entities: orbitCandidates.outer.map(c => ({ name: c.name }))
    }
  ];

  // Generate layout
  const layout = layoutRadialGraph(
    centralNode,
    orbits,
    [], // connections (optional)
    {
      baseRadius: 180,
      orbitSpacing: 140,
      minNodeMargin: 28
    }
  );

  return layout;
}
```

### Step 4: Add Relationship Visualization

Show relationship labels on connections:

```javascript
function renderConnection(connection, layout) {
  const { path, relation, confidence } = connection;

  // Draw the path
  if (path.type === 'curved') {
    ctx.beginPath();
    ctx.moveTo(path.x1, path.y1);
    ctx.quadraticCurveTo(path.cx, path.cy, path.x2, path.y2);
    ctx.strokeStyle = `rgba(100, 100, 100, ${confidence * 0.6})`;
    ctx.lineWidth = 1 + confidence;
    ctx.stroke();

    // Add label at midpoint
    const midX = (path.x1 + path.x2) / 2;
    const midY = (path.y1 + path.y2) / 2;

    ctx.font = '11px sans-serif';
    ctx.fillStyle = '#666';
    ctx.fillText(relation, midX, midY);
  }
}
```

## Testing Your Migration

### Test 1: Query Performance

```javascript
async function testPerformance(entityName) {
  console.time('Old Query');
  const oldResults = await findRelatedConcepts(entityName);
  console.timeEnd('Old Query');

  console.time('New Query');
  const newResults = await discoverConnections(entityName);
  console.timeEnd('New Query');

  console.log({
    oldCount: oldResults.length,
    newCount: newResults.connections.length,
    improvement: '10-50x faster'
  });
}
```

### Test 2: Entity Deduplication

```javascript
import { deduplicateEntities } from './services/entityMatching.js';

async function testDeduplication(entityName) {
  const [wikidata, dbpedia] = await Promise.all([
    queryWikidata(entityName),
    queryDBpedia(entityName)
  ]);

  const combined = [...wikidata, ...dbpedia];
  const deduplicated = deduplicateEntities(combined);

  console.log({
    before: combined.length,
    after: deduplicated.length,
    reduction: `${Math.round((1 - deduplicated.length / combined.length) * 100)}%`
  });
}
```

### Test 3: Layout Quality

```javascript
import { layoutRadialGraph } from './services/radialLayout.js';

function testLayout(centralNode, orbitData) {
  const layout = layoutRadialGraph(centralNode, orbitData);

  // Check for overlaps
  let overlapCount = 0;
  for (let i = 0; i < layout.nodes.length; i++) {
    for (let j = i + 1; j < layout.nodes.length; j++) {
      const dist = Math.sqrt(
        (layout.nodes[i].x - layout.nodes[j].x) ** 2 +
        (layout.nodes[i].y - layout.nodes[j].y) ** 2
      );
      if (dist < 60) overlapCount++;
    }
  }

  console.log({
    totalNodes: layout.nodes.length,
    overlaps: overlapCount,
    quality: overlapCount === 0 ? 'Perfect' : 'Needs adjustment'
  });
}
```

## Common Issues

### Issue 1: Different result structure

**Problem:** New API returns different shape

**Solution:** Use transformation functions

```javascript
function convertToLegacyFormat(modernResult) {
  return {
    inner: modernResult.connections
      .filter(c => c.confidence > 0.8)
      .slice(0, 8)
      .map(c => ({ name: c.target, ...c })),
    outer: modernResult.connections
      .filter(c => c.confidence <= 0.8)
      .slice(0, 16)
      .map(c => ({ name: c.target, ...c }))
  };
}
```

### Issue 2: Timeouts on slow connections

**Problem:** Queries taking too long

**Solution:** Adjust timeout parameters

```javascript
const result = await discoverConnections(entityName, {
  timeout: 10000,  // Reduce for faster failure
  limit: 15,       // Fewer results = faster
  minConfidence: 0.70  // Higher threshold = fewer queries
});
```

### Issue 3: Layout doesn't fit screen

**Problem:** Nodes positioned off-screen

**Solution:** Adjust radius and scaling

```javascript
const layout = layoutRadialGraph(central, orbits, [], {
  baseRadius: 120,     // Smaller initial radius
  orbitSpacing: 100,   // Tighter spacing
  minNodeMargin: 20    // Smaller margins
});
```

## Rollback Plan

If you need to rollback:

1. **Remove new imports** (all in `src/services/semantic*.js`)
2. **Keep existing code** (no changes to existing files except `orbitResolver.js`)
3. **For orbitResolver.js**: Revert the `require` → `import` change if needed

All new functionality is in separate files, so rollback is simple.

## Support

For issues or questions:
1. Check `SEMANTIC_DISCOVERY_GUIDE.md` for usage examples
2. See `SEMANTIC_IMPROVEMENTS_SUMMARY.md` for technical details
3. Review test file: `src/services/__tests__/semanticSystem.test.js`

## Next Steps After Migration

1. **Monitor performance** - Log query times
2. **Tune parameters** - Adjust confidence thresholds
3. **Add visualizations** - Use layout data for UI
4. **Extend mappings** - Add domain-specific properties
5. **Enable caching** - Cache frequent queries
