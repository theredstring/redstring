# Semantic Web Editing Interface Design

## Core Philosophy: Bottom-Up Semantic Web

Redstring's approach is unique - building from human cognitive patterns toward semantic web standards, not forcing top-down ontological constraints. This preserves the "cognitive scaffold" nature while adding semantic web capabilities.

## Architecture: Three-Layer Semantic Foundation

### 1. Types (Superclasses)
**RDF Schema Level**: `rdfs:Class`  
**Redstring Role**: Abstract conceptual categories that provide broad classification  
**Implementation**: TypeList in Panel.jsx provides UI for managing semantic types

```javascript
// Types create rdfs:subClassOf relationships automatically
const semanticTypes = {
  "physical-entity": {
    "@type": ["rdfs:Class", "redstring:SemanticType"],
    "@id": "type:physical-entity", 
    "rdfs:label": "Physical Entity",
    "rdfs:comment": "Concrete objects with physical presence"
  },
  "abstract-concept": {
    "@type": ["rdfs:Class", "redstring:SemanticType"],
    "@id": "type:abstract-concept",
    "rdfs:label": "Abstract Concept", 
    "rdfs:comment": "Ideas, principles, or mental constructs"
  }
};
```

### 2. Prototypes (Semantic Classes)
**RDF Schema Level**: `rdfs:Class` with `rdfs:subClassOf` relationships  
**Redstring Role**: Specific conceptual templates with rich metadata  
**Implementation**: Node prototypes enhanced with semantic properties

```javascript
// Prototypes are classes that automatically inherit from Types
const prototypeToSemanticClass = (prototype) => ({
  "@type": ["rdfs:Class", "redstring:Node", "schema:Thing"],
  "@id": `prototype:${prototype.id}`,
  
  // Automatic Type inheritance - creates rdfs:subClassOf
  "rdfs:subClassOf": prototype.typeNodeId ? 
    { "@id": `type:${prototype.typeNodeId}` } : null,
  
  // RDF Schema standard properties
  "rdfs:label": prototype.name,
  "rdfs:comment": prototype.description,
  "rdfs:seeAlso": prototype.externalLinks || [],
  "rdfs:isDefinedBy": { "@id": "https://redstring.io" },
  
  // Rosetta Stone mechanism - core semantic web linking
  "owl:sameAs": prototype.externalLinks || [],
  "owl:equivalentClass": prototype.equivalentClasses || [],
  
  // Redstring spatial and visual properties
  "redstring:color": prototype.color,
  "redstring:spatialContext": {
    "x": prototype.x || 0,
    "y": prototype.y || 0,
    "scale": prototype.scale || 1.0
  },
  "redstring:definitionGraphIds": prototype.definitionGraphIds,
  "redstring:image": prototype.imageSrc,
  "redstring:thumbnail": prototype.thumbnailSrc,
  "redstring:bio": prototype.bio
});
```

### 3. Instances (Spatial Objects)
**RDF Schema Level**: Individuals with `rdf:type` relationships  
**Redstring Role**: Positioned manifestations of prototypes within graphs  
**Implementation**: Graph instances with spatial context preservation

```javascript
// Instances are individuals positioned in spatial graphs
const instanceToSpatialObject = (instance, graphId) => ({
  "@type": "redstring:Instance",
  "@id": `instance:${instance.id}`,
  
  // RDF Schema typing - belongs to prototype class
  "rdf:type": { "@id": `prototype:${instance.prototypeId}` },
  "rdfs:label": instance.name || `Instance ${instance.id}`,
  
  // Spatial containment relationship
  "redstring:partOf": { "@id": `graph:${graphId}` },
  
  // Unique spatial positioning data
  "redstring:spatialContext": {
    "x": instance.x,
    "y": instance.y,
    "scale": instance.scale
  },
  
  "redstring:visualProperties": {
    "expanded": instance.expanded,
    "selected": instance.selected
  }
});
```

## The Rosetta Stone Mechanism

### Core Concept: `owl:sameAs` for Vocabulary Translation

**Purpose**: Enable seamless linking between Redstring concepts and external semantic web vocabularies without losing local context or forcing ontological constraints.

```javascript
// Rosetta Stone: Your "Dog" prototype links to external vocabularies
const dogPrototype = {
  "@type": ["rdfs:Class", "redstring:Node"],
  "@id": "prototype:dog-001",
  "rdfs:label": "Dog",
  "rdfs:comment": "Domestic canine, man's best friend",
  
  // Rosetta Stone mechanism - vocabulary translation
  "owl:sameAs": [
    "wd:Q144",                    // Wikidata: Dog
    "dbr:Dog",                    // DBpedia: Dog  
    "schema:Animal",              // Schema.org: Animal
    "http://purl.obolibrary.org/obo/NCBITaxon_9615" // NCBI: Canis lupus familiaris
  ],
  
  // Each sameAs link enables vocabulary bridging
  "owl:equivalentClass": [
    { "@id": "wd:Q144", "source": "wikidata" },
    { "@id": "dbr:Dog", "source": "dbpedia" }
  ],
  
  // Redstring preserves local context
  "redstring:color": "#8B4513",
  "redstring:personalMeaning": "Childhood pet memories",
  "redstring:cognitiveAssociations": ["loyalty", "companionship", "responsibility"]
};
```

### Bidirectional Vocabulary Translation

