/**
 * Import Adapters - The Rosetta Stone for Graph Formats
 * Translates various graph formats into Redstring's cognitive space
 */

import { v4 as uuidv4 } from 'uuid';
import { REDSTRING_CONTEXT } from './redstringFormat.js';

/**
 * Import from Obsidian Graph JSON Export
 * Maps Obsidian's note-linking structure to Redstring's recursive composition
 */
export const importObsidian = (obsidianData) => {
  const { nodes: obsidianNodes = [], links: obsidianLinks = [] } = obsidianData;
  
  const graphs = new Map();
  const nodes = new Map();
  const edges = new Map();
  
  // Create main workspace graph
  const mainGraphId = uuidv4();
  graphs.set(mainGraphId, {
    id: mainGraphId,
    name: "Obsidian Knowledge Graph",
    description: "Imported from Obsidian vault",
    nodeIds: [],
    edgeIds: [],
    definingNodeIds: []
  });
  
  // Convert Obsidian nodes to Redstring nodes
  obsidianNodes.forEach((obsNode, index) => {
    const nodeId = obsNode.id || uuidv4();
    
    // Detect if this is a "Map of Content" or index note (has many outgoing links)
    const outgoingLinks = obsidianLinks.filter(link => link.source === obsNode.id);
    const isMapOfContent = outgoingLinks.length > 5; // Heuristic
    
    const redstringNode = {
      id: nodeId,
      name: obsNode.name || obsNode.id || `Note ${index + 1}`,
      description: obsNode.description || "",
      color: obsNode.group ? getColorForGroup(obsNode.group) : "#800000",
      x: obsNode.x || Math.random() * 800,
      y: obsNode.y || Math.random() * 600,
      scale: 1.0,
      imageSrc: null,
      thumbnailSrc: null,
      imageAspectRatio: null,
      parentDefinitionNodeId: null,
      edgeIds: [],
      definitionGraphIds: isMapOfContent ? [uuidv4()] : [] // Create definition for MOCs
    };
    
    nodes.set(nodeId, redstringNode);
    graphs.get(mainGraphId).nodeIds.push(nodeId);
    
    // If this is a Map of Content, create a definition graph
    if (isMapOfContent) {
      const defGraphId = redstringNode.definitionGraphIds[0];
      graphs.set(defGraphId, {
        id: defGraphId,
        name: `${redstringNode.name} Contents`,
        description: `Internal structure of ${redstringNode.name}`,
        nodeIds: [],
        edgeIds: [],
        definingNodeIds: [nodeId]
      });
    }
  });
  
  // Convert Obsidian links to Redstring edges
  obsidianLinks.forEach(obsLink => {
    const edgeId = uuidv4();
    const sourceNode = nodes.get(obsLink.source);
    const targetNode = nodes.get(obsLink.target);
    
    if (sourceNode && targetNode) {
      const redstringEdge = {
        id: edgeId,
        sourceId: obsLink.source,
        destinationId: obsLink.target,
        name: obsLink.name || "references",
        description: "Conceptual link from Obsidian",
        color: "#333",
        definitionNodeIds: []
      };
      
      edges.set(edgeId, redstringEdge);
      graphs.get(mainGraphId).edgeIds.push(edgeId);
      sourceNode.edgeIds.push(edgeId);
      targetNode.edgeIds.push(edgeId);
    }
  });
  
  return {
    graphs,
    nodes,
    edges,
    openGraphIds: [mainGraphId],
    activeGraphId: mainGraphId,
    expandedGraphIds: [mainGraphId],
    savedNodeIds: new Set()
  };
};

/**
 * Import from Cytoscape.js JSON
 * Handles hierarchical compound nodes as Redstring definitions
 */
