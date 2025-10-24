/**
 * Rapid Synchronization Engine
 * Real-time local state with background Git persistence
 * Achieves sub-5-second persistence with instant UI updates
 */

import { SemanticProviderFactory } from './gitNativeProvider.js';

export class SemanticSyncEngine {
  constructor(providerConfig) {
    this.provider = SemanticProviderFactory.createProvider(providerConfig);
    this.localState = new Map(); // Instant updates
    this.pendingCommits = [];
    this.commitInterval = 5000; // 5-second auto-commits
    this.isCommitting = false;
    this.subscribers = new Set();
    this.statusCallbacks = new Set();
    
    this.startCommitLoop();
  }

  /**
   * Subscribe to state changes
   * @param {Function} callback - Called when state changes
   * @returns {Function} - Unsubscribe function
   */
  subscribe(callback) {
    this.subscribers.add(callback);
    return () => this.subscribers.delete(callback);
  }

  /**
   * Subscribe to status updates
   * @param {Function} callback - Called with status updates
   * @returns {Function} - Unsubscribe function
   */
  onStatusChange(callback) {
    this.statusCallbacks.add(callback);
    return () => this.statusCallbacks.delete(callback);
  }

  /**
   * Notify subscribers of state changes
   */
  notifySubscribers() {
    this.subscribers.forEach(callback => {
      try {
        callback(this.localState);
      } catch (error) {
        console.error('[SemanticSync] Subscriber error:', error);
      }
    });
  }

  /**
   * Notify status callbacks
   * @param {string} status - Status message
   * @param {string} type - Status type ('info', 'success', 'error')
   */
  notifyStatus(status, type = 'info') {
    this.statusCallbacks.forEach(callback => {
      try {
        callback({ status, type, timestamp: new Date().toISOString() });
      } catch (error) {
        console.error('[SemanticSync] Status callback error:', error);
      }
    });
  }

  /**
   * Update a concept in local state (instant)
   * @param {string} id - Concept ID
   * @param {Object} data - Concept data
   */
  updateConcept(id, data) {
    this.localState.set(id, data);
    this.pendingCommits.push({
      type: 'update',
      id,
      data,
      timestamp: Date.now()
    });
    
    this.notifySubscribers();
    this.notifyStatus('Saving...', 'info');
  }

  /**
   * Create a new concept
   * @param {string} id - Concept ID
   * @param {Object} data - Concept data
   */
  createConcept(id, data) {
    this.localState.set(id, data);
    this.pendingCommits.push({
      type: 'create',
      id,
      data,
      timestamp: Date.now()
    });
    
    this.notifySubscribers();
    this.notifyStatus('Creating concept...', 'info');
  }

  /**
   * Delete a concept
   * @param {string} id - Concept ID
   */
  deleteConcept(id) {
    this.localState.delete(id);
    this.pendingCommits.push({
      type: 'delete',
      id,
      timestamp: Date.now()
    });
    
    this.notifySubscribers();
    this.notifyStatus('Deleting concept...', 'info');
  }

  /**
   * Get a concept from local state
   * @param {string} id - Concept ID
   * @returns {Object|null} Concept data or null
   */
  getConcept(id) {
    return this.localState.get(id) || null;
  }

  /**
   * Get all concepts from local state
   * @returns {Array} Array of concept objects
   */
  getAllConcepts() {
    return Array.from(this.localState.values());
  }

  /**
   * Start the background commit loop
   */
  startCommitLoop() {
    setInterval(async () => {
      if (this.pendingCommits.length > 0 && !this.isCommitting) {
        await this.batchCommit();
      }
    }, this.commitInterval);
  }