```javascript
// When importing external data, Rosetta Stone works in reverse
const translateExternalVocabulary = (externalConcept) => {
  // External Wikidata concept
  const wikidataDog = {
    "@id": "wd:Q144",
    "rdfs:label": "dog",
    "wdt:P31": "wd:Q55983715" // instance of: domestic animal
  };
  
  // Rosetta Stone finds local equivalent
  const localEquivalent = findPrototypeByOwlSameAs("wd:Q144");
  
  // Merges external properties with local context
  return {
    ...localEquivalent,
    "external:wikidata:instanceOf": wikidataDog["wdt:P31"],
    "external:wikidata:description": wikidataDog["rdfs:label"],
    // Local Redstring properties preserved
    "redstring:color": localEquivalent["redstring:color"],
    "redstring:spatialContext": localEquivalent["redstring:spatialContext"]
  };
};
```

## Separated Storage Architecture

### 1. Prototype Space (Semantic Classes)
```javascript
const prototypeSpace = {
  "@context": ENHANCED_REDSTRING_CONTEXT,
  "@type": "redstring:PrototypeSpace",
  "@id": "space:prototypes",
  
  // All node prototypes as semantic classes
  "prototypes": {
    "dog-001": {
      "@type": ["rdfs:Class", "redstring:Node"],
      "rdfs:label": "Dog",
      "owl:sameAs": ["wd:Q144", "dbr:Dog"],
      "redstring:color": "#8B4513"
    },
    "tree-001": {
      "@type": ["rdfs:Class", "redstring:Node"],
      "rdfs:label": "Tree", 
      "owl:sameAs": ["wd:Q10884", "dbr:Tree"],
      "redstring:color": "#228B22"
    }
  },
  
  // Semantic types as superclasses
  "types": {
    "physical-entity": {
      "@type": ["rdfs:Class", "redstring:SemanticType"],
      "rdfs:label": "Physical Entity"
    }
  }
};
```

### 2. Spatial Graphs (Positioned Instances)
```javascript
const spatialGraphs = {
  "@context": ENHANCED_REDSTRING_CONTEXT,
  "@type": "redstring:SpatialGraphCollection", 
  "@id": "space:graphs",
  
  "graphs": {
    "park-scene": {
      "@type": "redstring:SpatialGraph",
      "@id": "graph:park-scene",
      "rdfs:label": "Park Scene",
      
      // Instances positioned in this graph
      "instances": {
        "dog-instance-001": {
          "@type": "redstring:Instance",
          "rdf:type": { "@id": "prototype:dog-001" },
          "redstring:spatialContext": { "x": 150, "y": 200, "scale": 1.2 }
        },
        "tree-instance-001": {
          "@type": "redstring:Instance",
          "rdf:type": { "@id": "prototype:tree-001" },
          "redstring:spatialContext": { "x": 300, "y": 100, "scale": 0.8 }
        }
      },
      
      // Edges as relationship triplets
      "edges": {
        "edge-001": {
          "@type": "rdf:Statement",
          "rdf:subject": { "@id": "instance:dog-instance-001" },
          "rdf:predicate": { "@id": "redstring:near" },
          "rdf:object": { "@id": "instance:tree-instance-001" }
        }
      }
    }
  }
};
```

## Native Triplet Support

### Bidirectional Edges as Symmetric Triplets
```javascript
// Single bidirectional edge becomes two symmetric triplets
const bidirectionalEdgeToTriplets = (edge, sourceId, targetId) => {
  const basePredicate = `redstring:${edge.type || 'relatedTo'}`;
  
  return [
    // Forward triplet
    {
      "@type": "rdf:Statement",
      "@id": `statement:${edge.id}-forward`,
      "rdf:subject": { "@id": sourceId },
      "rdf:predicate": { "@id": basePredicate },
      "rdf:object": { "@id": targetId },
      "redstring:direction": "forward"
    },
    // Reverse triplet
    {
      "@type": "rdf:Statement", 
      "@id": `statement:${edge.id}-reverse`,
      "rdf:subject": { "@id": targetId },
      "rdf:predicate": { "@id": basePredicate },
      "rdf:object": { "@id": sourceId },
      "redstring:direction": "reverse"
    }
  ];
};

// Directional edges become single triplets
const directionalEdgeToTriplet = (edge, sourceId, targetId) => ({
  "@type": "rdf:Statement",
  "@id": `statement:${edge.id}`,
  "rdf:subject": { "@id": sourceId },
  "rdf:predicate": { "@id": `redstring:${edge.type || 'relatedTo'}` },
  "rdf:object": { "@id": targetId },
  "redstring:strength": edge.strength || 1.0,
  "redstring:color": edge.color
});
```

### Advanced Triplet Queries
```javascript
// Query triplets using SPARQL-like patterns
const queryTriplets = (subject, predicate, object) => {
  const pattern = {
    subject: subject || "?s",
    predicate: predicate || "?p", 
    object: object || "?o"
  };
  
  // Find all instances near trees
  const nearTreeInstances = queryTriplets(
    "?instance", 
    "redstring:near", 
    "instance:tree-instance-001"
  );
  
  // Find all relationships involving dogs
  const dogRelationships = queryTriplets(
    "instance:dog-instance-001",
    "?relationship", 
    "?target"
  );
  
  return matchingTriplets;
};
```

## Prototype/Instance Semantic Mapping

