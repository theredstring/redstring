/**
 * Semantic Enrichment Service
 * 
 * Handles background resolution of external links and smart suggestions
 * for semantic web data integration.
 */

import { rdfResolver } from './rdfResolver.js';
import { sparqlClient } from './sparqlClient.js';

// Priority levels for resolution tasks
const PRIORITY = {
  USER_TRIGGERED: 1,    // User explicitly requested resolution
  BACKGROUND: 2,        // Background enrichment
  PERIODIC: 3           // Periodic re-resolution
};

// Resolution task status
const STATUS = {
  PENDING: 'pending',
  RUNNING: 'running',
  COMPLETED: 'completed',
  FAILED: 'failed',
  CANCELLED: 'cancelled'
};

export class SemanticEnrichment {
  constructor() {
    this.resolutionQueue = [];
    this.isProcessing = false;
    this.workers = new Map();
    this.maxConcurrentWorkers = 3;
    this.retryAttempts = 3;
    this.retryDelay = 5000; // 5 seconds
    
    // Start background processing
    this._startBackgroundProcessing();
  }

  /**
   * Add a resolution task to the queue
   * @param {Object} task - Resolution task
   * @returns {string} Task ID
   */
  addResolutionTask(task) {
    const taskId = this._generateTaskId();
    const enrichedTask = {
      id: taskId,
      status: STATUS.PENDING,
      priority: task.priority || PRIORITY.BACKGROUND,
      createdAt: Date.now(),
      attempts: 0,
      ...task
    };

    this.resolutionQueue.push(enrichedTask);
    this._sortQueue();
    
    // Trigger processing if not already running
    if (!this.isProcessing) {
      this._processQueue();
    }

    return taskId;
  }

  /**
   * Resolve external links for a node
   * @param {string} nodeId - Node identifier
   * @param {Array} externalLinks - Array of external link URIs
   * @param {Object} options - Resolution options
   * @returns {Promise<Object>} Resolution results
   */
  async resolveNodeLinks(nodeId, externalLinks, options = {}) {
    const taskId = this.addResolutionTask({
      type: 'resolve_links',
      nodeId,
      uris: externalLinks,
      priority: PRIORITY.USER_TRIGGERED,
      ...options
    });

    // Wait for completion
    return this._waitForTaskCompletion(taskId);
  }

  /**
   * Suggest external links for a node based on content
   * @param {string} nodeId - Node identifier
   * @param {Object} nodeData - Node data including name, description, etc.
   * @returns {Promise<Array>} Suggested external links
   */
  async suggestExternalLinks(nodeId, nodeData) {
    const suggestions = [];
    
    try {
      // Extract potential entities from node content
      const entities = this._extractEntities(nodeData);
      
      // Search Wikidata for each entity
      for (const entity of entities) {
        try {
          const results = await sparqlClient.searchEntities('wikidata', entity, 'Class');
          suggestions.push(...results.map(result => ({
            uri: result.uri,
            label: result.label,
            type: result.type,
            source: 'wikidata',
            confidence: this._calculateConfidence(entity, result.label),
            entity: entity
          })));
        } catch (error) {
          console.warn(`[Semantic Enrichment] Wikidata search failed for "${entity}":`, error);
        }
      }
      
      // Sort by confidence
      suggestions.sort((a, b) => b.confidence - a.confidence);
      
      return suggestions.slice(0, 10); // Return top 10 suggestions
    } catch (error) {
      console.error(`[Semantic Enrichment] Link suggestion failed for node ${nodeId}:`, error);
      return [];
    }
  }

  /**
   * Suggest equivalent classes for a node
   * @param {string} nodeId - Node identifier
   * @param {Array} existingTypes - Existing type URIs
   * @returns {Promise<Array>} Suggested equivalent classes
   */
  async suggestEquivalentClasses(nodeId, existingTypes) {
    const suggestions = [];
    
    for (const typeUri of existingTypes) {
      try {
        // Query multiple endpoints for equivalent classes
        const endpoints = ['wikidata', 'dbpedia', 'schema'];
        
        for (const endpoint of endpoints) {
          try {
            const equivalents = await sparqlClient.findEquivalentClasses(endpoint, typeUri);
            suggestions.push(...equivalents.map(uri => ({
              uri,
              source: endpoint,
              originalType: typeUri,
              confidence: 0.8 // High confidence for equivalent classes
            })));
          } catch (error) {
            console.warn(`[Semantic Enrichment] ${endpoint} equivalent class query failed:`, error);
          }
        }
      } catch (error) {
        console.warn(`[Semantic Enrichment] Equivalent class suggestion failed for type ${typeUri}:`, error);
      }
    }
    
    // Remove duplicates and sort by confidence
    const uniqueSuggestions = this._deduplicateSuggestions(suggestions);
    return uniqueSuggestions.sort((a, b) => b.confidence - a.confidence);
  }

