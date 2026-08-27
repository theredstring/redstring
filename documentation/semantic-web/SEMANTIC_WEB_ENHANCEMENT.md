# Semantic Web Enhancement for External Site Integration

## Current Status ✅

Your JSON-LD context already includes:
- **RDF/RDFS**: Basic semantic web foundations
- **Schema.org**: Universal web vocabularies  
- **Dublin Core**: Metadata standards
- **FOAF**: Identity linking

## Missing for External Site Integration 🔄

### 1. OWL (Web Ontology Language)
Essential for linking to external entities:

```javascript
// Add to REDSTRING_CONTEXT
"owl": "http://www.w3.org/2002/07/owl#",
"sameAs": "owl:sameAs",                    // "This concept is the same as..."
"equivalentClass": "owl:equivalentClass",  // "This type equals that type"
"differentFrom": "owl:differentFrom",      // "This is NOT the same as..."
```

### 2. External Knowledge Base Links
```javascript
// Wikidata integration
"wdt": "http://www.wikidata.org/prop/direct/",
"wd": "http://www.wikidata.org/entity/",

// DBpedia integration  
"dbr": "http://dbpedia.org/resource/",
"dbo": "http://dbpedia.org/ontology/",

// OpenCyc
"cyc": "http://sw.opencyc.org/concept/",
```

### 3. Social/Web Platform Vocabularies
```javascript
// Social networks
"sioc": "http://rdfs.org/sioc/ns#",
"as": "https://www.w3.org/ns/activitystreams#",

// Web standards
"ldp": "http://www.w3.org/ns/ldp#",
"hydra": "http://www.w3.org/ns/hydra/core#",
```

## Enhanced Redstring Context - The Semantic Web Rosetta Stone

**Redstring creates a unified semantic web format where every concept is a Rosetta Stone for multiple vocabularies.**

```javascript
export const REDSTRING_CONTEXT = {
  "@version": 1.1,
  "@vocab": "https://redstring.io/vocab/",
  
  // ==========================================
  // REDSTRING EXTENSIONS (New Standard)
  // ==========================================
  "redstring": "https://redstring.io/vocab/",
  "ThingPrototype": "redstring:ThingPrototype",    // Prototype concepts (semantic classes)
  "ThingInstance": "redstring:ThingInstance",      // Instance placements (spatial objects)
  "partOf": "redstring:partOf",                    // Spatial/contextual containment
  "preferredDefinition": "redstring:preferredDefinition", // Context-aware definitions
  "definitionGraphIds": "redstring:definitionGraphIds",   // Multiple definition graphs
  "abstractionChains": "redstring:abstractionChains",     // User-defined hierarchies
  "spatialContext": "redstring:spatialContext",           // Position, scale, visual
  "color": "redstring:color",                              // Visual semantics
  
  // ==========================================
  // RDF SCHEMA FOUNDATIONS (W3C Standard)
  // ==========================================
  "rdfs": "http://www.w3.org/2000/01/rdf-schema#",
  "rdf": "http://www.w3.org/1999/02/22-rdf-syntax-ns#",
  
  // Core RDF Schema classes
  "rdfs:Class": "rdfs:Class",                      // Class definitions
  "rdfs:Resource": "rdfs:Resource",                // All RDF resources
  "rdfs:Literal": "rdfs:Literal",                 // String/number values
  "rdf:Property": "rdf:Property",                  // Relationship definitions
  
  // Core RDF Schema properties
  "rdf:type": "rdf:type",                          // Instance belongs to class
  "rdfs:subClassOf": "rdfs:subClassOf",            // Class hierarchy (Type → Prototype)
  "rdfs:subPropertyOf": "rdfs:subPropertyOf",      // Property hierarchy
  "rdfs:domain": "rdfs:domain",                    // Valid source classes
  "rdfs:range": "rdfs:range",                      // Valid target classes
  
  // Human-readable metadata
  "rdfs:label": "rdfs:label",                      // Display name
  "rdfs:comment": "rdfs:comment",                  // Description text
  "rdfs:seeAlso": "rdfs:seeAlso",                  // Related resources
  "rdfs:isDefinedBy": "rdfs:isDefinedBy",          // Definition source
  
  // ==========================================
  // OWL SEMANTIC MAPPINGS (Rosetta Stone)
  // ==========================================
  "owl": "http://www.w3.org/2002/07/owl#",
  
  // The Rosetta Stone mechanisms
  "sameAs": "owl:sameAs",                          // "This exact thing = that exact thing"
  "equivalentClass": "owl:equivalentClass",        // "This class = that class concept"
  "differentFrom": "owl:differentFrom",            // "This ≠ that" (disambiguation)
  
  // ==========================================
  // EXTERNAL KNOWLEDGE BASES (Global Vocab)
  // ==========================================
  
  // Wikidata (world's largest knowledge base)
  "wd": "http://www.wikidata.org/entity/",         // Wikidata entities (wd:Q5 = human)
  "wdt": "http://www.wikidata.org/prop/direct/",   // Wikidata properties
  
  // DBpedia (Wikipedia as RDF)
  "dbr": "http://dbpedia.org/resource/",           // DBpedia resources
  "dbo": "http://dbpedia.org/ontology/",           // DBpedia ontology
  
  // Schema.org (structured web data)
  "schema": "http://schema.org/",
  "Person": "schema:Person",
  "Organization": "schema:Organization", 
  "Thing": "schema:Thing",
  "CreativeWork": "schema:CreativeWork",
  
  // Academic & Research
  "doi": "https://doi.org/",                       // Digital Object Identifiers
  "orcid": "https://orcid.org/",                   // Researcher IDs
  "pubmed": "https://pubmed.ncbi.nlm.nih.gov/",   // Medical literature
  "arxiv": "https://arxiv.org/abs/",               // Preprint archive
  
  // FOAF (Friend of a Friend)
  "foaf": "http://xmlns.com/foaf/0.1/",
  "foaf:Person": "foaf:Person",
  "foaf:Organization": "foaf:Organization",
  
  // Dublin Core (metadata standards)
  "dc": "http://purl.org/dc/terms/",
  "created": "dc:created",
  "modified": "dc:modified",
  "creator": "dc:creator",
  "description": "dc:description"
};
```

