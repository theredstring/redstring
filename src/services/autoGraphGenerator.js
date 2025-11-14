/**
 * Auto Graph Generator Service
 * 
 * Generates Redstring graphs from various input formats (JSON-LD, simple JSON, etc.)
 * Respects the three-layer architecture: Prototypes -> Instances -> Graphs
 */

import { v4 as uuidv4 } from 'uuid';
import { applyLayout } from './graphLayoutService.js';

/**
 * Parse simple JSON format
 * Expected format:
 * {
 *   "nodes": [
 *     { "name": "Node Name", "description": "...", "color": "#8B0000" },
 *     ...
 *   ],
 *   "edges": [
 *     { "source": "Node Name", "target": "Another Node", "relation": "connects to" },
 *     ...
 *   ]
 * }
 */
function parseSimpleJSON(data) {
  const nodes = [];
  const edges = [];
  
  // Normalize input
  const inputNodes = data.nodes || data.concepts || [];
  const inputEdges = data.edges || data.relationships || data.connections || [];
  
  // Parse nodes
  inputNodes.forEach((node, index) => {
    nodes.push({
      name: node.name || node.label || node.id || `Node ${index + 1}`,
      description: node.description || node.desc || node.comment || '',
      color: node.color || node.colour || '#8B0000',
      type: node.type || node.typeNodeId || null
    });
  });
  
  // Parse edges
  inputEdges.forEach((edge, index) => {
    edges.push({
      source: edge.source || edge.from || edge.subject,
      target: edge.target || edge.to || edge.object,
      relation: edge.relation || edge.predicate || edge.name || edge.label || 'connected to',
      description: edge.description || edge.desc || ''
    });
  });
  
  return { nodes, edges };
}

/**
 * Parse JSON-LD format
 * Handles RDF-style linked data with @context, @type, etc.
 */