### 1. Prototypes as Classes
```javascript
// A Redstring prototype becomes an RDF Schema class
const prototypeToSemantic = (prototype) => ({
  "@type": ["redstring:Node", "rdfs:Class", "schema:Thing"],
  "@id": `prototype:${prototype.id}`,
  
  // RDF Schema standard properties (W3C compliant)
  "rdfs:label": prototype.name,
  "rdfs:comment": prototype.description,
  "rdfs:seeAlso": prototype.externalLinks || [],
  "rdfs:isDefinedBy": { "@id": "https://redstring.io" },
  
  // Core Redstring properties (preserved)
  "redstring:color": prototype.color,
  "redstring:definitionGraphIds": prototype.definitionGraphIds,
  
  // Semantic web integration (new)
  "sameAs": prototype.externalLinks || [],           // Wikipedia, DBpedia links
  "equivalentClass": prototype.equivalentClasses || [], // Other ontology mappings
  "subClassOf": prototype.abstractionChains ? 
    generateSubClassRelations(prototype.abstractionChains) : [], // RDF inheritance
  
  // Rich metadata (preserved)
  "redstring:image": prototype.imageSrc,
  "redstring:thumbnail": prototype.thumbnailSrc,
  "redstring:bio": prototype.bio,
  "redstring:type": prototype.typeNodeId
});
```

### 2. Instances as Statements + Spatial Context
```javascript
// A Redstring instance becomes an RDF statement with spatial data
const instanceToSemantic = (instance, graphId) => ({
  "@type": "redstring:Instance",
  "@id": `instance:${instance.id}`,
  
  // RDF Schema standard typing - instance belongs to prototype
  "rdf:type": { "@id": `prototype:${instance.prototypeId}` },
  "rdfs:label": instance.name || `Instance ${instance.id}`,
  "rdfs:comment": instance.description || "Redstring instance",
  
  // Core relationships - instance is contained within graph
  "redstring:partOf": { "@id": `graph:${graphId}` },
  
  // Spatial context (unique to Redstring)
  "redstring:spatialContext": {
    "x": instance.x,
    "y": instance.y,
    "scale": instance.scale
  },
  
  // Visual state
  "redstring:visualProperties": {
    "expanded": instance.expanded,
    "selected": instance.selected
  }
});
```

## AbstractionCarousel Integration

### Current: User-Made Abstraction Chains (Individual Branches)
```javascript
// Your current abstractionChains in prototypes - these are ossified single chains
node.abstractionChains = {
  "specificity": ["animal", "mammal", "primate", "human"],
  "domain": ["biology", "neuroscience", "consciousness"]
};

// Each chain is a complete, self-contained branch that can be explored independently
// Maps to semantic web as individual rdfs:subClassOf relationships
"subClassOf": [
  { "@id": "prototype:animal" },    // More general
  { "@id": "prototype:mammal" }     // More specific
],
"abstractionDimensions": {
  "specificity": { "level": 3, "chain": ["animal", "mammal", "primate", "human"] },
  "domain": { "level": 2, "chain": ["biology", "neuroscience", "consciousness"] }
}
```

### Future: External Knowledge Integration (Building the Bush)
```javascript
// Load external knowledge bases to build the full abstraction bush
// Each knowledge base provides additional branches that can be woven together
"subClassOf": [
  { "@id": "wd:Q729" },           // Wikidata: Animal (new branch)
  { "@id": "dbr:Mammal" },        // DBpedia: Mammal (new branch)
  { "@id": "prototype:custom-concept" } // Your custom concepts (existing branches)
]
```

### Enhanced AbstractionCarousel with Bush Scaffolding
```javascript
// Build the abstraction bush by weaving together ossified single chains
const buildAbstractionBushScaffold = async (conceptName) => {
  const branches = {};
  
  // Query multiple external knowledge bases for different abstraction perspectives
  const [wikidataChains, dbpediaChains, schemaOrgChains] = await Promise.all([
    fetchWikidataAbstractionChains(conceptName),
    fetchDBpediaAbstractionChains(conceptName),
    fetchSchemaOrgAbstractionChains(conceptName)
  ]);
  
  // Each knowledge base provides individual branches that can be woven together
  // Start with single chains, build the full bush through interconnections
  
  // Example: "The Beatles" abstraction bush - multiple interconnected branches
  if (wikidataChains.musical_genre) {
    branches["musical_genre_branch"] = wikidataChains.musical_genre.map(cls => ({
      "@id": cls.uri,
      "rdfs:label": cls.label,
      "rdfs:comment": cls.description,
      "level": cls.depth,
      "source": "wikidata"
    }));
  }
  
  if (dbpediaChains.record_label) {
    branches["record_label_branch"] = dbpediaChains.record_label.map(cls => ({
      "@id": cls.uri,
      "rdfs:label": cls.label,
      "rdfs:comment": cls.description,
      "level": cls.depth,
      "source": "dbpedia"
    }));
  }
  
  if (schemaOrgChains.cultural_movement) {
    branches["cultural_movement_branch"] = schemaOrgChains.cultural_movement.map(cls => ({
      "@id": cls.uri,
      "rdfs:label": cls.label,
      "rdfs:comment": cls.description,
      "level": cls.depth,
      "source": "schema.org"
    }));
  }
  
  return branches;
};

// The abstraction bush emerges from weaving these individual branches
// Each branch is a single ossified chain that can be explored independently
// The full bush structure emerges from the interconnections between branches

// Example: "The Beatles" gets multiple abstraction branches that form a bush
const beatlesAbstractionBush = await buildAbstractionBushScaffold("The Beatles");
// Result: Multiple branches that can be woven together:
// musical_genre_branch: [Thing → Band → Rock Band → 60s Rock Band → 60s Psychedelic Rock Band → The Beatles]
// record_label_branch: [Thing → Live Act → Musical Act → Musical Act Signed to Capitol Records → The Beatles]
// cultural_movement_branch: [Thing → Cultural Phenomenon → British Invasion → Beatlemania → The Beatles]
```