## The Three-Layer Redstring Architecture

### Layer 1: Types (Superclasses) - Global Semantic Categories
```javascript
// Types are hardcoded superclasses that provide rdfs:subClassOf relationships
const REDSTRING_TYPES = {
  "Person": {
    "@id": "schema:Person",
    "rdfs:label": "Person",
    "rdfs:comment": "A human being",
    // Types create automatic subClassOf relationships
  },
  "Organization": {
    "@id": "schema:Organization", 
    "rdfs:label": "Organization",
    "rdfs:comment": "An organized body of people"
  }
};
```

### Layer 2: Prototypes (Classes) - Local Semantic Concepts  
```javascript
// Prototypes are rdfs:Class + Redstring extensions - the Rosetta Stone layer
{
  "@type": ["redstring:ThingPrototype", "rdfs:Class"],
  "@id": "prototype:barack-obama",
  
  // RDF Schema compliance
  "rdfs:label": "Barack Obama",
  "rdfs:comment": "44th President of the United States",
  "rdfs:subClassOf": { "@id": "schema:Person" },  // Links to Type layer
  
  // OWL Rosetta Stone mappings - THIS IS THE MAGIC!
  "sameAs": [
    "wd:Q76",                                    // Wikidata: Barack Obama
    "dbr:Barack_Obama",                          // DBpedia: Barack Obama  
    "https://en.wikipedia.org/wiki/Barack_Obama" // Wikipedia page
  ],
  "equivalentClass": [
    "foaf:Person",                               // FOAF vocabulary
    "dbo:President"                              // DBpedia ontology
  ],
  
  // Redstring extensions (what makes it more than RDF)
  "redstring:color": "#blue",
  "redstring:definitionGraphIds": [
    "barack-personal-life",                      // Personal perspective
    "barack-political-career",                  // Political perspective
    "barack-cultural-impact"                    // Cultural perspective
  ],
  "redstring:abstractionChains": {
    "specificity": ["person", "politician", "president", "us-president"],
    "domain": ["politics", "american-politics", "democratic-party"]
  },
  "redstring:spatialContext": {
    "defaultScale": 1.2,
    "defaultPosition": { "x": 0, "y": 0 }
  }
}
```