export const importCytoscape = (cytoscapeData) => {
  const { elements } = cytoscapeData;
  const cytoscapeNodes = elements.nodes || [];
  const cytoscapeEdges = elements.edges || [];
  
  const graphs = new Map();
  const nodes = new Map();
  const edges = new Map();
  
  // Create main graph
  const mainGraphId = uuidv4();
  graphs.set(mainGraphId, {
    id: mainGraphId,
    name: "Cytoscape Network",
    description: "Imported from Cytoscape.js",
    nodeIds: [],
    edgeIds: [],
    definingNodeIds: []
  });
  
  // First pass: create all nodes
  cytoscapeNodes.forEach(cytoNode => {
    const nodeData = cytoNode.data;
    const position = cytoNode.position || { x: 0, y: 0 };
    
    const nodeId = nodeData.id;
    const isCompound = nodeData.parent !== undefined;
    
    const redstringNode = {
      id: nodeId,
      name: nodeData.label || nodeData.name || nodeId,
      description: nodeData.description || "",
      color: nodeData.color || (isCompound ? "#2E7D32" : "#800000"),
      x: position.x,
      y: position.y,
      scale: 1.0,
      imageSrc: nodeData.image,
      thumbnailSrc: null,
      imageAspectRatio: null,
      parentDefinitionNodeId: nodeData.parent || null,
      edgeIds: [],
      definitionGraphIds: []
    };
    
    nodes.set(nodeId, redstringNode);
    
    // If this node has a parent, it belongs to that parent's definition graph
    if (nodeData.parent) {
      // We'll handle this in second pass
    } else {
      graphs.get(mainGraphId).nodeIds.push(nodeId);
    }
  });
  
  // Second pass: handle compound structure (parent-child relationships)
  cytoscapeNodes.forEach(cytoNode => {
    const nodeData = cytoNode.data;
    const nodeId = nodeData.id;
    const node = nodes.get(nodeId);
    
    if (nodeData.parent) {
      const parentNode = nodes.get(nodeData.parent);
      if (parentNode) {
        // Create definition graph for parent if it doesn't exist
        if (parentNode.definitionGraphIds.length === 0) {
          const defGraphId = uuidv4();
          parentNode.definitionGraphIds.push(defGraphId);
          
          graphs.set(defGraphId, {
            id: defGraphId,
            name: `${parentNode.name} Components`,
            description: `Internal structure of ${parentNode.name}`,
            nodeIds: [],
            edgeIds: [],
            definingNodeIds: [nodeData.parent]
          });
        }
        
        // Add this node to parent's definition graph
        const defGraphId = parentNode.definitionGraphIds[0];
        graphs.get(defGraphId).nodeIds.push(nodeId);
      }
    }
  });
  
  // Convert edges
  cytoscapeEdges.forEach(cytoEdge => {
    const edgeData = cytoEdge.data;
    const edgeId = edgeData.id || uuidv4();
    
    const redstringEdge = {
      id: edgeId,
      sourceId: edgeData.source,
      destinationId: edgeData.target,
      name: edgeData.label || "connection",
      description: edgeData.description || "",
      color: edgeData.color || "#333",
      definitionNodeIds: []
    };
    
    edges.set(edgeId, redstringEdge);
    
    // Determine which graph this edge belongs to
    const sourceNode = nodes.get(edgeData.source);
    const targetNode = nodes.get(edgeData.target);
    
    if (sourceNode && targetNode) {
      // If both nodes have the same parent, edge goes in that definition graph
      if (sourceNode.parentDefinitionNodeId === targetNode.parentDefinitionNodeId) {
        if (sourceNode.parentDefinitionNodeId) {
          const parentNode = nodes.get(sourceNode.parentDefinitionNodeId);
          const defGraphId = parentNode.definitionGraphIds[0];
          graphs.get(defGraphId).edgeIds.push(edgeId);
        } else {
          graphs.get(mainGraphId).edgeIds.push(edgeId);
        }
      } else {
        // Cross-hierarchy edge goes in main graph
        graphs.get(mainGraphId).edgeIds.push(edgeId);
      }
      
      sourceNode.edgeIds.push(edgeId);
      targetNode.edgeIds.push(edgeId);
    }
  });
  
  return {
    graphs,
    nodes,
    edges,
    openGraphIds: [mainGraphId],
    activeGraphId: mainGraphId,
    expandedGraphIds: [mainGraphId],
    savedNodeIds: new Set()
  };
};