## RDF Schema Property Definitions

### 1. Edge Properties as RDF Properties
```javascript
// Your edges become RDF properties with domain/range constraints
const edgeToRDFProperty = (edge, sourceNode, targetNode) => ({
  "@type": "rdf:Property",
  "@id": `property:${edge.id}`,
  
  // RDF Schema standard properties
  "rdfs:label": edge.label || `Property ${edge.id}`,
  "rdfs:comment": edge.description || "Redstring edge property",
  "rdfs:domain": { "@id": `prototype:${sourceNode.prototypeId}` },
  "rdfs:range": { "@id": `prototype:${targetNode.prototypeId}` },
  
  // Redstring-specific properties
  "redstring:direction": edge.direction || "bidirectional",
  "redstring:strength": edge.strength || 1.0,
  "redstring:color": edge.color || "#000000"
});
```

### 2. Property Hierarchy with rdfs:subPropertyOf
```javascript
// Build property inheritance from your edge types
const createPropertyHierarchy = (edgeTypes) => {
  const hierarchy = [];
  
  // Example: "isA" is a sub-property of "relatedTo"
  if (edgeTypes.includes("isA") && edgeTypes.includes("relatedTo")) {
    hierarchy.push({
      "@type": "rdf:Property",
      "@id": "property:isA",
      "rdfs:subPropertyOf": { "@id": "property:relatedTo" },
      "rdfs:label": "is a type of",
      "rdfs:comment": "Taxonomic relationship indicating type membership"
    });
  }
  
  return hierarchy;
};
```

### 3. Property Validation with Domain/Range
```javascript
// Validate edge connections based on RDF Schema constraints
const validateEdgeConnection = (edge, sourceNode, targetNode) => {
  const errors = [];
  
  // Check domain constraint
  if (edge['rdfs:domain'] && 
      !isSubClassOf(sourceNode.prototypeId, edge['rdfs:domain'])) {
    errors.push(`Source node ${sourceNode.prototypeId} is not in domain of property ${edge.id}`);
  }
  
  // Check range constraint  
  if (edge['rdfs:range'] && 
      !isSubClassOf(targetNode.prototypeId, edge['rdfs:range'])) {
    errors.push(`Target node ${targetNode.prototypeId} is not in range of property ${edge.id}`);
  }
  
  return errors;
};
```

## Redstring Prototype-Instance Model in RDF Schema

### 1. Prototypes as Classes (rdfs:Class)
```javascript
// A prototype defines a concept type - it's a class in RDF terms
const prototypeToRDFClass = (prototype) => ({
  "@type": ["redstring:Node", "rdfs:Class", "schema:Thing"],
  "@id": `prototype:${prototype.id}`,
  
  // RDF Schema standard properties
  "rdfs:label": prototype.name,
  "rdfs:comment": prototype.description,
  
  // Redstring-specific properties
  "redstring:color": prototype.color,
  "redstring:definitionGraphIds": prototype.definitionGraphIds
});
```

### 2. Instances as Individuals (rdf:type)
```javascript
// An instance is an individual that belongs to a prototype class
const instanceToRDFIndividual = (instance, prototypeId) => ({
  "@type": "redstring:Instance",
  "@id": `instance:${instance.id}`,
  
  // RDF Schema: this individual is an instance of the prototype class
  "rdf:type": { "@id": `prototype:${prototypeId}` },
  
  // Redstring: this instance is contained within a specific graph
  "redstring:partOf": { "@id": `graph:${instance.graphId}` }
});
```

### 3. Key Distinctions in RDF Schema

**`rdf:type` vs `redstring:partOf`:**
- **`rdf:type`**: "This instance is of type X" (instanceOf relationship)
- **`redstring:partOf`**: "This instance is contained within graph Y" (spatial/contextual relationship)

**Example:**
```javascript
// A "Car" instance in a "Mechanical Systems" graph
{
  "@id": "instance:car-001",
  "rdf:type": { "@id": "prototype:car" },           // Instance is of type Car
  "redstring:partOf": { "@id": "graph:mechanical" } // Instance is in Mechanical graph
}

// The same "Car" instance could appear in multiple graphs
{
  "@id": "instance:car-001", 
  "rdf:type": { "@id": "prototype:car" },           // Still same type
  "redstring:partOf": { "@id": "graph:design" }     // But now in Design graph
}
```

### 4. Recursive Definition Graphs
```javascript
// When a prototype has definition graphs, those become sub-classes
const prototypeWithDefinitions = (prototype) => ({
  "@type": ["redstring:Node", "rdfs:Class", "schema:Thing"],
  "@id": `prototype:${prototype.id}`,
  
  // Definition graphs create specialized sub-concepts
  "redstring:hasDefinition": prototype.definitionGraphIds.map(graphId => ({
    "@id": `graph:${graphId}`,
    "rdfs:label": `Definition of ${prototype.name}`,
    "rdfs:comment": `Detailed elaboration of ${prototype.name} concept`
  }))
});
```

## Panel.jsx Semantic Integration

### Enhanced Panel with Semantic Sections