### Layer 3: Instances (Objects) - Spatial Manifestations
```javascript
// Instances are spatial placements of prototypes in specific graphs
{
  "@type": "redstring:ThingInstance",
  "@id": "instance:barack-in-presidency-graph",
  
  // RDF Schema relationship - instance belongs to prototype class
  "rdf:type": { "@id": "prototype:barack-obama" },
  
  // Redstring spatial containment - instance exists in specific graph
  "redstring:partOf": { "@id": "graph:us-presidency-timeline" },
  
  // Context-aware definition selection
  "redstring:preferredDefinition": "barack-political-career",
  
  // Spatial positioning
  "redstring:spatialContext": {
    "x": 500,
    "y": 300, 
    "scale": 1.0
  }
}
```

## The Rosetta Stone Mechanism Explained

**Every Redstring prototype is a translation hub between vocabularies:**

```javascript
// Local concept with global reach
{
  "@id": "prototype:climate-policy",
  "rdfs:label": "Climate Policy",               // Human readable
  
  // Rosetta Stone translations
  "sameAs": [
    "dbr:Climate_change_policy",                // Wikipedia/DBpedia
    "wd:Q7942",                                 // Wikidata  
    "https://en.wikipedia.org/wiki/Climate_change_policy"
  ],
  "equivalentClass": [
    "schema:GovernmentPolicy",                  // Schema.org category
    "dbo:Policy",                               // DBpedia ontology
    "foaf:Document"                             // FOAF perspective
  ],
  
  // When someone searches for "environmental policy" across semantic web:
  // → They find this concept through multiple pathways
  // → Can understand it in their preferred vocabulary
  // → Can link to it from their own semantic systems
}
```

## Separated Storage Architecture