/**
 * Import from GraphML XML
 * Handles hierarchical data attributes and spatial positioning
 */
export const importGraphML = async (graphMLString) => {
  // Parse XML (this would need a proper XML parser in real implementation)
  const parser = new DOMParser();
  const xmlDoc = parser.parseFromString(graphMLString, "text/xml");
  
  const graphs = new Map();
  const nodes = new Map();
  const edges = new Map();
  
  // Create main graph
  const mainGraphId = uuidv4();
  graphs.set(mainGraphId, {
    id: mainGraphId,
    name: "GraphML Network",
    description: "Imported from GraphML",
    nodeIds: [],
    edgeIds: [],
    definingNodeIds: []
  });
  
  // Extract nodes
  const xmlNodes = xmlDoc.querySelectorAll('node');
  xmlNodes.forEach(xmlNode => {
    const nodeId = xmlNode.getAttribute('id');
    
    // Extract data attributes
    const dataElements = xmlNode.querySelectorAll('data');
    const nodeData = {};
    dataElements.forEach(dataEl => {
      const key = dataEl.getAttribute('key');
      const value = dataEl.textContent;
      nodeData[key] = value;
    });
    
    const redstringNode = {
      id: nodeId,
      name: nodeData.label || nodeData.name || nodeId,
      description: nodeData.description || "",
      color: nodeData.color || "#800000",
      x: parseFloat(nodeData.x) || Math.random() * 800,
      y: parseFloat(nodeData.y) || Math.random() * 600,
      scale: 1.0,
      imageSrc: null,
      thumbnailSrc: null,
      imageAspectRatio: null,
      parentDefinitionNodeId: null,
      edgeIds: [],
      definitionGraphIds: []
    };
    
    nodes.set(nodeId, redstringNode);
    graphs.get(mainGraphId).nodeIds.push(nodeId);
  });
  
  // Extract edges
  const xmlEdges = xmlDoc.querySelectorAll('edge');
  xmlEdges.forEach(xmlEdge => {
    const sourceId = xmlEdge.getAttribute('source');
    const targetId = xmlEdge.getAttribute('target');
    const edgeId = xmlEdge.getAttribute('id') || uuidv4();
    
    const dataElements = xmlEdge.querySelectorAll('data');
    const edgeData = {};
    dataElements.forEach(dataEl => {
      const key = dataEl.getAttribute('key');
      const value = dataEl.textContent;
      edgeData[key] = value;
    });
    
    const redstringEdge = {
      id: edgeId,
      sourceId,
      destinationId: targetId,
      name: edgeData.label || "connection",
      description: edgeData.description || "",
      color: edgeData.color || "#333",
      definitionNodeIds: []
    };
    
    edges.set(edgeId, redstringEdge);
    graphs.get(mainGraphId).edgeIds.push(edgeId);
    
    // Update node edge references
    const sourceNode = nodes.get(sourceId);
    const targetNode = nodes.get(targetId);
    if (sourceNode) sourceNode.edgeIds.push(edgeId);
    if (targetNode) targetNode.edgeIds.push(edgeId);
  });
  
  return {
    graphs,
    nodes,
    edges,
    openGraphIds: [mainGraphId],
    activeGraphId: mainGraphId,
    expandedGraphIds: [mainGraphId],
    savedNodeIds: new Set()
  };
};

/**
 * Import from JSON-LD with automatic semantic mapping
 * This is where the magic happens - automatic concept detection
 */