  /**
   * Batch commit pending changes
   */
  async batchCommit() {
    if (this.isCommitting || this.pendingCommits.length === 0) {
      return;
    }

    this.isCommitting = true;
    const commits = [...this.pendingCommits];
    this.pendingCommits = [];

    try {
      this.notifyStatus('Syncing to ' + this.provider.name + '...', 'info');
      
      // Group commits by type for efficient processing
      const updates = commits.filter(c => c.type === 'update');
      const creates = commits.filter(c => c.type === 'create');
      const deletes = commits.filter(c => c.type === 'delete');

      // Process updates and creates
      for (const commit of [...updates, ...creates]) {
        const ttlContent = this.conceptToTTL(commit.id, commit.data);
        await this.provider.writeSemanticFile(
          `vocabulary/concepts/${commit.id}`,
          ttlContent
        );
      }

      // Process deletes (mark as deleted in TTL)
      for (const commit of deletes) {
        const ttlContent = this.conceptToTTL(commit.id, { 
          deleted: true, 
          deletedAt: new Date().toISOString() 
        });
        await this.provider.writeSemanticFile(
          `vocabulary/concepts/${commit.id}`,
          ttlContent
        );
      }

      // Commit all changes
      await this.provider.commitChanges(
        `Batch update: ${commits.length} changes`,
        commits.map(c => `vocabulary/concepts/${c.id}.ttl`)
      );

      this.notifyStatus('✓ Synced to ' + this.provider.name, 'success');
      
    } catch (error) {
      console.error('[SemanticSync] Batch commit failed:', error);
      this.notifyStatus('✗ Sync failed: ' + error.message, 'error');
      
      // Re-add failed commits to pending queue
      this.pendingCommits.unshift(...commits);
    } finally {
      this.isCommitting = false;
    }
  }

  /**
   * Convert concept data to TTL format
   * @param {string} id - Concept ID
   * @param {Object} data - Concept data
   * @returns {string} TTL content
   */
  conceptToTTL(id, data) {
    const prefixes = [
      '@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .',
      '@prefix schema: <http://schema.org/> .',
      '@prefix redstring: <https://redstring.io/vocab/> .',
      '@prefix foaf: <http://xmlns.com/foaf/0.1/> .',
      '@prefix dcterms: <http://purl.org/dc/terms/> .'
    ].join('\n');

    const conceptUri = `redstring:${id}`;
    
    let triples = [
      `${conceptUri} a redstring:Concept ;`,
      `    rdfs:label "${data.name || id}" ;`,
      `    dcterms:created "${data.createdAt || new Date().toISOString()}" ;`,
      `    dcterms:modified "${new Date().toISOString()}" .`
    ];

    if (data.description) {
      triples.push(`${conceptUri} rdfs:comment "${data.description}" .`);
    }

    if (data.color) {
      triples.push(`${conceptUri} schema:color "${data.color}" .`);
    }

    if (data.deleted) {
      triples.push(`${conceptUri} redstring:deleted true ;`);
      triples.push(`    redstring:deletedAt "${data.deletedAt}" .`);
    }

    // Add relationships
    if (data.relationships) {
      for (const [relationType, targets] of Object.entries(data.relationships)) {
        if (Array.isArray(targets)) {
          targets.forEach(target => {
            triples.push(`${conceptUri} redstring:${relationType} redstring:${target} .`);
          });
        }
      }
    }

    return `${prefixes}\n\n${triples.join('\n')}`;
  }

  /**
   * Load concepts from provider
   */
  async loadFromProvider() {
    try {
      this.notifyStatus('Loading from ' + this.provider.name + '...', 'info');
      
      // List all concept files
      const files = await this.provider.listSemanticFiles();
      const conceptFiles = files.filter(f => 
        f.path.startsWith('vocabulary/concepts/') && 
        f.path.endsWith('.ttl')
      );

      // Load each concept
      for (const file of conceptFiles) {
        const conceptId = file.path
          .replace('vocabulary/concepts/', '')
          .replace('.ttl', '');
        
        try {
          const ttlContent = await this.provider.readSemanticFile(
            `vocabulary/concepts/${conceptId}`
          );
          const conceptData = this.ttlToConcept(ttlContent);
          
          if (!conceptData.deleted) {
            this.localState.set(conceptId, conceptData);
          }
        } catch (error) {
          console.warn(`[SemanticSync] Failed to load concept ${conceptId}:`, error);
        }
      }

      this.notifySubscribers();
      this.notifyStatus('✓ Loaded from ' + this.provider.name, 'success');
      
    } catch (error) {
      console.error('[SemanticSync] Load failed:', error);
      this.notifyStatus('✗ Load failed: ' + error.message, 'error');
    }
  }