```javascript
{
  "@context": REDSTRING_CONTEXT,
  "@type": "redstring:CognitiveSpace",
  "format": "redstring-v2.0.0",
  
  // ========================================
  // PROTOTYPE SPACE (Semantic Layer)
  // ========================================
  "prototypeSpace": {
    // All concept definitions (the semantic classes)
    "nodePrototypes": {
      "barack-obama": { /* prototype definition */ },
      "climate-policy": { /* prototype definition */ }
    },
    
    // Type hierarchy (superclass relationships)
    "typeHierarchy": {
      "Person": { "@id": "schema:Person" },
      "Policy": { "@id": "schema:Policy" }
    },
    
    // Prototype-level relationships (semantic edges)
    "semanticEdges": {
      "barack-implements-climate": {
        "subject": { "@id": "prototype:barack-obama" },
        "predicate": { "@id": "prototype:implements" },
        "object": { "@id": "prototype:climate-policy" }
      }
    }
  },
  
  // ========================================
  // SPATIAL GRAPHS (Visual Layer)  
  // ========================================
  "spatialGraphs": {
    "us-presidency": {
      "instances": {
        "barack-instance": {
          "rdf:type": { "@id": "prototype:barack-obama" },
          "redstring:partOf": { "@id": "graph:us-presidency" },
          "redstring:preferredDefinition": "barack-political-career"
        }
      },
      "spatialConnections": {
        "visual-connection-1": {
          "sourceInstanceId": "barack-instance",
          "destinationInstanceId": "policy-instance",
          "representsSemanticEdge": "barack-implements-climate"
        }
      }
    }
  }
}
## Native Triplet Support

**Redstring stores semantic relationships as explicit RDF triplets while maintaining visual connections:**

```javascript
// Edge with native triplet support
{
  "id": "connection-123",
  "@type": "redstring:SemanticConnection",
  
  // Native RDF triplets (semantic meaning)
  "triplets": [
    {
      "subject": { "@id": "prototype:barack-obama" },
      "predicate": { "@id": "prototype:implements" },
      "object": { "@id": "prototype:climate-policy" }
    }
    // Future: multiple triplets per edge for complex relationships
  ],
  
  // Visual connection data (spatial representation)
  "sourceInstanceId": "barack-instance",
  "destinationInstanceId": "policy-instance",
  "redstring:spatialContext": {
    "path": "curved",
    "color": "#green",
    "thickness": 2
  },
  
  // User interaction - click connection to see triplet context
  "redstring:displayMode": "triplet-aware"
}
```

**Bidirectional connections become two triplets:**
```javascript
// Non-directional edge → 2 symmetric triplets
{
  "triplets": [
    {
      "subject": { "@id": "prototype:climate-policy" },
      "predicate": { "@id": "prototype:relates-to" },
      "object": { "@id": "prototype:economic-policy" }
    },
    {
      "subject": { "@id": "prototype:economic-policy" },
      "predicate": { "@id": "prototype:relates-to" },
      "object": { "@id": "prototype:climate-policy" }
    }
  ]
}
```

## Panel.jsx Semantic Web Integration

**Four new sections in the right panel for comprehensive semantic web linking:**

### Section 1: Class Mappings (Type System Integration)
```javascript
const ClassMappingsSection = ({ node, onUpdate }) => (
  <section className="semantic-mappings">
    <h3>Class Mappings</h3>
    
    {/* Automatic Type → subClassOf */}
    <div className="type-mapping">
      <label>Is a:</label>
      <TypeSelector 
        value={node.type}
        onChange={(type) => {
          // Automatically creates rdfs:subClassOf relationship
          updateSemanticProperty(node, 'rdfs:subClassOf', { '@id': type.semanticId })
        }}
      />
    </div>
    
    {/* Equivalent Classes */}
    <div className="equivalent-classes">
      <label>Equivalent Classes:</label>
      <ClassSelector
        vocabulary="schema.org"
        onSelect={(classId) => addEquivalentClass(node, classId)}
      />
      <ClassSelector  
        vocabulary="FOAF"
        onSelect={(classId) => addEquivalentClass(node, classId)}
      />
      
      {/* Display existing mappings */}
      {node.equivalentClass?.map(cls => (
        <ClassMappingCard key={cls['@id']} classId={cls['@id']} onRemove={removeEquivalentClass} />
      ))}
    </div>
  </section>
);
```

### Section 2: External Entities (Rosetta Stone Links)
```javascript
const ExternalEntitiesSection = ({ node, onUpdate }) => (
  <section className="external-entities">
    <h3>External Entities (sameAs)</h3>
    
    {/* Wikidata Search */}
    <WikidataEntitySearch 
      conceptName={node.name}
      onSelect={(entityId) => addSameAs(node, `wd:${entityId}`)}
    />
    
    {/* DBpedia Search */}
    <DBpediaResourceSearch
      conceptName={node.name} 
      onSelect={(resourceId) => addSameAs(node, `dbr:${resourceId}`)}
    />
    
    {/* Manual URL Entry */}
    <URLInput
      placeholder="Custom semantic web URI"
      onAdd={(uri) => addSameAs(node, uri)}
    />
    
    {/* Display existing sameAs links */}
    {node.sameAs?.map(uri => (
      <EntityLinkCard key={uri} uri={uri} onRemove={removeSameAs} />
    ))}
  </section>
);
```

### Section 3: Academic References 
```javascript
const AcademicReferencesSection = ({ node, onUpdate }) => (
  <section className="academic-references">
    <h3>Academic References</h3>
    
    <DOIInput onAdd={(doi) => addReference(node, `doi:${doi}`)} />
    <ORCIDInput onAdd={(orcid) => addReference(node, `orcid:${orcid}`)} />
    <ArXivInput onAdd={(arxiv) => addReference(node, `arxiv:${arxiv}`)} />
    <PubMedInput onAdd={(pmid) => addReference(node, `pubmed:${pmid}`)} />
    
    {/* Display existing references */}
    {node.academicReferences?.map(ref => (
      <AcademicReferenceCard key={ref} reference={ref} onRemove={removeReference} />
    ))}
  </section>
);
```

### Section 4: Web Resources
```javascript
const WebResourcesSection = ({ node, onUpdate }) => (
  <section className="web-resources">
    <h3>Web Resources</h3>
    
    <WikipediaSearch onSelect={(url) => addWebResource(node, url)} />
    <GenericURLInput onAdd={(url) => addWebResource(node, url)} />
    <SocialMediaInput onAdd={(profile) => addWebResource(node, profile)} />
    
    {/* Display existing web resources */}
    {node.webResources?.map(resource => (
      <WebResourceCard key={resource} resource={resource} onRemove={removeWebResource} />
    ))}
  </section>
);
```

## Implementation Roadmap

### 🎯 Sprint 1: RDF Schema Foundations
- [ ] **Update REDSTRING_CONTEXT** with comprehensive vocabulary
- [ ] **Prototype export enhancement**: `redstring:ThingPrototype` + `rdfs:Class`
- [ ] **Instance export enhancement**: `rdf:type` relationships
- [ ] **Type → subClassOf automation**: Panel Type selection creates semantic hierarchy
- [ ] **Bidirectional edges**: Export as 2 triplets
- [ ] **Format consistency tests**: Ensure round-trip fidelity

### 🎯 Sprint 2: Separated Storage Architecture
- [ ] **Prototype space separation**: Semantic layer distinct from spatial layer
- [ ] **Enhanced export structure**: `prototypeSpace` + `spatialGraphs`
- [ ] **Import/export functions**: Handle new separated structure
- [ ] **Git storage updates**: Support separated format
- [ ] **Backwards compatibility**: Import old formats correctly

### 🎯 Sprint 3: Panel Semantic Sections
- [ ] **Class Mappings section**: Type integration + equivalent classes
- [ ] **External Entities section**: Wikidata/DBpedia search + sameAs links
- [ ] **Academic References section**: DOI/ORCID/arXiv inputs
- [ ] **Web Resources section**: Wikipedia/URL management

### 🎯 Sprint 4: Native Triplet Support
- [ ] **Triplet array in edges**: Explicit RDF statements
- [ ] **Click connection → triplet context**: Visual triplet display
- [ ] **Multiple triplets per edge**: Complex relationship support
- [ ] **Triplet validation**: Ensure semantic consistency

### 🎯 Sprint 5: Advanced Features
- [ ] **AbstractionCarousel integration**: Chain → subClassOf mapping
- [ ] **Cross-domain linking**: Git-native protocol semantic discovery
- [ ] **Validation system**: RDF Schema compliance checking
- [ ] **Export formats**: Native .redstring + pure RDF/Turtle options

## External Site Integration Capabilities

### 1. Wikidata Integration
```javascript
// Fetch and link Wikidata entities
const linkToWikidata = async (conceptName) => {
  const wikidataEntity = await searchWikidata(conceptName);
  return {
    "@id": `wd:${wikidataEntity.id}`,
    "label": wikidataEntity.label,
    "description": wikidataEntity.description
  };
};
```

### 2. Schema.org Structured Data
Your nodes can generate valid schema.org structured data:
```json
{
  "@context": "https://schema.org",
  "@type": "Thing",
  "name": "Artificial Intelligence",
  "description": "Intelligence demonstrated by machines",
  "sameAs": "https://en.wikipedia.org/wiki/Artificial_intelligence"
}
```

### 3. Linked Data Platform (LDP) Integration
```javascript
// Your graphs can be LDP containers
const createLDPContainer = (graphData) => ({
  "@type": ["redstring:Graph", "ldp:Container"],
  "ldp:contains": graphData.instances.map(instance => ({ "@id": instance.id }))
});
```

## RDF Schema Integration Capabilities

### 1. Proper Class Hierarchy with rdfs:subClassOf
```javascript
// Your AbstractionCarousel now maps to standard RDF
const createRDFClassHierarchy = (abstractionChain) => {
  const hierarchy = [];
  for (let i = 0; i < abstractionChain.length - 1; i++) {
    hierarchy.push({
      "@type": "rdfs:Class",
      "@id": `prototype:${abstractionChain[i]}`,
      "rdfs:subClassOf": { "@id": `prototype:${abstractionChain[i + 1]}` }
    });
  }
  return hierarchy;
};
```

### 2. Property Definitions with Domain and Range
```javascript
// Define properties with proper RDF constraints
const createRDFProperty = (propertyName, domainClass, rangeClass) => ({
  "@type": "rdf:Property",
  "@id": `property:${propertyName}`,
  "rdfs:domain": { "@id": domainClass },
  "rdfs:range": { "@id": rangeClass },
  "rdfs:label": propertyName,
  "rdfs:comment": `Property connecting ${domainClass} to ${rangeClass}`
});
```

### 3. Instance Classification with rdf:type
```javascript
// Proper RDF instance typing - instance belongs to prototype class
const createRDFInstance = (instance, prototypeId) => ({
  "@type": "redstring:Instance",
  "@id": `instance:${instance.id}`,
  
  // RDF Schema: instance is of type prototype
  "rdf:type": { "@id": `prototype:${prototypeId}` },
  "rdfs:label": instance.name || `Instance ${instance.id}`,
  "rdfs:comment": instance.description || "Redstring instance",
  
  // Redstring: instance is contained within a specific graph
  "redstring:partOf": { "@id": `graph:${instance.graphId}` }
});
```

### 4. Graph Containment with redstring:partOf
```javascript
// Redstring-specific: instance is contained within graph context
const createGraphContainment = (instance, graphId) => ({
  "@id": `instance:${instance.id}`,
  
  // Instance belongs to prototype class (type relationship)
  "rdf:type": { "@id": `prototype:${instance.prototypeId}` },
  
  // Instance is contained within graph (spatial/contextual relationship)
  "redstring:partOf": { "@id": `graph:${graphId}` },
  
  // Spatial positioning within the graph
  "redstring:spatialContext": {
    "x": instance.x,
    "y": instance.y,
    "scale": instance.scale
  }
});
```

### 5. External Knowledge Base Abstraction Bush Scaffolding
```javascript
// Start with ossified single chains (individual branches) to build the full abstraction bush
const buildAbstractionBushScaffold = async (conceptName) => {
  // Query multiple knowledge bases for different abstraction perspectives
  const [wikidataChains, dbpediaChains, schemaOrgChains] = await Promise.all([
    fetchWikidataAbstractionChains(conceptName),
    fetchDBpediaAbstractionChains(conceptName),
    fetchSchemaOrgAbstractionChains(conceptName)
  ]);
  
  // Each knowledge base provides different abstraction angles
  // These are individual branches that can be woven into the full bush
  return {
    // Example: "The Beatles" abstraction bush - multiple interconnected branches
    "musical_genre_branch": [
      { "@id": "wd:Q5", "rdfs:label": "Thing" },
      { "@id": "wd:Q115", "rdfs:label": "Band" },
      { "@id": "wd:Q11399", "rdfs:label": "Rock Band" },
      { "@id": "wd:Q123456", "rdfs:label": "60s Rock Band" },
      { "@id": "wd:Q789012", "rdfs:label": "60s Psychedelic Rock Band" },
      { "@id": "wd:Q345678", "rdfs:label": "The Beatles" }
    ],
    
    "record_label_branch": [
      { "@id": "wd:Q5", "rdfs:label": "Thing" },
      { "@id": "wd:Q234", "rdfs:label": "Live Act" },
      { "@id": "wd:Q567", "rdfs:label": "Musical Act" },
      { "@id": "wd:Q890", "rdfs:label": "Musical Act Signed to Capitol Records" },
      { "@id": "wd:Q345678", "rdfs:label": "The Beatles" }
    ],
    
    "cultural_movement_branch": [
      { "@id": "wd:Q5", "rdfs:label": "Thing" },
      { "@id": "wd:Q111", "rdfs:label": "Cultural Phenomenon" },
      { "@id": "wd:Q222", "rdfs:label": "British Invasion" },
      { "@id": "wd:Q333", "rdfs:label": "Beatlemania" },
      { "@id": "wd:Q345678", "rdfs:label": "The Beatles" }
    ],
    
    "geographic_branch": [
      { "@id": "wd:Q5", "rdfs:label": "Thing" },
      { "@id": "wd:Q444", "rdfs:label": "Geographic Entity" },
      { "@id": "wd:Q555", "rdfs:label": "City" },
      { "@id": "wd:Q666", "rdfs:label": "Liverpool" },
      { "@id": "wd:Q777", "rdfs:label": "Liverpool Music Scene" },
      { "@id": "wd:Q345678", "rdfs:label": "The Beatles" }
    ]
  };
};

