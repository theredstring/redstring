/**
 * Tests for AgentLoop
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { runAgent } from './AgentLoop.js';

describe('AgentLoop', () => {
  it('should be defined', () => {
    expect(runAgent).toBeDefined();
  });

  // TODO: Add more tests
  // - Test loop termination when no tool calls
  // - Test tool execution
  // - Test max iterations
  // - Test error handling
});

