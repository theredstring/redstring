/**
 * Tests for ContextBuilder
 */

import { describe, it, expect } from 'vitest';
import { buildContext, truncateContext } from './ContextBuilder.js';

describe('ContextBuilder', () => {
  describe('buildContext', () => {
    it('returns message for empty/null state', () => {
      const context = buildContext(null);
      expect(context).toBe('No graph state available.');
      
      const context2 = buildContext(undefined);
      expect(context2).toBe('No graph state available.');
    });

    it('returns "No webs yet" when no graphs exist', () => {
      const graphState = {
        graphs: [],
        nodePrototypes: [],
        edges: []
      };
      
      const context = buildContext(graphState);
      expect(context).toContain('No webs yet');
    });

    it('lists available graphs when no active graph', () => {
      const graphState = {
        graphs: [
          { id: '1', name: 'Graph One' },
          { id: '2', name: 'Graph Two' },
          { id: '3', name: 'Graph Three' }
        ],
        nodePrototypes: [],
        edges: []
      };
      
      const context = buildContext(graphState);
      expect(context).toContain('AVAILABLE WEBS');
      expect(context).toContain('Graph One');
      expect(context).toContain('Graph Two');
      expect(context).toContain('3 total');
    });

    it('shows "Empty" status for active graph with no nodes', () => {
      const graphState = {
        graphs: [
          { 
            id: '1', 
            name: 'Test Graph',
            instances: {},
            edgeIds: []
          }
        ],
        nodePrototypes: [],
        edges: [],
        activeGraphId: '1'
      };
      
      const context = buildContext(graphState);
      expect(context).toContain('CURRENT WEB');
      expect(context).toContain('Test Graph');
      expect(context).toContain('Empty');
      expect(context).toContain('perfect for populating');
    });

    it('shows node count and names for active graph with nodes', () => {
      const graphState = {
        graphs: [
          { 
            id: '1', 
            name: 'Test Graph',
            instances: {
              'inst-1': { id: 'inst-1', prototypeId: 'proto-1' },
              'inst-2': { id: 'inst-2', prototypeId: 'proto-2' }
            },
            edgeIds: ['edge-1']
          }
        ],
        nodePrototypes: [
          { id: 'proto-1', name: 'Node One', color: '#FF0000' },
          { id: 'proto-2', name: 'Node Two', color: '#00FF00' }
        ],
        edges: [],
        activeGraphId: '1'
      };
      
      const context = buildContext(graphState);
      expect(context).toContain('CURRENT WEB');
      expect(context).toContain('Test Graph');
      expect(context).toContain('2 Thing');
      expect(context).toContain('1 Connection');
      expect(context).toContain('Existing Things: Node One, Node Two');
    });

    it('handles array instances format', () => {
      const graphState = {
        graphs: [
          { 
            id: '1', 
            name: 'Test Graph',
            instances: [
              { id: 'inst-1', prototypeId: 'proto-1' }
            ],
            edgeIds: []
          }
        ],
        nodePrototypes: [
          { id: 'proto-1', name: 'Node One', color: '#FF0000' }
        ],
        edges: [],
        activeGraphId: '1'
      };
      
      const context = buildContext(graphState);
      expect(context).toContain('1 Thing');
      expect(context).toContain('Node One');
    });

    it('limits node names to 10', () => {
      const graphState = {
        graphs: [
          { 
            id: '1', 
            name: 'Test Graph',
            instances: Array.from({ length: 15 }, (_, i) => ({
              id: `inst-${i}`,
              prototypeId: `proto-${i}`
            })),
            edgeIds: []
          }
        ],
        nodePrototypes: Array.from({ length: 15 }, (_, i) => ({
          id: `proto-${i}`,
          name: `Node ${i}`,
          color: '#FF0000'
        })),
        edges: [],
        activeGraphId: '1'
      };
      
      const context = buildContext(graphState);
      expect(context).toContain('15 Thing');
      // Should only show first 10 names
      const namesMatch = context.match(/Existing Things: (.+)/);
      expect(namesMatch).toBeTruthy();
      const names = namesMatch[1].split(', ');
      expect(names.length).toBeLessThanOrEqual(10);
      expect(context).toContain('...');
    });

    it('extracts color palette from prototypes', () => {
      const graphState = {
        graphs: [
          { 
            id: '1', 
            name: 'Test Graph',
            instances: {},
            edgeIds: []
          }
        ],
        nodePrototypes: [
          { id: 'proto-1', name: 'Node One', color: '#FF0000' },
          { id: 'proto-2', name: 'Node Two', color: '#00FF00' },
          { id: 'proto-3', name: 'Node Three', color: '#0000FF' }
        ],
        edges: [],
        activeGraphId: '1'
      };
      
      const context = buildContext(graphState);
      expect(context).toContain('Color palette');
      expect(context).toContain('#FF0000');
      expect(context).toContain('#00FF00');
      expect(context).toContain('#0000FF');
    });

    it('limits color palette to 8 colors', () => {
      const graphState = {
        graphs: [
          { 
            id: '1', 
            name: 'Test Graph',
            instances: {},
            edgeIds: []
          }
        ],
        nodePrototypes: Array.from({ length: 15 }, (_, i) => ({
          id: `proto-${i}`,
          name: `Node ${i}`,
          color: `#${i.toString(16).padStart(6, '0')}`
        })),
        edges: [],
        activeGraphId: '1'
      };
      
      const context = buildContext(graphState);
      const colorMatch = context.match(/Color palette in use: (.+)/);
      expect(colorMatch).toBeTruthy();
      const colors = colorMatch[1].split(', ');
      expect(colors.length).toBeLessThanOrEqual(8);
      expect(context).toContain('...');
    });

    it('handles missing optional fields gracefully', () => {
      const graphState = {
        graphs: [
          { 
            id: '1', 
            name: 'Test Graph'
            // Missing instances, edgeIds
          }
        ],
        // Missing nodePrototypes, edges
        activeGraphId: '1'
      };
      
      const context = buildContext(graphState);
      expect(context).toContain('Test Graph');
      expect(context).toContain('Empty');
    });
  });

  describe('truncateContext', () => {
    it('returns unchanged context if under maxLength', () => {
      const shortContext = 'Short context';
      expect(truncateContext(shortContext, 100)).toBe(shortContext);
    });

    it('truncates at sentence boundary when possible', () => {
      const longContext = 'Sentence one. Sentence two. Sentence three. ' + 'x'.repeat(5000);
      const truncated = truncateContext(longContext, 100);
      expect(truncated.length).toBeLessThanOrEqual(100);
      expect(truncated).toContain('...');
    });

    it('truncates at newline boundary when possible', () => {
      const longContext = 'Line one\nLine two\nLine three\n' + 'x'.repeat(5000);
      const truncated = truncateContext(longContext, 100);
      expect(truncated.length).toBeLessThanOrEqual(100);
      expect(truncated).toContain('...');
    });

    it('truncates at maxLength if no good boundary found', () => {
      const longContext = 'x'.repeat(5000);
      const truncated = truncateContext(longContext, 100);
      expect(truncated.length).toBeLessThanOrEqual(100);
      expect(truncated).toContain('...');
    });

    it('uses default maxLength of 4000', () => {
      const longContext = 'x'.repeat(5000);
      const truncated = truncateContext(longContext);
      expect(truncated.length).toBeLessThanOrEqual(4000);
    });
  });
});