  /**
   * Get task status
   * @param {string} taskId - Task identifier
   * @returns {Object} Task status
   */
  getTaskStatus(taskId) {
    const task = this.resolutionQueue.find(t => t.id === taskId);
    return task ? { ...task } : null;
  }

  /**
   * Cancel a resolution task
   * @param {string} taskId - Task identifier
   * @returns {boolean} Success status
   */
  cancelTask(taskId) {
    const task = this.resolutionQueue.find(t => t.id === taskId);
    if (task && task.status === STATUS.PENDING) {
      task.status = STATUS.CANCELLED;
      return true;
    }
    return false;
  }

  /**
   * Get queue statistics
   * @returns {Object} Queue statistics
   */
  getQueueStats() {
    const stats = {
      total: this.resolutionQueue.length,
      pending: 0,
      running: 0,
      completed: 0,
      failed: 0,
      cancelled: 0
    };

    for (const task of this.resolutionQueue) {
      stats[task.status]++;
    }

    return stats;
  }

  /**
   * Clear completed tasks from queue
   */
  clearCompletedTasks() {
    this.resolutionQueue = this.resolutionQueue.filter(
      task => ![STATUS.COMPLETED, STATUS.FAILED, STATUS.CANCELLED].includes(task.status)
    );
  }

  /**
   * Start background processing
   * @private
   */
  _startBackgroundProcessing() {
    // Process queue every 5 seconds
    setInterval(() => {
      if (!this.isProcessing && this.resolutionQueue.length > 0) {
        this._processQueue();
      }
    }, 5000);

    // Periodic re-resolution every hour
    setInterval(() => {
      this._schedulePeriodicResolution();
    }, 60 * 60 * 1000);
  }

  /**
   * Process the resolution queue
   * @private
   */
  async _processQueue() {
    if (this.isProcessing) return;
    
    this.isProcessing = true;
    
    try {
      while (this.resolutionQueue.length > 0 && this.workers.size < this.maxConcurrentWorkers) {
        const task = this.resolutionQueue.shift();
        
        if (task.status === STATUS.CANCELLED) {
          continue;
        }
        
        // Start worker for this task
        this._startWorker(task);
      }
    } finally {
      this.isProcessing = false;
    }
  }

  /**
   * Start a worker for a resolution task
   * @private
   */
  async _startWorker(task) {
    const worker = {
      taskId: task.id,
      startTime: Date.now(),
      status: STATUS.RUNNING
    };
    
    this.workers.set(task.id, worker);
    task.status = STATUS.RUNNING;
    
    try {
      const result = await this._executeTask(task);
      
      task.status = STATUS.COMPLETED;
      task.result = result;
      task.completedAt = Date.now();
      
    } catch (error) {
      task.status = STATUS.FAILED;
      task.error = error.message;
      task.failedAt = Date.now();
      
      // Retry if possible
      if (task.attempts < this.retryAttempts) {
        task.attempts++;
        task.status = STATUS.PENDING;
        task.priority = PRIORITY.BACKGROUND; // Lower priority for retries
        
        this.resolutionQueue.push(task);
        this._sortQueue();
      }
    } finally {
      this.workers.delete(task.id);
      
      // Continue processing if there are more tasks
      if (this.resolutionQueue.length > 0) {
        this._processQueue();
      }
    }
  }

  /**
   * Execute a resolution task
   * @private
   */
  async _executeTask(task) {
    switch (task.type) {
      case 'resolve_links':
        return await this._resolveLinks(task);
      case 'suggest_links':
        return await this._suggestLinks(task);
      case 'suggest_classes':
        return await this._suggestClasses(task);
      default:
        throw new Error(`Unknown task type: ${task.type}`);
    }
  }