```javascript
// Modified Panel.jsx with integrated semantic editing
const Panel = ({ activeNode, activeGraph, storeState, storeActions }) => {
  const [activeTab, setActiveTab] = useState('properties');
  
  return (
    <div className="panel">
      
      {/* Tab Navigation */}
      <div className="tab-navigation">
        <button 
          className={activeTab === 'properties' ? 'active' : ''}
          onClick={() => setActiveTab('properties')}
        >
          Properties
        </button>
        <button 
          className={activeTab === 'semantic' ? 'active' : ''}
          onClick={() => setActiveTab('semantic')}
        >
          Semantic Web
        </button>
        <button 
          className={activeTab === 'types' ? 'active' : ''}
          onClick={() => setActiveTab('types')}
        >
          Types
        </button>
      </div>
      
      {/* Properties Tab (existing functionality) */}
      {activeTab === 'properties' && (
        <div className="properties-tab">
          <NodePropertiesEditor node={activeNode} />
          <DescriptionEditor node={activeNode} />
          <DefinitionGraphManager node={activeNode} />
        </div>
      )}
      
      {/* Semantic Web Tab (new) */}
      {activeTab === 'semantic' && (
        <SemanticEditor 
          node={activeNode}
          onSemanticUpdate={storeActions.updateNodeSemantic}
        />
      )}
      
      {/* Types Tab (enhanced TypeList) */}
      {activeTab === 'types' && (
        <SemanticTypeManager 
          types={storeState.semanticTypes}
          onTypeCreate={storeActions.createSemanticType}
          onTypeUpdate={storeActions.updateSemanticType}
        />
      )}
      
    </div>
  );
};
```

### SemanticEditor Component

```javascript
// New SemanticEditor component for Panel.jsx
const SemanticEditor = ({ node, onSemanticUpdate }) => {
  const [externalSearchResults, setExternalSearchResults] = useState([]);
  const [isSearching, setIsSearching] = useState(false);
  
  return (
    <div className="semantic-editor">
      
      {/* RDF Schema Properties Section */}
      <section className="rdf-properties">
        <h3>RDF Schema Properties</h3>
        
        <div className="property-group">
          <label>Label (rdfs:label)</label>
          <input 
            type="text"
            value={node['rdfs:label'] || node.name || ''}
            onChange={(e) => onSemanticUpdate(node.id, 'rdfs:label', e.target.value)}
            placeholder="Primary label for this concept"
          />
        </div>
        
        <div className="property-group">
          <label>Comment (rdfs:comment)</label>
          <textarea 
            value={node['rdfs:comment'] || node.description || ''}
            onChange={(e) => onSemanticUpdate(node.id, 'rdfs:comment', e.target.value)}
            placeholder="Description of this concept"
            rows={3}
          />
        </div>
        
        <div className="property-group">
          <label>See Also (rdfs:seeAlso)</label>
          <URLListEditor 
            urls={node['rdfs:seeAlso'] || []}
            onUpdate={(urls) => onSemanticUpdate(node.id, 'rdfs:seeAlso', urls)}
            placeholder="Related resources (URLs, DOIs, etc.)"
          />
        </div>
      </section>
      
      {/* Rosetta Stone Section - Core External Linking */}
      <section className="rosetta-stone">
        <h3>🌐 Rosetta Stone (owl:sameAs)</h3>
        <p className="section-description">
          Link this concept to external vocabularies and knowledge bases.
        </p>
        
        {/* Wikipedia/Wikidata Search */}
        <div className="external-search">
          <WikipediaSearch 
            conceptName={node.name}
            onResult={(result) => {
              const sameAsLinks = node['owl:sameAs'] || [];
              sameAsLinks.push(result.url);
              onSemanticUpdate(node.id, 'owl:sameAs', sameAsLinks);
            }}
          />
          
          <WikidataSearch 
            conceptName={node.name}
            onResult={(entityId) => {
              const sameAsLinks = node['owl:sameAs'] || [];
              sameAsLinks.push(`wd:${entityId}`);
              onSemanticUpdate(node.id, 'owl:sameAs', sameAsLinks);
            }}
          />
        </div>
        
        {/* Current sameAs Links */}
        <div className="same-as-links">
          <h4>Current External Links</h4>
          {(node['owl:sameAs'] || []).map((link, index) => (
            <ExternalLinkCard 
              key={index}
              uri={link}
              onRemove={() => {
                const links = [...(node['owl:sameAs'] || [])];
                links.splice(index, 1);
                onSemanticUpdate(node.id, 'owl:sameAs', links);
              }}
            />
          ))}
        </div>
        
        {/* Manual URL Input */}
        <div className="manual-link-input">
          <URLInput 
            placeholder="Manual URI/URL (e.g., https://dbpedia.org/resource/Dog)"
            onAdd={(url) => {
              const sameAsLinks = [...(node['owl:sameAs'] || []), url];
              onSemanticUpdate(node.id, 'owl:sameAs', sameAsLinks);
            }}
          />
        </div>
      </section>
      
      {/* Class Hierarchy Section */}
      <section className="class-hierarchy">
        <h3>📋 Class Relationships</h3>
        
        {/* Type Assignment (rdfs:subClassOf to semantic types) */}
        <div className="type-assignment">
          <label>Semantic Type (rdfs:subClassOf)</label>
          <SemanticTypeSelector 
            currentType={node.typeNodeId}
            onTypeChange={(typeId) => onSemanticUpdate(node.id, 'typeNodeId', typeId)}
          />
        </div>
        
        {/* Equivalent Classes */}
        <div className="equivalent-classes">
          <label>Equivalent Classes (owl:equivalentClass)</label>
          <EquivalentClassEditor 
            classes={node['owl:equivalentClass'] || []}
            onUpdate={(classes) => onSemanticUpdate(node.id, 'owl:equivalentClass', classes)}
          />
        </div>
      </section>
      
      {/* Advanced Semantic Properties */}
      <section className="advanced-semantic">
        <h3>🔬 Advanced Properties</h3>
        
        {/* Abstraction Chains Management */}
        <div className="abstraction-chains">
          <label>Abstraction Chains</label>
          <AbstractionChainEditor 
            chains={node.abstractionChains || {}}
            onUpdate={(chains) => onSemanticUpdate(node.id, 'abstractionChains', chains)}
          />
        </div>
        
        {/* Definition Graph IDs */}
        <div className="definition-graphs">
          <label>Definition Graphs</label>
          <DefinitionGraphManager 
            graphIds={node.definitionGraphIds || []}
            onUpdate={(graphIds) => onSemanticUpdate(node.id, 'definitionGraphIds', graphIds)}
          />
        </div>
      </section>
      
      {/* Preview Section - Show RDF Output */}
      <section className="rdf-preview">
        <h3>🔍 RDF Schema Preview</h3>
        <details>
          <summary>View Generated RDF Schema</summary>
          <pre className="rdf-output">
            {JSON.stringify(nodeToRDFSchema(node), null, 2)}
          </pre>
        </details>
      </section>
      
    </div>
  );
};
```

