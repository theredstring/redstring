import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

// Mock the provider factory
vi.mock('../../src/services/gitNativeProvider.js', () => ({
  SemanticProviderFactory: {
    createProvider: vi.fn()
  }
}));

import { SemanticSyncEngine } from '../../src/services/semanticSyncEngine.js';
import { SemanticProviderFactory } from '../../src/services/gitNativeProvider.js';


describe('SemanticSyncEngine', () => {
  let mockProvider;
  let syncEngine;
  let statusCallback;
  let stateCallback;
  let setIntervalSpy;
  let clearIntervalSpy;

  beforeEach(() => {
    vi.clearAllMocks();
    
    // Mock timers
    vi.useFakeTimers();
    
    // Spy on setInterval and clearInterval
    setIntervalSpy = vi.spyOn(global, 'setInterval');
    clearIntervalSpy = vi.spyOn(global, 'clearInterval');
    
    // Create mock provider
    mockProvider = {
      name: 'Test Provider',
      writeSemanticFile: vi.fn().mockResolvedValue({ sha: 'abc123' }),
      readSemanticFile: vi.fn().mockResolvedValue('test content'),
      commitChanges: vi.fn().mockResolvedValue(),
      listSemanticFiles: vi.fn().mockResolvedValue([
        { path: 'vocabulary/concepts/test.ttl', name: 'test.ttl' }
      ]),
      exportFullGraph: vi.fn().mockResolvedValue({
        provider: 'test',
        files: { 'test.ttl': 'test content' }
      }),
      importFullGraph: vi.fn().mockResolvedValue(),
      isAvailable: vi.fn().mockResolvedValue(true)
    };

    SemanticProviderFactory.createProvider.mockReturnValue(mockProvider);

    // Create sync engine
    const providerConfig = {
      type: 'github',
      user: 'testuser',
      repo: 'testrepo',
      token: 'testtoken'
    };

    syncEngine = new SemanticSyncEngine(providerConfig);

    // Set up callbacks
    statusCallback = vi.fn();
    stateCallback = vi.fn();
    
    syncEngine.onStatusChange(statusCallback);
    syncEngine.subscribe(stateCallback);
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
  });

  describe('Initialization', () => {
    it('should create sync engine with provider', () => {
      expect(syncEngine.provider).toBe(mockProvider);
      expect(syncEngine.localState).toBeInstanceOf(Map);
      expect(syncEngine.pendingCommits).toEqual([]);
      expect(syncEngine.commitInterval).toBe(5000);
    });

    it('should start commit loop on initialization', () => {
      expect(setIntervalSpy).toHaveBeenCalledWith(expect.any(Function), 5000);
    });
  });

  describe('State Management', () => {
    it('should update concept in local state', () => {
      const conceptData = {
        name: 'Test Concept',
        description: 'Test description',
        color: '#ff0000'
      };

      syncEngine.updateConcept('test-id', conceptData);

      expect(syncEngine.getConcept('test-id')).toEqual(conceptData);
      expect(syncEngine.pendingCommits).toHaveLength(1);
      expect(syncEngine.pendingCommits[0]).toEqual({
        type: 'update',
        id: 'test-id',
        data: conceptData,
        timestamp: expect.any(Number)
      });
    });

    it('should create new concept', () => {
      const conceptData = {
        name: 'New Concept',
        description: 'New description'
      };

      syncEngine.createConcept('new-id', conceptData);

      expect(syncEngine.getConcept('new-id')).toEqual(conceptData);
      expect(syncEngine.pendingCommits).toHaveLength(1);
      expect(syncEngine.pendingCommits[0]).toEqual({
        type: 'create',
        id: 'new-id',
        data: conceptData,
        timestamp: expect.any(Number)
      });
    });

    it('should delete concept', () => {
      // First create a concept
      syncEngine.createConcept('delete-id', { name: 'To Delete' });
      
      // Then delete it
      syncEngine.deleteConcept('delete-id');

      expect(syncEngine.getConcept('delete-id')).toBeNull();
      expect(syncEngine.pendingCommits).toHaveLength(2);
      expect(syncEngine.pendingCommits[1]).toEqual({
        type: 'delete',
        id: 'delete-id',
        timestamp: expect.any(Number)
      });
    });

    it('should get all concepts', () => {
      syncEngine.createConcept('concept1', { name: 'Concept 1' });
      syncEngine.createConcept('concept2', { name: 'Concept 2' });

      const allConcepts = syncEngine.getAllConcepts();

      expect(allConcepts).toHaveLength(2);
      expect(allConcepts[0]).toEqual({ name: 'Concept 1' });
      expect(allConcepts[1]).toEqual({ name: 'Concept 2' });
    });
  });

  describe('Subscription System', () => {
    it('should notify subscribers of state changes', () => {
      syncEngine.updateConcept('test-id', { name: 'Test' });

      expect(stateCallback).toHaveBeenCalledWith(syncEngine.localState);
    });

    it('should notify status callbacks', () => {
      syncEngine.updateConcept('test-id', { name: 'Test' });

      expect(statusCallback).toHaveBeenCalledWith({
        status: 'Saving...',
        type: 'info',
        timestamp: expect.any(String)
      });
    });

    it('should handle subscriber errors gracefully', () => {
      const errorCallback = vi.fn().mockImplementation(() => {
        throw new Error('Subscriber error');
      });

      syncEngine.subscribe(errorCallback);
      
      // Should not throw
      expect(() => {
        syncEngine.updateConcept('test-id', { name: 'Test' });
      }).not.toThrow();
    });
  });

  describe('Batch Commit Process', () => {
    it('should batch commit pending changes', async () => {
      syncEngine.updateConcept('concept1', { name: 'Concept 1' });
      syncEngine.createConcept('concept2', { name: 'Concept 2' });

      // Call batchCommit directly instead of trying to access setInterval callback
      await syncEngine.batchCommit();

      expect(mockProvider.writeSemanticFile).toHaveBeenCalledTimes(2);
      expect(mockProvider.writeSemanticFile).toHaveBeenCalledWith(
        'vocabulary/concepts/concept1',
        expect.stringContaining('Concept 1')
      );
      expect(mockProvider.writeSemanticFile).toHaveBeenCalledWith(
        'vocabulary/concepts/concept2',
        expect.stringContaining('Concept 2')
      );
      expect(mockProvider.commitChanges).toHaveBeenCalledWith(
        'Batch update: 2 changes',
        ['vocabulary/concepts/concept1.ttl', 'vocabulary/concepts/concept2.ttl']
      );
    });

    it('should handle commit failures gracefully', async () => {
      mockProvider.writeSemanticFile.mockRejectedValueOnce(new Error('Write failed'));

      syncEngine.updateConcept('concept1', { name: 'Concept 1' });

      // Call batchCommit directly instead of trying to access setInterval callback
      await syncEngine.batchCommit();

      expect(statusCallback).toHaveBeenCalledWith({
        status: '✗ Sync failed: Write failed',
        type: 'error',
        timestamp: expect.any(String)
      });

      // Failed commits should be re-added to pending queue
      expect(syncEngine.pendingCommits).toHaveLength(1);
    });

    it('should not commit when already committing', async () => {
      syncEngine.isCommitting = true;
      syncEngine.updateConcept('concept1', { name: 'Concept 1' });

      // Call batchCommit directly instead of trying to access setInterval callback
      await syncEngine.batchCommit();

      expect(mockProvider.writeSemanticFile).not.toHaveBeenCalled();
    });

    it('should handle empty pending commits', async () => {
      // Call batchCommit directly instead of trying to access setInterval callback
      await syncEngine.batchCommit();

      expect(mockProvider.writeSemanticFile).not.toHaveBeenCalled();
    });
  });

  describe('TTL Conversion', () => {
    it('should convert concept to TTL format', () => {
      const conceptData = {
        name: 'Test Concept',
        description: 'Test description',
        color: '#ff0000',
        relationships: {
          influences: ['concept2', 'concept3'],
          references: ['concept4']
        }
      };

      const ttl = syncEngine.conceptToTTL('test-id', conceptData);

      expect(ttl).toContain('@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#>');
      expect(ttl).toContain('redstring:test-id a redstring:Concept');
      expect(ttl).toContain('rdfs:label "Test Concept"');
      expect(ttl).toContain('rdfs:comment "Test description"');
      expect(ttl).toContain('schema:color "#ff0000"');
      expect(ttl).toContain('redstring:influences redstring:concept2');
      expect(ttl).toContain('redstring:influences redstring:concept3');
      expect(ttl).toContain('redstring:references redstring:concept4');
    });

    it('should handle deleted concepts', () => {
      const conceptData = {
        name: 'Deleted Concept',
        deleted: true,
        deletedAt: '2023-01-01T00:00:00.000Z'
      };

      const ttl = syncEngine.conceptToTTL('deleted-id', conceptData);

      expect(ttl).toContain('redstring:deleted true');
      expect(ttl).toContain('redstring:deletedAt "2023-01-01T00:00:00.000Z"');
    });

    it('should convert TTL back to concept data', () => {
      const ttlContent = `
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
@prefix schema: <http://schema.org/> .
@prefix redstring: <https://redstring.io/vocab/> .

redstring:test-id a redstring:Concept ;
    rdfs:label "Test Concept" ;
    rdfs:comment "Test description" ;
    schema:color "#ff0000" ;
    redstring:influences redstring:concept2 ;
    redstring:references redstring:concept3 .
`;

      const concept = syncEngine.ttlToConcept(ttlContent);

      expect(concept.name).toBe('Test Concept');
      expect(concept.description).toBe('Test description');
      expect(concept.color).toBe('#ff0000');
      expect(concept.relationships.influences).toContain('concept2');
      expect(concept.relationships.references).toContain('concept3');
    });
  });

  describe('Provider Integration', () => {
    it('should load concepts from provider', async () => {
      mockProvider.readSemanticFile.mockResolvedValue(`
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
redstring:test a redstring:Concept ;
    rdfs:label "Loaded Concept" ;
    rdfs:comment "Loaded from provider" .
`);

      await syncEngine.loadFromProvider();

      expect(mockProvider.listSemanticFiles).toHaveBeenCalled();
      expect(mockProvider.readSemanticFile).toHaveBeenCalledWith('vocabulary/concepts/test');
      
      const loadedConcept = syncEngine.getConcept('test');
      expect(loadedConcept.name).toBe('Loaded Concept');
      expect(loadedConcept.description).toBe('Loaded from provider');
    });

    it('should handle load failures gracefully', async () => {
      mockProvider.listSemanticFiles.mockRejectedValue(new Error('Load failed'));

      await syncEngine.loadFromProvider();

      expect(statusCallback).toHaveBeenCalledWith({
        status: '✗ Load failed: Load failed',
        type: 'error',
        timestamp: expect.any(String)
      });
    });

    it('should export full graph', async () => {
      const archive = await syncEngine.exportFullGraph();

      expect(mockProvider.exportFullGraph).toHaveBeenCalled();
      expect(archive).toEqual({
        provider: 'test',
        files: { 'test.ttl': 'test content' }
      });
    });

    it('should import full graph', async () => {
      const archive = {
        provider: 'test',
        files: { 'test.ttl': 'test content' }
      };

      mockProvider.readSemanticFile.mockResolvedValue(`
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
redstring:imported-concept a redstring:Concept ;
    rdfs:label "Imported Concept" .
`);

      await syncEngine.importFullGraph(archive);

      expect(mockProvider.importFullGraph).toHaveBeenCalledWith(archive);
      expect(mockProvider.listSemanticFiles).toHaveBeenCalled();
    });
  });

  describe('Migration and Redundancy', () => {
    it('should migrate to new provider', async () => {
      const newProviderConfig = {
        type: 'gitea',
        endpoint: 'https://git.example.com',
        user: 'newuser',
        repo: 'newrepo',
        token: 'newtoken'
      };

      const newMockProvider = {
        name: 'New Provider',
        importFullGraph: vi.fn().mockResolvedValue()
      };

      SemanticProviderFactory.createProvider.mockReturnValue(newMockProvider);

      await syncEngine.migrateProvider(newProviderConfig);

      expect(mockProvider.exportFullGraph).toHaveBeenCalled();
      expect(newMockProvider.importFullGraph).toHaveBeenCalled();
      expect(syncEngine.provider).toBe(newMockProvider);
    });

    it('should handle migration failures', async () => {
      mockProvider.exportFullGraph.mockRejectedValue(new Error('Export failed'));

      const newProviderConfig = { type: 'gitea' };

      await expect(syncEngine.migrateProvider(newProviderConfig))
        .rejects.toThrow('Export failed');

      expect(statusCallback).toHaveBeenCalledWith({
        status: '✗ Migration failed: Export failed',
        type: 'error',
        timestamp: expect.any(String)
      });
    });

    it('should set up redundant storage', async () => {
      const backupConfigs = [
        { type: 'gitea', endpoint: 'https://backup1.com' },
        { type: 'github', user: 'backup', repo: 'backup' }
      ];

      const backupProviders = [
        { name: 'Backup 1', writeSemanticFile: vi.fn().mockResolvedValue() },
        { name: 'Backup 2', writeSemanticFile: vi.fn().mockResolvedValue() }
      ];

      SemanticProviderFactory.createProvider
        .mockReturnValueOnce(backupProviders[0])
        .mockReturnValueOnce(backupProviders[1]);

      await syncEngine.setupRedundantStorage(backupConfigs);

      expect(syncEngine.backupProviders).toHaveLength(2);
      expect(statusCallback).toHaveBeenCalledWith({
        status: 'Redundant storage enabled with 2 backups',
        type: 'info',
        timestamp: expect.any(String)
      });
    });

    it('should write with redundancy', async () => {
      const backupProviders = [
        { writeSemanticFile: vi.fn().mockResolvedValue() },
        { writeSemanticFile: vi.fn().mockResolvedValue() }
      ];

      syncEngine.backupProviders = backupProviders;

      await syncEngine.writeWithRedundancy('test/path', 'test content');

      expect(mockProvider.writeSemanticFile).toHaveBeenCalledWith('test/path', 'test content');
      expect(backupProviders[0].writeSemanticFile).toHaveBeenCalledWith('test/path', 'test content');
      expect(backupProviders[1].writeSemanticFile).toHaveBeenCalledWith('test/path', 'test content');
    });
  });

  describe('Utility Methods', () => {
    it('should force immediate sync', async () => {
      syncEngine.updateConcept('concept1', { name: 'Concept 1' });

      await syncEngine.forceSync();

      expect(mockProvider.writeSemanticFile).toHaveBeenCalled();
      expect(syncEngine.pendingCommits).toHaveLength(0);
    });

    it('should get sync status', () => {
      syncEngine.updateConcept('concept1', { name: 'Concept 1' });
      syncEngine.isCommitting = true;

      const status = syncEngine.getSyncStatus();

      expect(status).toEqual({
        provider: 'Test Provider',
        pendingCommits: 1,
        isCommitting: true,
        lastSync: undefined,
        localConcepts: 1
      });
    });
  });
}); 