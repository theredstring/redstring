# TTL Decomposition Tradeoff Analysis

## File Size Comparison

### Current JSON-LD Approach (Compact)
```json
{
  "@context": { "redstring": "https://redstring.io/vocab/" },
  "nodePrototypes": {
    "node1": {
      "name": "My Concept",
      "x": 100, "y": 200,
      "color": "#ff0000"
    }
  }
}
```
**Size: ~150 bytes per node**

### Full TTL Decomposition (Verbose)
```turtle
# nodes/concept-node1.ttl
@prefix redstring: <https://redstring.io/vocab/> .
@prefix schema: <http://schema.org/> .
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .

<node:node1> a redstring:Node ;
    schema:name "My Concept" ;
    redstring:xCoordinate 100 ;
    redstring:yCoordinate 200 ;
    schema:color "#ff0000" .
```
**Size: ~300 bytes per node (2x overhead from prefixes)**

### File Count Impact
- **100 nodes** = 100+ separate files
- **1000 nodes** = 1000+ separate files  
- Git becomes unwieldy, API limits hit constantly

## Parsability Assessment

### JSON-LD (Current) ✅
- **Native JavaScript parsing**: `JSON.parse()`
- **Your existing code**: Already handles this perfectly
- **RDF libraries**: jsonld library works great
- **Human readable**: Yes, reasonably so

### TTL Files 🤔
- **Requires RDF parser**: More complex
- **Your existing dependencies**: rdflib can handle it
- **Human readable**: Very readable, but verbose
- **Parsing complexity**: Higher than JSON

## Better Hybrid Approaches

### Option 1: Strategic TTL Export (Recommended)
Keep unified .redstring file + generate semantic views on demand:

```javascript
// Keep current storage, add TTL views
export const generateSemanticViews = async (storeState) => {
  // Main storage: universe.redstring (as-is)
  await saveRedstringFile(storeState);
  
  // Semantic views: Fewer, larger TTL files
  await saveConceptsTTL(storeState.nodePrototypes);  // All nodes in one file
  await saveRelationshipsTTL(storeState.edges);      // All edges in one file
  await saveOntologyTTL(storeState);                 // Schema/types
};
```

### Option 2: Chunked TTL Files
Group related concepts instead of individual files:

```
semantic/
├── concepts-core.ttl      (fundamental concepts)
├── concepts-project-a.ttl (project-specific nodes)  
├── relationships.ttl      (all edges)
└── spatial-layout.ttl     (positioning data)
```

### Option 3: JSON-LD + SPARQL Endpoint
Your current JSON-LD IS already semantic web compliant:

```javascript
// Your current format can be queried with SPARQL!
import jsonld from 'jsonld';

const expandedGraph = await jsonld.expand(redstringData);
// Now you can run SPARQL queries on it
```

## Realistic Recommendations

### 🎯 Pragmatic Approach (Best of Both Worlds)

1. **Keep your current .redstring format** - it's already excellent
2. **Add semantic export capabilities** - generate TTL on demand
3. **Use chunked TTL files** - not per-node, but per-domain
4. **Leverage JSON-LD capabilities** - it's already RDF-compliant

### Implementation Strategy
```javascript
// Enhanced git storage with semantic views
export const saveWithSemanticViews = async (storeState) => {
  // Primary storage (fast, compact, complete)
  await saveRedstringFile(storeState);
  
  // Semantic views (for external tools, fewer files)
  if (shouldGenerateSemanticViews()) {
    await saveAllConceptsTTL(storeState.nodePrototypes);
    await saveAllRelationshipsTTL(storeState.edges);
    await saveOntologyTTL(getAbstractionChains(storeState));
  }
};
```

## Benefits of Hybrid Approach

✅ **Fast operations** - Primary format stays efficient  
✅ **Semantic web compliance** - TTL views available when needed  
✅ **Git-friendly** - 3-5 files instead of 1000s  
✅ **API rate limit friendly** - Manageable number of writes  
✅ **External tool integration** - TTL files available for RDF tools  
✅ **Backwards compatible** - Current .redstring format preserved  

## Verdict

**Don't decompose per-node**. Instead:
- Keep your excellent unified .redstring format
- Add chunked semantic TTL views (3-5 files max)
- Generate TTL on-demand for semantic web integration
- Get the benefits without the file explosion nightmare

Your current JSON-LD format is already semantically rich and RDF-compliant. The value is in **strategic TTL exports**, not full decomposition.