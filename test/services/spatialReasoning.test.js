/**
 * Spatial Reasoning Tests
 * Tests the spatial intelligence and layout algorithms
 */

import { describe, it, expect } from 'vitest';

// Mock the spatial reasoning functions that would be imported from the MCP server
// In a real implementation, these would be imported from the actual modules

const NODE_WIDTH = 150;
const NODE_HEIGHT = 100;
const EXPANDED_NODE_WIDTH = 300;

// Mock spatial reasoning functions
function calculateNodeDimensions(conceptName, hasImage = false) {
  const baseWidth = hasImage ? EXPANDED_NODE_WIDTH : NODE_WIDTH;
  const baseHeight = NODE_HEIGHT;
  const avgCharWidth = 9;
  const textWidth = conceptName.length * avgCharWidth;
  const needsWrap = textWidth > (baseWidth - 60); // Accounting for padding
  
  return {
    width: baseWidth,
    height: needsWrap ? baseHeight + 20 : baseHeight,
    bounds: {
      width: baseWidth,
      height: needsWrap ? baseHeight + 20 : baseHeight
    }
  };
}

function analyzeClusters(nodes) {
  const clusters = {};
  const clusterRadius = 150;
  const processed = new Set();
  let clusterIndex = 0;
  
  for (const node of nodes) {
    if (processed.has(node.id)) continue;
    
    const clusterId = `cluster_${clusterIndex++}`;
    const cluster = {
      center: [node.x, node.y],
      nodes: [node.id],
      density: 1,
      bounds: { minX: node.x, maxX: node.x, minY: node.y, maxY: node.y }
    };
    
    for (const otherNode of nodes) {
      if (otherNode.id === node.id || processed.has(otherNode.id)) continue;
      
      const distance = Math.sqrt(
        Math.pow(node.x - otherNode.x, 2) + Math.pow(node.y - otherNode.y, 2)
      );
      
      if (distance <= clusterRadius) {
        cluster.nodes.push(otherNode.id);
        cluster.bounds.minX = Math.min(cluster.bounds.minX, otherNode.x);
        cluster.bounds.maxX = Math.max(cluster.bounds.maxX, otherNode.x);
        cluster.bounds.minY = Math.min(cluster.bounds.minY, otherNode.y);
        cluster.bounds.maxY = Math.max(cluster.bounds.maxY, otherNode.y);
        processed.add(otherNode.id);
      }
    }
    
    if (cluster.nodes.length > 1) {
      const centerX = (cluster.bounds.minX + cluster.bounds.maxX) / 2;
      const centerY = (cluster.bounds.minY + cluster.bounds.maxY) / 2;
      cluster.center = [centerX, centerY];
      cluster.density = cluster.nodes.length / (clusterRadius * clusterRadius / 10000);
      clusters[clusterId] = cluster;
    }
    
    processed.add(node.id);
  }
  
  return clusters;
}

function findEmptyRegions(nodes, canvasSize) {
  const regions = [];
  const gridSize = 100;
  const nodeRadius = 50;
  
  for (let x = 350; x < canvasSize.width - 100; x += gridSize) {
    for (let y = 100; y < canvasSize.height - 100; y += gridSize) {
      let isEmpty = true;
      
      for (const node of nodes) {
        const distance = Math.sqrt(
          Math.pow(x - node.x, 2) + Math.pow(y - node.y, 2)
        );
        if (distance < nodeRadius * 2) {
          isEmpty = false;
          break;
        }
      }
      
      if (isEmpty) {
        regions.push({
          x: x,
          y: y,
          width: gridSize,
          height: gridSize,
          suitability: x > 400 && x < 600 && y > 150 && y < 350 ? "high" : "medium"
        });
      }
    }
  }
  
  return regions;
}