  /**
   * Resolve external links
   * @private
   */
  async _resolveLinks(task) {
    const results = [];
    
    for (const uri of task.uris) {
      try {
        const resolved = await rdfResolver.resolveURI(uri, task.options);
        results.push({
          uri,
          status: 'resolved',
          data: resolved
        });
      } catch (error) {
        results.push({
          uri,
          status: 'failed',
          error: error.message
        });
      }
    }
    
    return results;
  }

  /**
   * Suggest external links
   * @private
   */
  async _suggestLinks(task) {
    return await this.suggestExternalLinks(task.nodeId, task.nodeData);
  }

  /**
   * Suggest equivalent classes
   * @private
   */
  async _suggestClasses(task) {
    return await this.suggestEquivalentClasses(task.nodeId, task.existingTypes);
  }

  /**
   * Schedule periodic resolution tasks
   * @private
   */
  _schedulePeriodicResolution() {
    // This would typically query the graph store for nodes with external links
    // and schedule re-resolution tasks
    console.log('[Semantic Enrichment] Scheduling periodic resolution tasks');
  }

  /**
   * Wait for task completion
   * @private
   */
  async _waitForTaskCompletion(taskId) {
    return new Promise((resolve, reject) => {
      const checkStatus = () => {
        const task = this.resolutionQueue.find(t => t.id === taskId);
        
        if (!task) {
          reject(new Error('Task not found'));
          return;
        }
        
        if (task.status === STATUS.COMPLETED) {
          resolve(task.result);
        } else if (task.status === STATUS.FAILED) {
          reject(new Error(task.error));
        } else if (task.status === STATUS.CANCELLED) {
          reject(new Error('Task cancelled'));
        } else {
          // Check again in 100ms
          setTimeout(checkStatus, 100);
        }
      };
      
      checkStatus();
    });
  }

  /**
   * Sort queue by priority and creation time
   * @private
   */
  _sortQueue() {
    this.resolutionQueue.sort((a, b) => {
      if (a.priority !== b.priority) {
        return a.priority - b.priority;
      }
      return a.createdAt - b.createdAt;
    });
  }

  /**
   * Generate unique task ID
   * @private
   */
  _generateTaskId() {
    return `task_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Extract potential entities from node data
   * @private
   */
  _extractEntities(nodeData) {
    const entities = [];
    const text = `${nodeData.name || ''} ${nodeData.description || ''}`.toLowerCase();
    
    // Simple entity extraction - can be enhanced with NLP
    const words = text.split(/\s+/).filter(word => 
      word.length > 3 && /^[a-zA-Z]+$/.test(word)
    );
    
    // Add capitalized words as potential entities
    const capitalized = text.match(/\b[A-Z][a-z]+\b/g) || [];
    
    entities.push(...words.slice(0, 5)); // Top 5 words
    entities.push(...capitalized.slice(0, 3)); // Top 3 capitalized
    
    return [...new Set(entities)]; // Remove duplicates
  }

  /**
   * Calculate confidence score for a suggestion
   * @private
   */
  _calculateConfidence(query, result) {
    const queryLower = query.toLowerCase();
    const resultLower = result.toLowerCase();
    
    if (queryLower === resultLower) return 1.0;
    if (resultLower.includes(queryLower)) return 0.9;
    if (queryLower.includes(resultLower)) return 0.8;
    
    // Calculate similarity based on common characters
    const commonChars = [...queryLower].filter(char => resultLower.includes(char)).length;
    const maxLength = Math.max(queryLower.length, resultLower.length);
    
    return commonChars / maxLength * 0.7;
  }

  /**
   * Remove duplicate suggestions
   * @private
   */
  _deduplicateSuggestions(suggestions) {
    const seen = new Set();
    return suggestions.filter(suggestion => {
      const key = suggestion.uri;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }
}

// Export singleton instance
export const semanticEnrichment = new SemanticEnrichment();

// Export utility functions
export const resolveNodeLinks = (nodeId, externalLinks, options) => 
  semanticEnrichment.resolveNodeLinks(nodeId, externalLinks, options);
export const suggestExternalLinks = (nodeId, nodeData) => 
  semanticEnrichment.suggestExternalLinks(nodeId, nodeData);
export const suggestEquivalentClasses = (nodeId, existingTypes) => 
  semanticEnrichment.suggestEquivalentClasses(nodeId, existingTypes);
export const getQueueStats = () => semanticEnrichment.getQueueStats();
