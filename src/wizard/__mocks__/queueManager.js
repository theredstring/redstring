/**
 * Mock queue manager for testing
 */

import { vi } from 'vitest';

const mockEnqueue = vi.fn(() => 'mock-goal-id');
const mockDequeue = vi.fn();
const mockGetQueue = vi.fn(() => ({ 
  items: [], 
  inflight: new Map(),
  byId: new Map(),
  metrics: { enq: 0, deq: 0, ack: 0, nack: 0 }
}));

export { mockEnqueue, mockDequeue, mockGetQueue };

export default {
  enqueue: mockEnqueue,
  dequeue: mockDequeue,
  getQueue: mockGetQueue
};