// The abstraction bush emerges from weaving these individual branches
// Each branch is a single ossified chain that can be explored independently
// The full bush structure emerges from the interconnections between branches
```

### 4. Rich Metadata with RDF Schema Properties
```javascript
// Enhanced node with full RDF Schema compliance
const createRDFCompliantNode = (nodeData) => ({
  "@type": ["redstring:Node", "rdfs:Class", "schema:Thing"],
  "@id": `prototype:${nodeData.id}`,
  
  // RDF Schema standard properties
  "rdfs:label": nodeData.name,
  "rdfs:comment": nodeData.description,
  "rdfs:seeAlso": nodeData.externalLinks || [],
  "rdfs:isDefinedBy": { "@id": "https://redstring.io" },
  
  // Redstring-specific properties (preserved)
  "redstring:color": nodeData.color,
  "redstring:spatialContext": {
    "x": nodeData.x || 0,
    "y": nodeData.y || 0,
    "scale": nodeData.scale || 1.0
  }
});
```

## Benefits for External Integration

✅ **Wikipedia/Wikidata**: Direct linking to world's knowledge  
✅ **Search engines**: Rich snippets via schema.org  
✅ **Social platforms**: Open Graph/Twitter Card integration  
✅ **Academic**: ORCID, DOI, citation networks  
✅ **Enterprise**: Industry ontologies (FIBO, etc.)  
✅ **Government**: Data.gov, EU Open Data  

## Benefits of RDF Schema Integration

✅ **W3C Standard Compliance**: Full semantic web specification adherence  
✅ **Interoperability**: Works with any RDF-compliant system  
✅ **Reasoning Support**: Enables automated inference and validation  
✅ **Property Constraints**: Domain/range validation for data integrity  
✅ **Class Hierarchies**: Standard inheritance patterns for ontologies  
✅ **Linked Data**: Seamless integration with existing RDF datasets  
✅ **Tool Ecosystem**: Compatible with RDF editors, validators, and reasoners  

## Redstring's Unique Prototype-Instance Model

### 1. **Prototypes as Classes** (rdfs:Class)
- **Concept Definition**: Each prototype defines a reusable concept type
- **RDF Mapping**: Maps to `rdfs:Class` for standard ontological classes
- **Definition Graphs**: Can contain entire sub-graphs for concept elaboration
- **Reusability**: Same prototype can be instantiated across multiple graphs

### 2. **Instances as Individuals** (rdf:type)
- **Type Relationship**: Instance belongs to prototype via `rdf:type`
- **Graph Placement**: Instance is placed within specific graph context
- **Spatial Context**: Maintains position, scale, and visual properties
- **Identity Preservation**: Same instance can appear in multiple graphs

### 3. **Dual Relationship Model**
```javascript
// Example: Car instance in Mechanical Systems graph
{
  "@id": "instance:car-001",
  
  // Type relationship: instance is of type Car
  "rdf:type": { "@id": "prototype:car" },
  
  // Containment relationship: instance is in Mechanical graph
  "redstring:partOf": { "@id": "graph:mechanical" }
}
```

### 4. **Advantages Over Traditional RDF**
✅ **Flexible Placement**: Instances can move between graphs while maintaining type  
✅ **Spatial Reasoning**: Position and scale as semantic properties  
✅ **Recursive Definitions**: Prototypes can contain definition graphs  
✅ **Context Awareness**: Same concept can have different meanings in different graphs  
✅ **Human-Centered**: Preserves how people actually think about concepts  
✅ **Multi-Perspective Abstraction**: Multiple abstraction chains from different angles  

This model makes Redstring uniquely valuable for semantic web contribution by combining standard RDF Schema compliance with human cognitive patterns!

## Abstraction Bush Scaffolding: Beyond Tree Structures

### **The Challenge: Abstraction is a Bush, Not a Tree**
Traditional ontological thinking assumes hierarchical tree structures, but human cognition creates **abstraction bushes** - complex networks where concepts connect in multiple directions, not just up and down.

### **The Solution: Ossified Single Chains**
Instead of trying to map the entire bush at once, Redstring starts with **ossified single chains** - individual branches that can be explored independently:

```javascript
// Each branch is a complete, self-contained abstraction chain
const musicalGenreBranch = [
  "Thing → Band → Rock Band → 60s Rock Band → 60s Psychedelic Rock Band → The Beatles"
];