### SemanticTypeManager Component

```javascript
// Enhanced TypeList with semantic capabilities
const SemanticTypeManager = ({ types, onTypeCreate, onTypeUpdate }) => {
  const [newTypeName, setNewTypeName] = useState('');
  const [editingType, setEditingType] = useState(null);
  
  return (
    <div className="semantic-type-manager">
      
      <h3>📋 Semantic Types (rdfs:Class Hierarchy)</h3>
      <p className="section-description">
        Types define the top-level categories in your semantic hierarchy. 
        Prototypes automatically inherit from types via rdfs:subClassOf.
      </p>
      
      {/* Create New Type */}
      <div className="create-type">
        <div className="input-group">
          <input 
            type="text"
            value={newTypeName}
            onChange={(e) => setNewTypeName(e.target.value)}
            placeholder="New semantic type name"
          />
          <button 
            onClick={() => {
              onTypeCreate({
                id: generateId(),
                name: newTypeName,
                '@type': ['rdfs:Class', 'redstring:SemanticType'],
                'rdfs:label': newTypeName,
                'rdfs:comment': `Semantic type: ${newTypeName}`
              });
              setNewTypeName('');
            }}
            disabled={!newTypeName.trim()}
          >
            Create Type
          </button>
        </div>
      </div>
      
      {/* Existing Types */}
      <div className="types-list">
        {Object.entries(types || {}).map(([typeId, type]) => (
          <div key={typeId} className="type-card">
            
            {editingType === typeId ? (
              // Edit Mode
              <div className="type-editor">
                <input 
                  type="text"
                  value={type['rdfs:label'] || type.name}
                  onChange={(e) => onTypeUpdate(typeId, 'rdfs:label', e.target.value)}
                />
                <textarea 
                  value={type['rdfs:comment'] || type.description || ''}
                  onChange={(e) => onTypeUpdate(typeId, 'rdfs:comment', e.target.value)}
                  placeholder="Type description"
                  rows={2}
                />
                <div className="edit-actions">
                  <button onClick={() => setEditingType(null)}>Save</button>
                  <button onClick={() => setEditingType(null)}>Cancel</button>
                </div>
              </div>
            ) : (
              // Display Mode
              <div className="type-display">
                <h4>{type['rdfs:label'] || type.name}</h4>
                <p>{type['rdfs:comment'] || type.description}</p>
                <div className="type-metadata">
                  <span className="type-id">ID: {typeId}</span>
                  <span className="rdf-type">rdfs:Class</span>
                </div>
                <div className="type-actions">
                  <button onClick={() => setEditingType(typeId)}>Edit</button>
                </div>
              </div>
            )}
            
          </div>
        ))}
      </div>
      
    </div>
  );
};
```

### Integration with AbstractionCarousel
```javascript
// Enhanced AbstractionCarousel with semantic awareness
const SemanticAbstractionCarousel = ({ node, dimension }) => {
  const [externalClasses, setExternalClasses] = useState([]);
  
  return (
    <div className="abstraction-carousel semantic">
      
      {/* User-created abstraction chain (current) */}
      <div className="user-chain">
        {node.abstractionChains[dimension]?.map(conceptId => (
          <ConceptCard key={conceptId} id={conceptId} />
        ))}
      </div>
      
      {/* External semantic mappings (new) */}
      <div className="external-mappings">
        <h4>External Equivalents</h4>
        {node.equivalentClasses?.map(extClass => (
          <ExternalClassCard key={extClass['@id']} uri={extClass['@id']} />
        ))}
      </div>
      
      {/* Suggested connections from external KBs */}
      <div className="suggestions">
        <WikidataSuggestions conceptName={node.name} />
        <DBpediaSuggestions conceptName={node.name} />
      </div>
      
    </div>
  );
};
```

## Enhanced JSON-LD Export

