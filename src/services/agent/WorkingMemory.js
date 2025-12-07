/**
 * Working Memory for Agent Chains
 * Shared context across agent execution with event-driven updates
 */

import EventBus from './EventBus.js';

class WorkingMemory {
  constructor(sessionId = null) {
    this.sessionId = sessionId || `wm-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    this.context = new Map(); // key -> value
    this.metadata = new Map(); // key -> { source, timestamp, version }
    this.events = new EventBus();
    this.history = []; // Execution trace
    this.maxHistorySize = 500;
  }

  /**
   * Set a value in working memory
   * @param {string} key - Key to store under
   * @param {*} value - Value to store
   * @param {string} source - Source agent/node ID
   */
  set(key, value, source = 'unknown') {
    const timestamp = Date.now();
    const version = (this.metadata.get(key)?.version || 0) + 1;

    this.context.set(key, value);
    this.metadata.set(key, { source, timestamp, version });

    // Emit update event
    this.events.emit(`memory:${key}`, { key, value, source, timestamp, version });
    this.events.emit('memory:update', { key, value, source });

    // Record in history
    this.record('set', { key, value, source });
  }

  /**
   * Get a value from working memory
   * @param {string} key - Key to retrieve
   * @returns {*} Value or undefined
   */
  get(key) {
    return this.context.get(key);
  }

  /**
   * Get metadata for a key
   */
  getMetadata(key) {
    return this.metadata.get(key);
  }

  /**
   * Check if key exists
   */
  has(key) {
    return this.context.has(key);
  }

  /**
   * Delete a key
   */
  delete(key) {
    const hadKey = this.context.has(key);
    this.context.delete(key);
    this.metadata.delete(key);
    
    if (hadKey) {
      this.events.emit(`memory:${key}:deleted`, { key });
      this.events.emit('memory:delete', { key });
      this.record('delete', { key });
    }
  }

  /**
   * Get all keys
   */
  keys() {
    return Array.from(this.context.keys());
  }

  /**
   * Get all entries
   */
  entries() {
    return Array.from(this.context.entries());
  }

  /**
   * Clear all memory
   */
  clear() {
    const keys = this.keys();
    this.context.clear();
    this.metadata.clear();
    keys.forEach(key => {
      this.events.emit(`memory:${key}:deleted`, { key });
    });
    this.events.emit('memory:clear', {});
    this.record('clear', {});
  }

  /**
   * Record an execution event
   */
  record(type, data) {
    this.history.push({
      type,
      data,
      timestamp: Date.now()
    });

    if (this.history.length > this.maxHistorySize) {
      this.history.shift();
    }
  }

  /**
   * Get execution history
   */
  getHistory(filterType = null) {
    if (filterType) {
      return this.history.filter(e => e.type === filterType);
    }
    return [...this.history];
  }

  /**
   * Subscribe to memory updates
   */
  subscribe(eventName, handler) {
    return this.events.subscribe(eventName, handler);
  }

  /**
   * Emit a custom event
   */
  emit(eventName, data) {
    this.events.emit(eventName, data);
    this.record('event', { eventName, data });
  }

  /**
   * Export memory state (for debugging/persistence)
   */
  export() {
    return {
      sessionId: this.sessionId,
      context: Object.fromEntries(this.context),
      metadata: Object.fromEntries(this.metadata),
      history: this.history.slice(-100) // Last 100 entries
    };
  }

  /**
   * Import memory state
   */
  import(state) {
    if (state.context) {
      Object.entries(state.context).forEach(([key, value]) => {
        this.context.set(key, value);
      });
    }
    if (state.metadata) {
      Object.entries(state.metadata).forEach(([key, meta]) => {
        this.metadata.set(key, meta);
      });
    }
  }
}

export default WorkingMemory;



