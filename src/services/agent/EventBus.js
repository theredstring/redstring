/**
 * Event Bus for Agent Communication
 * Enables event-driven agent execution where agents can subscribe to events
 */

class EventBus {
  constructor() {
    this.listeners = new Map(); // eventName -> Set of handlers
    this.eventHistory = []; // For debugging/replay
    this.maxHistorySize = 1000;
  }

  /**
   * Subscribe to an event
   * @param {string} eventName - Event to listen for
   * @param {Function} handler - Handler function (event, data) => void
   * @returns {Function} Unsubscribe function
   */
  subscribe(eventName, handler) {
    if (!this.listeners.has(eventName)) {
      this.listeners.set(eventName, new Set());
    }
    this.listeners.get(eventName).add(handler);

    // Return unsubscribe function
    return () => {
      const handlers = this.listeners.get(eventName);
      if (handlers) {
        handlers.delete(handler);
        if (handlers.size === 0) {
          this.listeners.delete(eventName);
        }
      }
    };
  }

  /**
   * Emit an event to all subscribers
   * @param {string} eventName - Event name
   * @param {*} data - Event data
   */
  emit(eventName, data = null) {
    const handlers = this.listeners.get(eventName);
    if (handlers) {
      handlers.forEach(handler => {
        try {
          handler(eventName, data);
        } catch (error) {
          console.error(`[EventBus] Error in handler for ${eventName}:`, error);
        }
      });
    }

    // Record in history
    this.eventHistory.push({
      event: eventName,
      data,
      timestamp: Date.now()
    });

    // Trim history if too large
    if (this.eventHistory.length > this.maxHistorySize) {
      this.eventHistory.shift();
    }
  }

  /**
   * Remove all listeners for an event
   */
  clear(eventName) {
    this.listeners.delete(eventName);
  }

  /**
   * Remove all listeners
   */
  clearAll() {
    this.listeners.clear();
    this.eventHistory = [];
  }

  /**
   * Get event history (for debugging)
   */
  getHistory(filterEvent = null) {
    if (filterEvent) {
      return this.eventHistory.filter(e => e.event === filterEvent);
    }
    return [...this.eventHistory];
  }
}

export default EventBus;