```javascript
// Updated exportToRedstring with full RDF Schema compliance
export const exportToSemanticRedstring = (storeState) => {
  const nodePrototypesObj = {};
  
  storeState.nodePrototypes.forEach((prototype, id) => {
    nodePrototypesObj[id] = {
      "@type": ["redstring:Node", "rdfs:Class", "schema:Thing"],
      "@id": `prototype:${id}`,
      
      // RDF Schema standard properties (W3C compliant)
      "rdfs:label": prototype.name,
      "rdfs:comment": prototype.description,
      "rdfs:seeAlso": prototype.externalLinks || [],
      "rdfs:isDefinedBy": { "@id": "https://redstring.io" },
      
      // Core Redstring properties (preserved)
      "redstring:color": prototype.color,
      "redstring:x": prototype.x || 0,
      "redstring:y": prototype.y || 0,
      "redstring:scale": prototype.scale || 1.0,
      "redstring:definitionGraphIds": prototype.definitionGraphIds,
      
      // Rich metadata (preserved)
      "redstring:image": prototype.imageSrc,
      "redstring:thumbnail": prototype.thumbnailSrc,
      "redstring:bio": prototype.bio,
      "redstring:conjugation": prototype.conjugation,
      "redstring:type": prototype.typeNodeId,
      
      // Semantic web integration (RDF Schema compliant)
      "sameAs": prototype.externalLinks || [],
      "equivalentClass": prototype.equivalentClasses || [],
      "subClassOf": prototype.abstractionChains ? 
        generateSubClassRelations(prototype.abstractionChains) : [],
      
      // Spatial context (unique to Redstring)
      "redstring:spatialContext": {
        "x": prototype.x || 0,
        "y": prototype.y || 0,
        "scale": prototype.scale || 1.0
      }
    };
  });
  
  // Process graph instances with RDF Schema typing
  const graphInstancesObj = {};
  storeState.graphs.forEach((graph, graphId) => {
    graph.instances.forEach((instance, instanceId) => {
      graphInstancesObj[instanceId] = {
        "@type": "redstring:Instance", 
        "@id": `instance:${instanceId}`,
        
        // RDF Schema: instance belongs to prototype class
        "rdf:type": { "@id": `prototype:${instance.prototypeId}` },
        "rdfs:label": instance.name || `Instance ${instanceId}`,
        "rdfs:comment": instance.description || "Redstring instance",
        
        // Redstring: instance is contained within this graph
        "redstring:partOf": { "@id": `graph:${graphId}` },
        
        // Spatial context (unique to Redstring)
        "redstring:spatialContext": {
          "x": instance.x,
          "y": instance.y, 
          "scale": instance.scale
        }
      };
    });
  });
  
  // Process edges as RDF properties
  const edgePropertiesObj = {};
  storeState.graphs.forEach((graph, graphId) => {
    graph.edges.forEach((edge, edgeId) => {
      const sourceNode = graph.instances.get(edge.source);
      const targetNode = graph.instances.get(edge.target);
      
      if (sourceNode && targetNode) {
        edgePropertiesObj[edgeId] = {
          "@type": "rdf:Property",
          "@id": `property:${edgeId}`,
          "rdfs:label": edge.label || `Edge ${edgeId}`,
          "rdfs:comment": edge.description || "Redstring edge property",
          "rdfs:domain": { "@id": `prototype:${sourceNode.prototypeId}` },
          "rdfs:range": { "@id": `prototype:${targetNode.prototypeId}` },
          "redstring:direction": edge.direction || "bidirectional",
          "redstring:strength": edge.strength || 1.0,
          "redstring:color": edge.color || "#000000"
        };
      }
    });
  });
  
  return {
    "@context": REDSTRING_SEMANTIC_CONTEXT,
    "@type": "redstring:CognitiveSpace",
    "nodePrototypes": nodePrototypesObj,
    "graphInstances": graphInstancesObj,
    "edgeProperties": edgePropertiesObj,
    // ... rest of export
  };
};
```

## Sustainable Semantic Web Contribution

### Yes! This is excellent for semantic web contribution because:

✅ **W3C RDF Schema Compliance**: Full adherence to semantic web standards  
✅ **Rich Spatial Context**: Unique contribution - most ontologies lack spatial/visual data  
✅ **Prototype/Instance Model**: More flexible than traditional class/individual distinctions  
✅ **Abstraction Bush Scaffolding**: Novel approach to complex concept networks  
✅ **Human-Centered**: Bottom-up approach preserves cognitive authenticity  
✅ **Decomposition Flows**: Graph-within-graph recursion is semantically valuable  
✅ **Complete Metadata**: Color, bio, conjugation, directionality - rich beyond typical ontologies  

### Your contribution would be:
- **Cognitive Spatial Ontology**: First major ontology with spatial reasoning
- **Abstraction Bush Methodology**: Beyond tree structures to complex concept networks  
- **Human-Computer Semantic Bridge**: How people actually think vs. formal logic
- **Visual Knowledge Representation**: Color, positioning, scale as semantic properties
- **RDF Schema Extension**: Spatial and visual properties as standard RDF predicates
- **Ossified Chain Scaffolding**: Building complex bushes from simple, stable branches

## 5-Sprint Implementation Roadmap

### Sprint 1: RDF Schema Foundations 🏗️
**Goal**: Establish core semantic web vocabulary and data structures

**Tasks**:
- [ ] Update REDSTRING_CONTEXT with full RDF Schema vocabulary
- [ ] Implement three-layer architecture (Types → Prototypes → Instances)
- [ ] Add `owl:sameAs` and `owl:equivalentClass` to prototype data model
- [ ] Create separated storage: prototypeSpace vs spatialGraphs
- [ ] Update export/import functions for semantic compliance