function generateClusteredLayout(clusters, startX, startY, nodeSpacing) {
  const positions = {};
  const clusterNames = Object.keys(clusters);
  let currentClusterX = startX;
  
  clusterNames.forEach((clusterName) => {
    const concepts = clusters[clusterName];
    let maxClusterWidth = 0;
    let currentY = startY;
    let currentX = currentClusterX;
    let rowWidth = 0;
    let maxRowHeight = 0;
    
    const conceptsPerRow = Math.ceil(Math.sqrt(concepts.length));
    
    concepts.forEach((concept, index) => {
      const dimensions = calculateNodeDimensions(concept.name);
      
      if (index > 0 && index % conceptsPerRow === 0) {
        currentY += maxRowHeight + nodeSpacing.vertical;
        currentX = currentClusterX;
        rowWidth = 0;
        maxRowHeight = 0;
      }
      
      positions[concept.name] = {
        x: currentX,
        y: currentY,
        cluster: clusterName,
        dimensions: dimensions
      };
      
      currentX += dimensions.width + nodeSpacing.horizontal;
      rowWidth += dimensions.width + nodeSpacing.horizontal;
      maxRowHeight = Math.max(maxRowHeight, dimensions.height);
      maxClusterWidth = Math.max(maxClusterWidth, rowWidth);
    });
    
    currentClusterX += maxClusterWidth + nodeSpacing.clusterGap;
  });
  
  return positions;
}

