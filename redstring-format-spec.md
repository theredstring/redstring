# Redstring File Format Specification

## Core Philosophy: Dynamic Graph Networks

Redstring's file format is designed to represent interconnected data structures - how nodes connect, expand, and reorganize. The format serves as both storage and a Rosetta Stone for graph data interchange.

## JSON-LD Context Mapping

```json
{
  "@context": {
    "@version": 1.1,
    "@vocab": "https://redstring.net/vocab/",
    
    // Core Redstring Concepts
    "redstring": "https://redstring.net/vocab/",
    "Graph": "redstring:Graph",
    "Node": "redstring:Node", 
    "Edge": "redstring:Edge",
    "SpatialContext": "redstring:SpatialContext",
    
    // Recursive Composition (The Heart of Redstring)
    "defines": "redstring:defines",
    "definedBy": "redstring:definedBy", 
    "expandsTo": "redstring:expandsTo",
    "contractsFrom": "redstring:contractsFrom",
    "contextualDefinition": "redstring:contextualDefinition",
    
    // Standard Vocabularies for Interop
    "name": "http://schema.org/name",
    "description": "http://schema.org/description",
    "color": "http://schema.org/color",
    "image": "http://schema.org/image",
    "thumbnail": "http://schema.org/thumbnail",
    "contains": "http://purl.org/dc/terms/hasPart",
    "partOf": "http://purl.org/dc/terms/isPartOf",
    "composedOf": "http://purl.org/vocab/frbr/core#embodiment",
    "composes": "http://purl.org/vocab/frbr/core#embodimentOf",
    
    // Spatial & UI State
    "x": "redstring:xCoordinate",
    "y": "redstring:yCoordinate", 
    "scale": "redstring:scale",
    "viewport": "redstring:viewport",
    "expanded": "redstring:expanded",
    "visible": "redstring:visible",
    
    // State Management
    "saved": "redstring:bookmarked",
    "active": "redstring:activeInContext",
    "definitionIndex": "redstring:currentDefinitionIndex",
    "contextKey": "redstring:contextKey",
    
    // Temporal & Versioning
    "created": "http://purl.org/dc/terms/created",
    "modified": "http://purl.org/dc/terms/modified",
    "version": "http://purl.org/dc/terms/hasVersion",
    
    // Solid Pod Federation
    "pod": "https://www.w3.org/ns/solid/terms#pod",
    "webId": "http://xmlns.com/foaf/0.1/webId",
    "references": "redstring:references",
    "linkedThinking": "redstring:linkedThinking"
  }
}
```

## Dual Format Edge Storage

Redstring uses a dual format approach for edges to support both native application functionality and semantic web integration:

### Native Redstring Format
- **`sourceId`**: Instance ID of the source node
- **`destinationId`**: Instance ID of the destination node  
- **`directionality`**: Arrow direction configuration
- **`typeNodeId`**: Connection type prototype ID
- **`definitionNodeIds`**: Array of definition node IDs
- **`name`**, **`description`**: Human-readable metadata

### RDF Format (Semantic Web)
- **`rdfStatement`**: RDF Statement with subject-predicate-object
- **`subject`**: Prototype ID of source node (semantic concept)
- **`predicate`**: Prototype ID of connection type (semantic relationship)
- **`object`**: Prototype ID of destination node (semantic concept)

### Metadata
- **`sourcePrototypeId`**: Maps instance to prototype for RDF
- **`destinationPrototypeId`**: Maps instance to prototype for RDF
- **`predicatePrototypeId`**: Connection type prototype for RDF

This approach enables:
1. **Full application functionality** using instance IDs and directionality
2. **Semantic web interoperability** using prototype-based RDF statements
3. **Backwards compatibility** with older file formats
4. **Future semantic features** like cross-Pod linking and AI reasoning

## Native .redstring Format