  /**
   * Convert TTL content to concept data
   * @param {string} ttlContent - TTL content
   * @returns {Object} Concept data
   */
  ttlToConcept(ttlContent) {
    const concept = {
      name: '',
      description: '',
      color: '',
      createdAt: new Date().toISOString(),
      relationships: {}
    };

    // Simple TTL parsing (in production, use a proper TTL parser)
    const lines = ttlContent.split('\n');
    
    for (const line of lines) {
      const trimmed = line.trim();
      
      if (trimmed.includes('rdfs:label')) {
        const match = trimmed.match(/"([^"]+)"/);
        if (match) concept.name = match[1];
      }
      
      if (trimmed.includes('rdfs:comment')) {
        const match = trimmed.match(/"([^"]+)"/);
        if (match) concept.description = match[1];
      }
      
      if (trimmed.includes('schema:color')) {
        const match = trimmed.match(/"([^"]+)"/);
        if (match) concept.color = match[1];
      }
      
      if (trimmed.includes('dcterms:created')) {
        const match = trimmed.match(/"([^"]+)"/);
        if (match) concept.createdAt = match[1];
      }
      
      if (trimmed.includes('redstring:deleted')) {
        concept.deleted = true;
      }
      
      // Parse relationships - updated regex to capture full relationship names
      const relationMatch = trimmed.match(/redstring:([a-zA-Z0-9_-]+)\s+redstring:([a-zA-Z0-9_-]+)/);
      if (relationMatch) {
        const [, relationType, targetId] = relationMatch;
        if (!concept.relationships[relationType]) {
          concept.relationships[relationType] = [];
        }
        concept.relationships[relationType].push(targetId);
      }
    }

    return concept;
  }

  /**
   * Force immediate sync
   */
  async forceSync() {
    if (this.pendingCommits.length > 0) {
      await this.batchCommit();
    }
  }

  /**
   * Get sync status
   * @returns {Object} Sync status information
   */
  getSyncStatus() {
    return {
      provider: this.provider.name,
      pendingCommits: this.pendingCommits.length,
      isCommitting: this.isCommitting,
      lastSync: this.lastSyncTime,
      localConcepts: this.localState.size
    };
  }

  /**
   * Export full semantic graph
   * @returns {Promise<Object>} Complete semantic archive
   */
  async exportFullGraph() {
    return await this.provider.exportFullGraph();
  }

  /**
   * Import full semantic graph
   * @param {Object} archive - Semantic archive
   */
  async importFullGraph(archive) {
    await this.provider.importFullGraph(archive);
    await this.loadFromProvider();
  }

  /**
   * Migrate to a different provider
   * @param {Object} newProviderConfig - New provider configuration
   */
  async migrateProvider(newProviderConfig) {
    try {
      this.notifyStatus('Exporting from ' + this.provider.name + '...', 'info');
      const fullGraph = await this.exportFullGraph();
      
      const newProvider = SemanticProviderFactory.createProvider(newProviderConfig);
      this.notifyStatus('Importing to ' + newProvider.name + '...', 'info');
      await newProvider.importFullGraph(fullGraph);
      
      // Switch to new provider
      this.provider = newProvider;
      
      this.notifyStatus('✓ Migration complete', 'success');
      
    } catch (error) {
      console.error('[SemanticSync] Migration failed:', error);
      this.notifyStatus('✗ Migration failed: ' + error.message, 'error');
      throw error;
    }
  }

  /**
   * Set up redundant storage with multiple providers
   * @param {Array} backupProviders - Array of backup provider configs
   */
  async setupRedundantStorage(backupProviders) {
    this.backupProviders = backupProviders.map(config => 
      SemanticProviderFactory.createProvider(config)
    );
    
    this.notifyStatus('Redundant storage enabled with ' + this.backupProviders.length + ' backups', 'info');
  }

  /**
   * Write with redundancy to backup providers
   * @param {string} path - File path
   * @param {string} content - File content
   */
  async writeWithRedundancy(path, content) {
    // Write to primary provider
    await this.provider.writeSemanticFile(path, content);
    
    // Async backup to other providers
    if (this.backupProviders) {
      this.backupProviders.forEach(backup => {
        backup.writeSemanticFile(path, content).catch(error => {
          console.warn('[SemanticSync] Backup write failed:', error);
        });
      });
    }
  }
} 