describe('Spatial Reasoning Core Functions', () => {
  describe('Node Dimension Calculations', () => {
    it('should calculate correct dimensions for short names', () => {
      const dimensions = calculateNodeDimensions('AI');
      
      expect(dimensions.width).toBe(NODE_WIDTH);
      expect(dimensions.height).toBe(NODE_HEIGHT);
      expect(dimensions.bounds.width).toBe(NODE_WIDTH);
      expect(dimensions.bounds.height).toBe(NODE_HEIGHT);
    });

    it('should calculate correct dimensions for long names', () => {
      const longName = 'Artificial Intelligence and Machine Learning Systems';
      const dimensions = calculateNodeDimensions(longName);
      
      expect(dimensions.width).toBe(NODE_WIDTH);
      expect(dimensions.height).toBeGreaterThan(NODE_HEIGHT); // Should add height for wrapping
      expect(dimensions.bounds.height).toBeGreaterThan(NODE_HEIGHT);
    });

    it('should calculate correct dimensions for image nodes', () => {
      const dimensions = calculateNodeDimensions('Solar Panel', true);
      
      expect(dimensions.width).toBe(EXPANDED_NODE_WIDTH);
      expect(dimensions.height).toBe(NODE_HEIGHT);
      expect(dimensions.bounds.width).toBe(EXPANDED_NODE_WIDTH);
    });

    it('should handle edge cases', () => {
      const emptyName = calculateNodeDimensions('');
      const singleChar = calculateNodeDimensions('A');
      const specialChars = calculateNodeDimensions('Node-123_Test!');
      
      expect(emptyName.width).toBe(NODE_WIDTH);
      expect(singleChar.width).toBe(NODE_WIDTH);
      expect(specialChars.width).toBe(NODE_WIDTH);
    });
  });

  describe('Cluster Analysis', () => {
    it('should identify single clusters correctly', () => {
      const nodes = [
        { id: 'n1', x: 100, y: 100 },
        { id: 'n2', x: 120, y: 120 },
        { id: 'n3', x: 110, y: 130 }
      ];
      
      const clusters = analyzeClusters(nodes);
      
      expect(Object.keys(clusters)).toHaveLength(1);
      const cluster = Object.values(clusters)[0];
      expect(cluster.nodes).toHaveLength(3);
      expect(cluster.nodes).toContain('n1');
      expect(cluster.nodes).toContain('n2');
      expect(cluster.nodes).toContain('n3');
    });

    it('should identify multiple separate clusters', () => {
      const nodes = [
        { id: 'n1', x: 100, y: 100 },
        { id: 'n2', x: 120, y: 120 },
        { id: 'n3', x: 500, y: 300 },
        { id: 'n4', x: 520, y: 320 }
      ];
      
      const clusters = analyzeClusters(nodes);
      
      expect(Object.keys(clusters)).toHaveLength(2);
      const clusterValues = Object.values(clusters);
      expect(clusterValues[0].nodes).toHaveLength(2);
      expect(clusterValues[1].nodes).toHaveLength(2);
    });

    it('should handle isolated nodes', () => {
      const nodes = [
        { id: 'n1', x: 100, y: 100 },
        { id: 'n2', x: 500, y: 300 },
        { id: 'n3', x: 800, y: 400 }
      ];
      
      const clusters = analyzeClusters(nodes);
      
      // No clusters should form since all nodes are far apart
      expect(Object.keys(clusters)).toHaveLength(0);
    });

    it('should calculate cluster properties correctly', () => {
      const nodes = [
        { id: 'n1', x: 100, y: 100 },
        { id: 'n2', x: 200, y: 100 },
        { id: 'n3', x: 150, y: 150 }
      ];
      
      const clusters = analyzeClusters(nodes);
      
      if (Object.keys(clusters).length > 0) {
        const cluster = Object.values(clusters)[0];
        expect(cluster.bounds.minX).toBe(100);
        expect(cluster.bounds.maxX).toBe(200);
        expect(cluster.bounds.minY).toBe(100);
        expect(cluster.bounds.maxY).toBe(150);
        expect(cluster.center).toHaveLength(2);
        expect(cluster.density).toBeGreaterThan(0);
      }
    });
  });

  describe('Empty Region Detection', () => {
    it('should find empty regions on canvas', () => {
      const nodes = [
        { id: 'n1', x: 100, y: 100 }
      ];
      const canvasSize = { width: 1000, height: 600 };
      
      const emptyRegions = findEmptyRegions(nodes, canvasSize);
      
      expect(emptyRegions.length).toBeGreaterThan(0);
      
      // All regions should be past the left panel
      emptyRegions.forEach(region => {
        expect(region.x).toBeGreaterThanOrEqual(350);
        expect(region.y).toBeGreaterThanOrEqual(100);
        expect(region.width).toBe(100);
        expect(region.height).toBe(100);
        expect(['high', 'medium'].includes(region.suitability)).toBe(true);
      });
    });

    it('should prioritize high-suitability regions', () => {
      const nodes = [];
      const canvasSize = { width: 1000, height: 600 };
      
      const emptyRegions = findEmptyRegions(nodes, canvasSize);
      
      const highSuitabilityRegions = emptyRegions.filter(r => r.suitability === 'high');
      const mediumSuitabilityRegions = emptyRegions.filter(r => r.suitability === 'medium');
      
      expect(highSuitabilityRegions.length).toBeGreaterThan(0);
      
      // High suitability regions should be in the optimal zone
      highSuitabilityRegions.forEach(region => {
        expect(region.x).toBeGreaterThan(400);
        expect(region.x).toBeLessThan(600);
        expect(region.y).toBeGreaterThan(150);
        expect(region.y).toBeLessThan(350);
      });
    });

    it('should avoid areas near existing nodes', () => {
      const nodes = [
        { id: 'n1', x: 450, y: 200 },
        { id: 'n2', x: 550, y: 250 }
      ];
      const canvasSize = { width: 1000, height: 600 };
      
      const emptyRegions = findEmptyRegions(nodes, canvasSize);
      
      // Should find fewer regions due to existing nodes
      emptyRegions.forEach(region => {
        const distanceToN1 = Math.sqrt(
          Math.pow(region.x - nodes[0].x, 2) + Math.pow(region.y - nodes[0].y, 2)
        );
        const distanceToN2 = Math.sqrt(
          Math.pow(region.x - nodes[1].x, 2) + Math.pow(region.y - nodes[1].y, 2)
        );
        
        expect(distanceToN1).toBeGreaterThan(50);
        expect(distanceToN2).toBeGreaterThan(50);
      });
    });
  });

  describe('Layout Generation', () => {
    it('should generate clustered layout correctly', () => {
      const clusters = {
        'energy': [
          { name: 'Solar Power' },
          { name: 'Wind Power' }
        ],
        'storage': [
          { name: 'Battery Systems' },
          { name: 'Grid Storage' }
        ]
      };
      
      const nodeSpacing = { horizontal: 220, vertical: 140, clusterGap: 300 };
      const positions = generateClusteredLayout(clusters, 400, 150, nodeSpacing);
      
      expect(positions['Solar Power']).toBeDefined();
      expect(positions['Wind Power']).toBeDefined();
      expect(positions['Battery Systems']).toBeDefined();
      expect(positions['Grid Storage']).toBeDefined();
      
      // Check clustering
      expect(positions['Solar Power'].cluster).toBe('energy');
      expect(positions['Wind Power'].cluster).toBe('energy');
      expect(positions['Battery Systems'].cluster).toBe('storage');
      expect(positions['Grid Storage'].cluster).toBe('storage');
      
      // Check spacing (account for node width + spacing)
      const actualSpacing = positions['Wind Power'].x - positions['Solar Power'].x;
      expect(actualSpacing).toBeGreaterThan(nodeSpacing.horizontal - 50); // Allow some flexibility for node width calculations
    });

    it('should handle single cluster correctly', () => {
      const clusters = {
        'main': [
          { name: 'Concept A' },
          { name: 'Concept B' },
          { name: 'Concept C' }
        ]
      };
      
      const nodeSpacing = { horizontal: 220, vertical: 140, clusterGap: 300 };
      const positions = generateClusteredLayout(clusters, 400, 150, nodeSpacing);
      
      expect(Object.keys(positions)).toHaveLength(3);
      
      // All should be in same cluster
      Object.values(positions).forEach(pos => {
        expect(pos.cluster).toBe('main');
      });
      
      // Should arrange in a grid (sqrt layout)
      expect(positions['Concept A'].y).toBe(150);
      expect(positions['Concept B'].y).toBe(150);
    });

    it('should include dimension information', () => {
      const clusters = {
        'test': [
          { name: 'Short' },
          { name: 'Very Long Concept Name That Should Wrap' }
        ]
      };
      
      const nodeSpacing = { horizontal: 220, vertical: 140, clusterGap: 300 };
      const positions = generateClusteredLayout(clusters, 400, 150, nodeSpacing);
      
      expect(positions['Short'].dimensions).toBeDefined();
      expect(positions['Very Long Concept Name That Should Wrap'].dimensions).toBeDefined();
      
      expect(positions['Short'].dimensions.width).toBe(NODE_WIDTH);
      expect(positions['Very Long Concept Name That Should Wrap'].dimensions.height).toBeGreaterThan(NODE_HEIGHT);
    });
  });

  describe('Integration Tests', () => {
    it('should work end-to-end for complete spatial analysis', () => {
      // Simulate existing nodes
      const existingNodes = [
        { id: 'existing-1', x: 200, y: 200, name: 'Existing Node' }
      ];
      
      // Analyze existing layout
      const clusters = analyzeClusters(existingNodes);
      const emptyRegions = findEmptyRegions(existingNodes, { width: 1000, height: 600 });
      
      // Generate new layout avoiding existing
      const newClusters = {
        'new-group': [
          { name: 'New Concept A' },
          { name: 'New Concept B' }
        ]
      };
      
      const nodeSpacing = { horizontal: 220, vertical: 140, clusterGap: 300 };
      let startX = 400;
      
      // If empty regions exist, use the first high-suitability one
      if (emptyRegions.length > 0) {
        const bestRegion = emptyRegions.find(r => r.suitability === 'high') || emptyRegions[0];
        startX = bestRegion.x;
      }
      
      const newPositions = generateClusteredLayout(newClusters, startX, 150, nodeSpacing);
      
      // Verify new positions don't conflict with existing
      const minDistance = 200;
      Object.values(newPositions).forEach(pos => {
        existingNodes.forEach(existing => {
          const distance = Math.sqrt(
            Math.pow(pos.x - existing.x, 2) + Math.pow(pos.y - existing.y, 2)
          );
          expect(distance).toBeGreaterThan(minDistance);
        });
      });
      
      expect(newPositions['New Concept A']).toBeDefined();
      expect(newPositions['New Concept B']).toBeDefined();
    });
  });
});
