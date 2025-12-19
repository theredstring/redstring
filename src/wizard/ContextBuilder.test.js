/**
 * Tests for ContextBuilder
 */

import { describe, it, expect } from 'vitest';
import { buildContext } from './ContextBuilder.js';

describe('ContextBuilder', () => {
  it('should build context from graph state', () => {
    const graphState = {
      graphs: [{ id: '1', name: 'Test Graph' }],
      nodePrototypes: [],
      edges: [],
      activeGraphId: '1'
    };
    
    const context = buildContext(graphState);
    expect(context).toContain('Test Graph');
  });

  // TODO: Add more tests
});