const recordLabelBranch = [
  "Thing → Live Act → Musical Act → Musical Act Signed to Capitol Records → The Beatles"
];

const culturalMovementBranch = [
  "Thing → Cultural Phenomenon → British Invasion → Beatlemania → The Beatles"
];
```

### **Building the Full Bush Scaffold**
1. **Start with Single Branches**: Each external knowledge base provides ossified chains
2. **Identify Intersection Points**: Where branches share concepts (like "Thing" or "The Beatles")
3. **Weave the Bush**: Connect branches through their shared nodes
4. **Discover New Connections**: The bush structure reveals unexpected relationships

### **Why This Approach Works**
✅ **Manageable Complexity**: Start simple with single chains, build complexity gradually  
✅ **Human Cognition**: Matches how people actually think - following one thread at a time  
✅ **Discoverable Structure**: The full bush emerges from exploring individual branches  
✅ **Flexible Growth**: New branches can be added without restructuring existing ones  
✅ **Cognitive Scaffolding**: Each branch provides a stable path through the concept space  

### **Example: The Beatles Abstraction Bush**
```
                     Thing
                   /  |   \
                  /   |    \
                 /    |     \
            Band   Live Act  Cultural Phenomenon
               |      |           |
       Rock Band  Musical Act  British Invasion
               |      |           |
        60s Rock Band |        British Invasion Boy Bands
               |      |           |
    60s Psychedelic   |           |
         Rock Band    |           |
               |      |           |
               |  Musical Act     |
               |  Signed to       |
               |  Capitol Records |
               |      |           |
               |      |           |
               |      |           |
               +------+-----------+
                      |
                  The Beatles