```json
{
  "@context": "https://redstring.net/contexts/v1.jsonld",
  "@type": "redstring:CognitiveSpace",
  "format": "redstring-v1.0.0",
  "metadata": {
    "created": "2024-01-01T00:00:00Z",
    "modified": "2024-01-01T12:00:00Z",
    "creator": "https://alice.solid.community/profile/card#me",
    "title": "Climate Change Economics Web",
    "description": "Exploring the intersection of climate policy and economic systems"
  },
  
  "spatialContext": {
    "viewport": { "x": 0, "y": 0, "zoom": 1.0 },
    "canvasSize": { "width": 4000, "height": 3000 }
  },
  
  "graphs": {
    "main-workspace": {
      "@type": "Graph",
      "id": "main-workspace",
      "name": "Climate Economics",
      "description": "The main exploration space",
      "nodeIds": ["carbon-pricing", "renewable-energy"],
      "edgeIds": ["price-energy-connection"],
      "definingNodeIds": [], // Top-level graph
      "spatial": {
        "expanded": true,
        "active": true
      }
    },
    
    "carbon-pricing-definition": {
      "@type": "Graph", 
      "id": "carbon-pricing-definition",
      "name": "Carbon Pricing",
      "description": "Mechanisms for pricing carbon emissions",
      "nodeIds": ["cap-and-trade", "carbon-tax", "border-adjustments"],
      "edgeIds": ["tax-trade-tension"],
      "definingNodeIds": ["carbon-pricing"], // This graph defines the carbon-pricing node
      "spatial": {
        "expanded": false,
        "active": false
      }
    }
  },
  
  "nodes": {
    "carbon-pricing": {
      "@type": "Node",
      "id": "carbon-pricing", 
      "name": "Carbon Pricing",
      "description": "Policy mechanisms to internalize climate costs",
      "color": "#2E7D32",
      "spatial": {
        "x": 200,
        "y": 150,
        "scale": 1.0
      },
      "definitionGraphIds": ["carbon-pricing-definition"],
      "parentDefinitionNodeId": null,
      "contextualDefinitions": {
        "main-workspace": 0 // Index into definitionGraphIds for this context
      },
      "media": {
        "image": "data:image/png;base64,...",
        "thumbnail": "data:image/png;base64,...",
        "aspectRatio": 0.75
      },
      "cognitive": {
        "saved": true,
        "lastViewed": "2024-01-01T11:30:00Z"
      }
    },
    
    "renewable-energy": {
      "@type": "Node",
      "id": "renewable-energy",
      "name": "Renewable Energy",
      "description": "Clean energy technologies and systems",
      "color": "#FF6F00",
      "spatial": {
        "x": 500,
        "y": 200,
        "scale": 1.0
      },
      "definitionGraphIds": [],
      "parentDefinitionNodeId": null,
      "contextualDefinitions": {},
      "cognitive": {
        "saved": false
      }
    }
  },
  
  "edges": {
    "price-energy-connection": {
      "@type": "Edge",
      "id": "price-energy-connection",
      "sourceId": "carbon-pricing",
      "destinationId": "renewable-energy", 
      "name": "Economic Incentive",
      "description": "Carbon pricing creates market incentives for renewable adoption",
      "typeNodeId": "base-connection-prototype",
      "definitionNodeIds": [],
      "directionality": {
        "arrowsToward": []
      },
      
      // RDF format (for semantic web integration)
      "rdfStatement": {
        "@type": "Statement",
        "subject": { "@id": "node:carbon-pricing-prototype" },
        "predicate": { "@id": "node:base-connection-prototype" },
        "object": { "@id": "node:renewable-energy-prototype" }
      },
      
      // Metadata for both formats
      "sourcePrototypeId": "carbon-pricing-prototype",
      "destinationPrototypeId": "renewable-energy-prototype",
      "predicatePrototypeId": "base-connection-prototype"
    }
  },
  
  "userInterface": {
    "openGraphIds": ["main-workspace"],
    "activeGraphId": "main-workspace", 
    "activeDefinitionNodeId": null,
    "expandedGraphIds": ["main-workspace"],
    "rightPanelTabs": [
      { "type": "home", "isActive": true }
    ],
    "savedNodeIds": ["carbon-pricing"]
  },
  
  "federation": {
    "pod": "https://alice.solidcommunity.net/redstring/",
    "linkedThinking": {
      "references": [
        {
          "nodeId": "renewable-energy",
          "podUrl": "https://bob.solidcommunity.net/redstring/energy-systems.jsonld",
          "nodeRef": "solar-power",
          "relationship": "relatedTo"
        }
      ],
      "subscribers": [
        "https://charlie.solidcommunity.net/profile/card#me"
      ]
    }
  }
}
```

## Import/Export Adapters

### Cytoscape.js Import
```javascript
const importCytoscape = (cytoscapeJson) => {
  return {
    graphs: cytoscapeJson.elements.nodes
      .filter(n => n.data.type === 'compound')
      .map(convertCytoscapeCompoundToGraph),
    nodes: cytoscapeJson.elements.nodes
      .filter(n => n.data.type !== 'compound') 
      .map(convertCytoscapeNodeToRedstring),
    edges: cytoscapeJson.elements.edges
      .map(convertCytoscapeEdgeToRedstring)
  };
};
```

### GraphML Export  
```javascript
const exportGraphML = (redstringData) => {
  return `<?xml version="1.0" encoding="UTF-8"?>
<graphml xmlns="http://graphml.graphdrawing.org/xmlns">
  <graph id="G" edgedefault="undirected">
    ${redstringData.nodes.map(nodeToGraphML).join('\n')}
    ${redstringData.edges.map(edgeToGraphML).join('\n')}
  </graph>
</graphml>`;
};
```

### Semantic Web (RDF/Turtle) Export
```javascript
const exportTurtle = (redstringData, context) => {
  const expanded = jsonld.expand(redstringData, context);
  return expanded.map(triple => 
    `<${triple.subject}> <${triple.predicate}> <${triple.object}> .`
  ).join('\n');
};
```

## Solid Pod Federation Schema

```json
{
  "federatedSpaces": {
    "subscriptions": [
      {
        "podUrl": "https://alice.solidcommunity.net/redstring/",
        "spaceId": "climate-economics", 
        "permissions": ["read", "reference"],
        "lastSync": "2024-01-01T12:00:00Z"
      }
    ],
    "publications": [
      {
        "spaceId": "main-workspace",
        "visibility": "public",
        "allowReferences": true,
        "subscribers": [
          "https://bob.solidcommunity.net/profile/card#me"
        ]
      }
    ],
    "crossReferences": {
      "carbon-pricing": [
        {
          "targetPod": "https://economist.example/redstring/",
          "targetNode": "pigouvian-tax",
          "relationship": "specializes"
        }
      ]
    }
  }
}
```

## The Magic: Context-Aware Translation

When importing standard formats, we detect common patterns:

- `schema:partOf` → `definitionGraphIds` 
- `foaf:depicts` → `parentDefinitionNodeId`
- `skos:broader/narrower` → hierarchical graph definitions
- Spatial coordinates → preserve in `spatial` object
- Colors, names, descriptions → direct mapping

The result? Someone's Obsidian graph becomes explorable Redstring space. A company's org chart becomes navigable cognitive territory. Academic concept maps become living, breathing thought networks.

**Neuroplasticity achieved through seamless format translation.** 