function parseJSONLD(data) {
  const nodes = [];
  const edges = [];
  const nodesByUri = new Map();
  
  // Handle both single object and array of objects
  const items = Array.isArray(data) ? data : 
                data['@graph'] ? data['@graph'] : [data];
  
  // First pass: Extract all entities as nodes
  items.forEach((item, index) => {
    if (!item || typeof item !== 'object') return;
    
    const uri = item['@id'] || item.id || `node-${index}`;
    const type = item['@type'] || item.type || 'Thing';
    const name = item.name || item['http://schema.org/name'] || 
                 item['rdfs:label'] || item.label || uri;
    const description = item.description || item['http://schema.org/description'] || 
                       item['rdfs:comment'] || item.comment || '';
    
    const node = {
      uri,
      name: typeof name === 'string' ? name : name['@value'] || String(name),
      description: typeof description === 'string' ? description : description['@value'] || String(description),
      color: '#8B0000',
      type: Array.isArray(type) ? type[0] : type
    };
    
    nodes.push(node);
    nodesByUri.set(uri, node);
  });
  
  // Second pass: Extract relationships as edges
  items.forEach(item => {
    if (!item || typeof item !== 'object') return;
    
    const subjectUri = item['@id'] || item.id;
    if (!subjectUri) return;
    
    // Iterate through properties looking for object references
    Object.keys(item).forEach(predicate => {
      if (predicate.startsWith('@')) return; // Skip JSON-LD keywords
      
      const values = Array.isArray(item[predicate]) ? item[predicate] : [item[predicate]];
      
      values.forEach(value => {
        // Check if this is an object reference
        let objectUri = null;
        
        if (typeof value === 'object' && value['@id']) {
          objectUri = value['@id'];
        } else if (typeof value === 'string' && nodesByUri.has(value)) {
          objectUri = value;
        }
        
        if (objectUri && nodesByUri.has(objectUri)) {
          // Clean up predicate name
          let relationName = predicate
            .replace(/^http:\/\/[^/]+\//, '')
            .replace(/^https:\/\/[^/]+\//, '')
            .replace(/([A-Z])/g, ' $1')
            .trim()
            .toLowerCase();
          
          edges.push({
            source: subjectUri,
            target: objectUri,
            relation: relationName || 'related to'
          });
        }
      });
    });
  });
  
  return { nodes, edges };
}

/**
 * Parse input data based on format detection
 */
export function parseInputData(inputText, format = 'auto') {
  try {
    const data = typeof inputText === 'string' ? JSON.parse(inputText) : inputText;
    
    // Auto-detect format
    if (format === 'auto') {
      if (data['@context'] || data['@graph'] || (Array.isArray(data) && data[0]?.['@id'])) {
        format = 'jsonld';
      } else if (data.nodes || data.edges || data.concepts) {
        format = 'simple';
      } else {
        // Try JSON-LD first as it's more flexible
        format = 'jsonld';
      }
    }
    
    // Parse based on format
    switch (format) {
      case 'jsonld':
      case 'json-ld':
      case 'rdf':
        return parseJSONLD(data);
      
      case 'simple':
      case 'json':
      default:
        return parseSimpleJSON(data);
    }
  } catch (error) {
    throw new Error(`Failed to parse input data: ${error.message}`);
  }
}

/**
 * Find or create prototype by name
 * Reuses existing prototypes to maintain semantic consistency
 */
function findOrCreatePrototype(name, description, color, nodePrototypes, storeActions, typeNodeId = null) {
  // Search for existing prototype with same name
  for (const [id, prototype] of nodePrototypes.entries()) {
    if (prototype.name.toLowerCase() === name.toLowerCase()) {
      console.log(`[AutoGraph] Reusing existing prototype: ${name} (${id})`);
      return id;
    }
  }
  
  // Create new prototype
  const prototypeId = uuidv4();
  const prototypeData = {
    id: prototypeId,
    name,
    description: description || '',
    color: color || '#8B0000',
    definitionGraphIds: [],
    typeNodeId: typeNodeId || 'base-thing-prototype'
  };
  
  console.log(`[AutoGraph] Creating new prototype: ${name} (${prototypeId})`);
  storeActions.addNodePrototype(prototypeData);
  
  return prototypeId;
}

/**
 * Generate graph from parsed data
 * Creates prototypes and instances following Redstring architecture
 * 
 * @param {Object} parsedData - Output from parseInputData()
 * @param {string} targetGraphId - Graph ID to add instances to
 * @param {Object} storeState - Current Zustand store state
 * @param {Object} storeActions - Zustand store actions
 * @param {Object} options - Generation options
 * @returns {Object} Generation results with created IDs
 */
export function generateGraph(parsedData, targetGraphId, storeState, storeActions, options = {}, getFreshState = null) {
  const {
    layoutAlgorithm = 'force',
    layoutOptions = {},
    createNewGraph = false,
    graphName = 'Auto-Generated Graph',
    graphDescription = 'Graph generated from imported data',
    replaceExisting = false
  } = options;
  
  const { nodePrototypes } = storeState;
  const results = {
    prototypesCreated: [],
    prototypesReused: [],
    instancesCreated: [],
    edgesCreated: [],
    graphId: targetGraphId,
    errors: []
  };
  
  try {
    // Create new graph if requested
    if (createNewGraph) {
      const proposedGraphId = uuidv4();
      const actualGraphId = storeActions.createNewGraph({
        id: proposedGraphId,
        name: graphName,
        description: graphDescription
      });
      
      // Use the actual ID returned (should match proposed, but be safe)
      targetGraphId = actualGraphId || proposedGraphId;
      results.graphId = targetGraphId;
      
      storeActions.setActiveGraph(targetGraphId);
      
      // Get fresh state after creating graph to ensure it exists
      if (getFreshState) {
        storeState = getFreshState();
        console.log('[AutoGraph] Created new graph:', targetGraphId, 'Fresh state has graph:', storeState.graphs.has(targetGraphId));
      } else {
        console.log('[AutoGraph] Created new graph:', targetGraphId, 'Adding nodes to it...');
      }
    } else if (replaceExisting) {
      // Clear existing instances and edges
      const graph = storeState.graphs.get(targetGraphId);
      if (graph) {
        const instanceIds = Array.from(graph.instances.keys());
        instanceIds.forEach(instanceId => {
          storeActions.deleteNodeInstance(targetGraphId, instanceId);
        });
      }
    }
    
    // Verify target graph exists before proceeding
    if (!targetGraphId) {
      throw new Error('No target graph ID specified');
    }
    
    // For new graphs, verify it was created successfully
    if (createNewGraph) {
      // Get fresh state to verify graph exists
      // Note: We can't import useGraphStore here, so we rely on the action having worked
      // The action should have created it synchronously
      console.log('[AutoGraph] Target graph ID for new graph:', targetGraphId);
    } else {
      // For existing graphs, verify it exists in storeState
      if (!storeState.graphs.has(targetGraphId)) {
        throw new Error(`Target graph ${targetGraphId} does not exist`);
      }
      console.log('[AutoGraph] Using existing graph:', targetGraphId);
    }
    
    // Map of node name -> {prototypeId, instanceId}
    const nodeMap = new Map();
    
    // Step 1: Create/find prototypes and create instances
    const tempInstances = [];
    
    parsedData.nodes.forEach((nodeData, index) => {
      try {
        // Find or create prototype
        const prototypeId = findOrCreatePrototype(
          nodeData.name,
          nodeData.description,
          nodeData.color,
          nodePrototypes,
          storeActions,
          nodeData.type
        );
        
        // Track if this is new or reused
        if (nodePrototypes.has(prototypeId)) {
          results.prototypesReused.push(prototypeId);
        } else {
          results.prototypesCreated.push(prototypeId);
        }
        
        // Create instance with temporary position (no initial position - let layout decide)
        const instanceId = uuidv4();
        tempInstances.push({
          id: instanceId,
          prototypeId,
          // Don't set x, y here - let layout algorithm initialize positions
          name: nodeData.name // For edge matching
        });
        
        nodeMap.set(nodeData.name, { prototypeId, instanceId });
        // Also map by URI if available
        if (nodeData.uri) {
          nodeMap.set(nodeData.uri, { prototypeId, instanceId });
        }
        
        results.instancesCreated.push(instanceId);
      } catch (error) {
        console.error(`[AutoGraph] Error creating node ${nodeData.name}:`, error);
        results.errors.push(`Failed to create node "${nodeData.name}": ${error.message}`);
      }
    });
    
    // Step 2: Apply layout algorithm to calculate positions
    const tempEdges = parsedData.edges.map(edge => ({
      sourceId: nodeMap.get(edge.source)?.instanceId,
      destinationId: nodeMap.get(edge.target)?.instanceId
    })).filter(e => e.sourceId && e.destinationId);
    
    const positionUpdates = applyLayout(tempInstances, tempEdges, layoutAlgorithm, layoutOptions);
    
    // Create a map of instanceId -> position for quick lookup
    const positionMap = new Map();
    positionUpdates.forEach(update => {
      positionMap.set(update.instanceId, { x: update.x, y: update.y });
    });
    
    // Step 3: Add instances to graph with calculated positions
    console.log('[AutoGraph] Adding', tempInstances.length, 'instances to graph:', targetGraphId);
    tempInstances.forEach(instance => {
      const position = positionMap.get(instance.id) || { x: 0, y: 0 };
      
      try {
        storeActions.addNodeInstance(
          targetGraphId,
          instance.prototypeId,
          {
            x: position.x,
            y: position.y,
            scale: 1
          },
          instance.id // Use the pre-generated instance ID
        );
      } catch (error) {
        console.error(`[AutoGraph] Failed to add instance ${instance.id} to graph ${targetGraphId}:`, error);
        results.errors.push(`Failed to add instance "${instance.name}": ${error.message}`);
      }
    });
    
    // Refresh state after adding instances to ensure graph is fully updated
    if (getFreshState && createNewGraph) {
      storeState = getFreshState();
      console.log('[AutoGraph] Refreshed state before adding edges. Graph exists:', storeState.graphs.has(targetGraphId));
    }
    
    // Step 4: Create edges between instances
    parsedData.edges.forEach((edgeData, index) => {
      try {
        const sourceNode = nodeMap.get(edgeData.source);
        const targetNode = nodeMap.get(edgeData.target);
        
        if (!sourceNode || !targetNode) {
          console.warn(`[AutoGraph] Skipping edge: couldn't find nodes for ${edgeData.source} -> ${edgeData.target}`);
          results.errors.push(`Skipped edge: nodes not found for "${edgeData.source}" -> "${edgeData.target}"`);
          return;
        }
        
        // Find or create prototype for the relation
        const relationPrototypeId = findOrCreatePrototype(
          edgeData.relation,
          edgeData.description || '',
          '#708090', // Default gray for relations
          nodePrototypes,
          storeActions,
          'base-connection-prototype'
        );
        
        // Create edge
        const edgeId = uuidv4();
        const edgeObj = {
          id: edgeId,
          sourceId: sourceNode.instanceId,
          destinationId: targetNode.instanceId,
          name: edgeData.relation,
          description: edgeData.description || '',
          typeNodeId: relationPrototypeId,
          definitionNodeIds: [],
          directionality: { arrowsToward: new Set([targetNode.instanceId]) } // Default: arrow toward target
        };
        
        // addEdge expects (graphId, edgeData, contextOptions)
        storeActions.addEdge(targetGraphId, edgeObj);
        
        results.edgesCreated.push(edgeId);
      } catch (error) {
        console.error(`[AutoGraph] Error creating edge ${edgeData.source} -> ${edgeData.target}:`, error);
        results.errors.push(`Failed to create edge "${edgeData.source}" -> "${edgeData.target}": ${error.message}`);
      }
    });
    
    console.log('[AutoGraph] Generation complete:', {
      prototypesCreated: results.prototypesCreated.length,
      prototypesReused: results.prototypesReused.length,
      instancesCreated: results.instancesCreated.length,
      edgesCreated: results.edgesCreated.length,
      errors: results.errors.length
    });
    
  } catch (error) {
    console.error('[AutoGraph] Critical error during generation:', error);
    results.errors.push(`Critical error: ${error.message}`);
  }
  
  return results;
}

/**
 * Generate sample test data for quick testing
 */
export function getSampleData(sampleName = 'simple') {
  const samples = {
    simple: {
      name: 'Simple Network',
      description: 'A simple 5-node network',
      data: {
        nodes: [
          { name: 'Start', description: 'Entry point', color: '#2E7D32' },
          { name: 'Process A', description: 'First processing step', color: '#1976D2' },
          { name: 'Process B', description: 'Second processing step', color: '#1976D2' },
          { name: 'Decision', description: 'Decision point', color: '#F57C00' },
          { name: 'End', description: 'Exit point', color: '#C62828' }
        ],
        edges: [
          { source: 'Start', target: 'Process A', relation: 'leads to' },
          { source: 'Process A', target: 'Process B', relation: 'flows to' },
          { source: 'Process B', target: 'Decision', relation: 'outputs to' },
          { source: 'Decision', target: 'End', relation: 'concludes at' },
          { source: 'Decision', target: 'Process A', relation: 'loops back to' }
        ]
      }
    },
    
    family: {
      name: 'Family Tree',
      description: 'A hierarchical family structure',
      data: {
        nodes: [
          { name: 'Grandparent', description: 'Root of family tree', color: '#5E35B1' },
          { name: 'Parent A', description: 'First generation', color: '#3949AB' },
          { name: 'Parent B', description: 'First generation', color: '#3949AB' },
          { name: 'Child A1', description: 'Second generation', color: '#1E88E5' },
          { name: 'Child A2', description: 'Second generation', color: '#1E88E5' },
          { name: 'Child B1', description: 'Second generation', color: '#1E88E5' }
        ],
        edges: [
          { source: 'Grandparent', target: 'Parent A', relation: 'parent of' },
          { source: 'Grandparent', target: 'Parent B', relation: 'parent of' },
          { source: 'Parent A', target: 'Child A1', relation: 'parent of' },
          { source: 'Parent A', target: 'Child A2', relation: 'parent of' },
          { source: 'Parent B', target: 'Child B1', relation: 'parent of' }
        ]
      }
    },
    
    knowledge: {
      name: 'Knowledge Graph',
      description: 'DBpedia-style linked data',
      data: {
        '@context': 'http://schema.org',
        '@graph': [
          {
            '@id': 'http://example.org/person/albert-einstein',
            '@type': 'Person',
            'name': 'Albert Einstein',
            'description': 'Theoretical physicist',
            'birthPlace': 'http://example.org/place/ulm',
            'knows': 'http://example.org/person/niels-bohr'
          },
          {
            '@id': 'http://example.org/person/niels-bohr',
            '@type': 'Person',
            'name': 'Niels Bohr',
            'description': 'Physicist and philosopher',
            'birthPlace': 'http://example.org/place/copenhagen'
          },
          {
            '@id': 'http://example.org/place/ulm',
            '@type': 'Place',
            'name': 'Ulm',
            'description': 'City in Germany'
          },
          {
            '@id': 'http://example.org/place/copenhagen',
            '@type': 'Place',
            'name': 'Copenhagen',
            'description': 'Capital of Denmark'
          }
        ]
      }
    },
    
    concepts: {
      name: 'Concept Network',
      description: 'Abstract concept relationships',
      data: {
        nodes: [
          { name: 'Knowledge', description: 'Understanding and awareness', color: '#6A1B9A' },
          { name: 'Learning', description: 'Process of acquiring knowledge', color: '#7B1FA2' },
          { name: 'Memory', description: 'Storage of information', color: '#8E24AA' },
          { name: 'Understanding', description: 'Comprehension of meaning', color: '#9C27B0' },
          { name: 'Wisdom', description: 'Application of knowledge', color: '#AB47BC' },
          { name: 'Experience', description: 'Practical exposure', color: '#BA68C8' },
          { name: 'Insight', description: 'Deep perception', color: '#CE93D8' }
        ],
        edges: [
          { source: 'Learning', target: 'Knowledge', relation: 'produces' },
          { source: 'Memory', target: 'Knowledge', relation: 'stores' },
          { source: 'Knowledge', target: 'Understanding', relation: 'enables' },
          { source: 'Understanding', target: 'Wisdom', relation: 'leads to' },
          { source: 'Experience', target: 'Learning', relation: 'facilitates' },
          { source: 'Experience', target: 'Wisdom', relation: 'contributes to' },
          { source: 'Understanding', target: 'Insight', relation: 'manifests as' },
          { source: 'Memory', target: 'Learning', relation: 'supports' }
        ]
      }
    }
  };
  
  return samples[sampleName] || samples.simple;
}

export default {
  parseInputData,
  generateGraph,
  getSampleData
};