**Acceptance Criteria**:
- All .redstring files include RDF Schema `@context`
- Prototypes export as `rdfs:Class` with proper hierarchy
- Instances export as individuals with `rdf:type` relationships
- Round-trip fidelity tests pass for semantic properties

### Sprint 2: Panel Integration & Semantic Editing 🎨
**Goal**: Create intuitive semantic web editing interface

**Tasks**:
- [ ] Add Semantic Web tab to Panel.jsx
- [ ] Implement SemanticEditor component with RDF Schema fields
- [ ] Create SemanticTypeManager for managing type hierarchy
- [ ] Add Rosetta Stone section for owl:sameAs editing
- [ ] Implement RDF Schema preview functionality

**Acceptance Criteria**:
- Users can edit rdfs:label, rdfs:comment, rdfs:seeAlso via UI
- Type assignment creates automatic rdfs:subClassOf relationships
- owl:sameAs links can be added/removed through interface
- RDF Schema output preview shows valid JSON-LD

### Sprint 3: External Knowledge Integration 🌐
**Goal**: Connect to Wikipedia, Wikidata, and other knowledge bases

**Tasks**:
- [ ] Implement WikipediaSearch component with API integration
- [ ] Add WikidataSearch with entity resolution
- [ ] Create ExternalLinkCard component for managing sameAs links
- [ ] Build vocabulary translation system using Rosetta Stone
- [ ] Add external knowledge base suggestions

**Acceptance Criteria**:
- Users can search and link to Wikipedia articles
- Wikidata entities can be found and linked via UI
- External URIs are validated and properly formatted
- Vocabulary translation works bidirectionally

### Sprint 4: Native Triplet Support 🔗
**Goal**: Handle bidirectional edges as semantic triplets

**Tasks**:
- [ ] Implement bidirectional edge to symmetric triplets conversion
- [ ] Create triplet query system for graph traversal
- [ ] Add RDF Statement support for reified relationships
- [ ] Build property domain/range validation system
- [ ] Update edge visualization to show triplet structure

**Acceptance Criteria**:
- Bidirectional edges export as two symmetric RDF statements
- Directional edges export as single RDF statements
- Triplet queries can find patterns in graph data
- Property constraints prevent invalid connections

### Sprint 5: Advanced Semantic Features 🚀
**Goal**: Complete semantic web compliance and advanced features

**Tasks**:
- [ ] Implement abstraction chain to rdfs:subClassOf mapping
- [ ] Add SPARQL-like query interface for complex searches
- [ ] Create semantic validation system for consistency checking
- [ ] Build export to standard RDF formats (Turtle, N-Triples)
- [ ] Add import from external RDF sources

**Acceptance Criteria**:
- Abstraction chains become proper RDF Schema hierarchies
- Complex semantic queries can be performed on data
- Data validation ensures RDF Schema compliance
- .redstring files can be converted to/from standard RDF formats
- External RDF data can be imported while preserving spatial context

## Success Metrics

✅ **W3C RDF Schema Compliance**: All exports pass W3C validation  
✅ **Semantic Interoperability**: Data works with external tools (Protégé, GraphDB)  
✅ **Spatial Context Preservation**: Unique positioning data retained in semantic format  
✅ **Cognitive Authenticity**: Human-friendly interface doesn't sacrifice usability  
✅ **External Integration**: Seamless linking to Wikipedia, Wikidata, DBpedia  
✅ **Round-trip Fidelity**: Perfect preservation through export/import cycles  
✅ **Performance**: Semantic features don't degrade core Redstring performance  

## Contribution to Semantic Web

**Redstring's Unique Value Proposition**:

🌟 **Cognitive Spatial Ontology**: First major ontology with native spatial reasoning  
🌟 **Human-Computer Semantic Bridge**: Bottom-up approach preserves cognitive authenticity  
🌟 **Visual Knowledge Representation**: Color, positioning, scale as semantic properties  
🌟 **Rosetta Stone Methodology**: Seamless vocabulary translation without ontological constraints  
🌟 **Recursive Graph Semantics**: Graph-within-graph recursion with semantic properties  
🌟 **Abstraction Bush Architecture**: Beyond trees to complex concept networks using ossified chains  

This approach builds a **semantic web that humans actually want to use** while maintaining full W3C standard compatibility. It creates a bridge between human cognitive patterns and formal semantic web infrastructure.

## Technical Architecture Summary

**Three-Layer Foundation**:
1. **Types** (rdfs:Class superclasses) ← Managed via TypeList UI
2. **Prototypes** (rdfs:Class with spatial properties) ← Core concepts with rich metadata  
3. **Instances** (Individuals with rdf:type + spatial context) ← Positioned in graphs

**Rosetta Stone Mechanism**:
- `owl:sameAs` enables vocabulary translation without losing local context
- Bidirectional compatibility with external knowledge bases
- Preserves Redstring cognitive authenticity while adding semantic web power

**Native Triplet Support**:
- Bidirectional edges → Two symmetric RDF statements
- Directional edges → Single RDF statement  
- Full RDF query capabilities with spatial awareness

**Separated Storage**:
- PrototypeSpace: Semantic classes with owl:sameAs links
- SpatialGraphs: Positioned instances with rdf:type relationships
- Unified .redstring format maintains compatibility

This architecture makes Redstring the most human-friendly and spatially-aware semantic web platform ever created!