```

This bush structure emerges naturally from weaving together the individual ossified chains, creating a rich, interconnected cognitive scaffold that mirrors how humans actually think about complex concepts!

## Implementation Strategy

### Phase 1: Enhanced Context
```javascript
// Update redstringFormat.js
export const getSemanticContext = (level = 'basic') => {
  switch(level) {
    case 'rdf': return WEB_INTEGRATED_CONTEXT;  // Full RDF Schema
    case 'web': return WEB_INTEGRATED_CONTEXT;  // Web vocabularies
    case 'basic': return REDSTRING_CONTEXT;     // Basic Redstring
    default: return REDSTRING_CONTEXT;
  }
};
```

### Phase 2: RDF Schema Validation
```javascript
// Add RDF Schema validation
const validateRDFSchema = (nodeData) => {
  const errors = [];
  
  // Check required RDF Schema properties
  if (!nodeData['rdfs:label']) {
    errors.push("Missing rdfs:label (human-readable name)");
  }
  
  // Validate property domains and ranges
  if (nodeData['rdfs:domain'] && !isValidClass(nodeData['rdfs:domain'])) {
    errors.push("Invalid rdfs:domain - must reference a valid class");
  }
  
  return errors;
};
```

### Phase 3: External Linking UI
```javascript
// Add to node editing interface
const ExternalLinksPanel = ({ node, onUpdate }) => (
  <div>
    <WikidataLink node={node} onLink={linkWikidata} />
    <SchemaOrgType node={node} onTypeChange={updateType} />
    <URLReferences node={node} onAddURL={addExternalURL} />
  </div>
);
```

### Phase 4: RDF Schema Editor
```javascript
// New RDF Schema editing interface
const RDFSchemaEditor = ({ node, onUpdate }) => (
  <div className="rdf-schema-editor">
    
    {/* Class Hierarchy */}
    <section>
      <h3>Class Hierarchy (rdfs:subClassOf)</h3>
      <ClassHierarchyEditor 
        node={node}
        onHierarchyChange={updateClassHierarchy}
      />
    </section>
    
    {/* Property Definitions */}
    <section>
      <h3>Property Constraints</h3>
      <PropertyDomainRangeEditor 
        node={node}
        onDomainChange={updatePropertyDomain}
        onRangeChange={updatePropertyRange}
      />
    </section>
    
    {/* RDF Schema Metadata */}
    <section>
      <h3>RDF Schema Metadata</h3>
      <RDFMetadataEditor 
        node={node}
        onLabelChange={updateRDFLabel}
        onCommentChange={updateRDFComment}
        onSeeAlsoChange={updateSeeAlso}
      />
    </section>
    
  </div>
);
```

## Verdict: You Need RDF Schema + OWL + External Vocabularies

Your current JSON-LD is **partially** semantic web compliant, but for true external site integration you need:

1. **RDF Schema foundations** for W3C standard compliance (`rdfs:Class`, `rdf:type`, `rdfs:subClassOf`)
2. **OWL vocabularies** for entity linking (`owl:sameAs`)
3. **External KB contexts** (Wikidata, DBpedia)  
4. **Enhanced schema.org** usage
5. **Social/web platform** vocabularies

This would make Redstring a true **semantic web citizen** that can interface with the existing knowledge networks!

## RDF Schema as the Foundation

The RDF Schema elements from the W3C specification provide the essential building blocks:

- **`rdfs:Class`** - Your prototypes become proper ontological classes
- **`rdf:type`** - Your instances get standard typing
- **`rdfs:subClassOf`** - Your AbstractionCarousel maps to standard inheritance
- **`rdfs:domain`/`rdfs:range`** - Property constraints for data validation
- **`rdfs:label`/`rdfs:comment`** - Human-readable metadata standards

With these foundations, Redstring becomes not just a semantic web participant, but a **semantic web contributor** that other systems can understand, validate, and reason about!