export const importJSONLD = (jsonldData) => {
  const graphs = new Map();
  const nodes = new Map();
  const edges = new Map();
  
  // Create main graph
  const mainGraphId = uuidv4();
  graphs.set(mainGraphId, {
    id: mainGraphId,
    name: "Linked Data Concepts",
    description: "Imported from JSON-LD",
    nodeIds: [],
    edgeIds: [],
    definingNodeIds: []
  });
  
  // Recursive function to process JSON-LD entities
  const processEntity = (entity, parentId = null) => {
    if (!entity['@id']) return null;
    
    const nodeId = entity['@id'];
    const nodeType = entity['@type'] || 'Concept';
    
    // Detect compositional relationships
    const hasParts = entity['http://purl.org/dc/terms/hasPart'] || 
                     entity['contains'] || 
                     entity['schema:hasPart'] || [];
    
    const isPartOf = entity['http://purl.org/dc/terms/isPartOf'] || 
                     entity['partOf'] || 
                     entity['schema:isPartOf'];
    
    const redstringNode = {
      id: nodeId,
      name: entity['http://schema.org/name'] || 
            entity['name'] || 
            entity['rdfs:label'] || 
            nodeId,
      description: entity['http://schema.org/description'] || 
                   entity['description'] || 
                   entity['rdfs:comment'] || 
                   "",
      color: getColorForType(nodeType),
      x: Math.random() * 800,
      y: Math.random() * 600,
      scale: 1.0,
      imageSrc: entity['http://schema.org/image'] || entity['image'],
      thumbnailSrc: null,
      imageAspectRatio: null,
      parentDefinitionNodeId: parentId,
      edgeIds: [],
      definitionGraphIds: hasParts.length > 0 ? [uuidv4()] : []
    };
    
    nodes.set(nodeId, redstringNode);
    
    // If this has parts, create a definition graph
    if (hasParts.length > 0) {
      const defGraphId = redstringNode.definitionGraphIds[0];
      graphs.set(defGraphId, {
        id: defGraphId,
        name: `${redstringNode.name} Structure`,
        description: `Components of ${redstringNode.name}`,
        nodeIds: [],
        edgeIds: [],
        definingNodeIds: [nodeId]
      });
      
      // Process parts recursively
      hasParts.forEach(part => {
        if (typeof part === 'object') {
          const partNodeId = processEntity(part, nodeId);
          if (partNodeId) {
            graphs.get(defGraphId).nodeIds.push(partNodeId);
          }
        }
      });
    }
    
    // Add to appropriate graph
    if (parentId) {
      // This will be added to parent's definition graph
    } else {
      graphs.get(mainGraphId).nodeIds.push(nodeId);
    }
    
    return nodeId;
  };
  
  // Process the JSON-LD data
  if (Array.isArray(jsonldData)) {
    jsonldData.forEach(entity => processEntity(entity));
  } else if (jsonldData['@graph']) {
    jsonldData['@graph'].forEach(entity => processEntity(entity));
  } else {
    processEntity(jsonldData);
  }
  
  return {
    graphs,
    nodes,
    edges,
    openGraphIds: [mainGraphId],
    activeGraphId: mainGraphId,
    expandedGraphIds: [mainGraphId],
    savedNodeIds: new Set()
  };
};

// Helper functions
const getColorForGroup = (group) => {
  const colors = ["#2E7D32", "#1976D2", "#F57C00", "#7B1FA2", "#D32F2F"];
  return colors[group % colors.length] || "#800000";
};

const getColorForType = (type) => {
  const typeColors = {
    'Person': "#2E7D32",
    'Organization': "#1976D2", 
    'Place': "#F57C00",
    'Event': "#7B1FA2",
    'Concept': "#800000",
    'Document': "#5D4037"
  };
  return typeColors[type] || "#800000";
};

/**
 * Format Detection and Auto-Import
 * Automatically detects format and routes to appropriate importer
 */
export const autoImport = async (fileContent, filename) => {
  const extension = filename.split('.').pop().toLowerCase();
  
  try {
    if (extension === 'json') {
      const data = JSON.parse(fileContent);
      
      // Detect format by structure
      if (data['@context'] || data['@type'] || data['@graph']) {
        return importJSONLD(data);
      } else if (data.elements && (data.elements.nodes || data.elements.edges)) {
        return importCytoscape(data);
      } else if (data.nodes && data.links) {
        return importObsidian(data);
      } else {
        throw new Error('Unknown JSON format');
      }
    } else if (extension === 'xml' || extension === 'graphml') {
      return await importGraphML(fileContent);
    } else {
      throw new Error(`Unsupported file format: ${extension}`);
    }
  } catch (error) {
    throw new Error(`Import failed: ${error.message}`);
  }
}; 