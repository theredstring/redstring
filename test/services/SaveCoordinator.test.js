import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { saveCoordinator } from '../../src/services/SaveCoordinator.js';

describe('SaveCoordinator', () => {
  let mockFileStorage, mockGitSyncEngine, mockUniverseManager;

  beforeEach(() => {
    // Reset coordinator state
    saveCoordinator.setEnabled(false);
    saveCoordinator.pendingChanges.clear();
    saveCoordinator.saveTimers.clear();

    // Mock dependencies
    mockFileStorage = {
      saveToFile: vi.fn().mockResolvedValue(true)
    };

    mockGitSyncEngine = {
      updateState: vi.fn(),
      forceCommit: vi.fn().mockResolvedValue(true),
      isRunning: true
    };

    mockUniverseManager = {
      getActiveUniverse: vi.fn().mockReturnValue({ slug: 'test' })
    };
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  describe('Initialization', () => {
    it('should initialize with dependencies', () => {
      saveCoordinator.initialize(mockFileStorage, mockGitSyncEngine, mockUniverseManager);
      
      expect(saveCoordinator.isEnabled).toBe(true);
      expect(saveCoordinator.fileStorage).toBe(mockFileStorage);
      expect(saveCoordinator.gitSyncEngine).toBe(mockGitSyncEngine);
      expect(saveCoordinator.universeManager).toBe(mockUniverseManager);
    });

    it('should not enable without required dependencies', () => {
      saveCoordinator.initialize(null, mockGitSyncEngine, mockUniverseManager);
      expect(saveCoordinator.isEnabled).toBe(false);
    });
  });

  describe('Change Priority Detection', () => {
    beforeEach(() => {
      saveCoordinator.initialize(mockFileStorage, mockGitSyncEngine, mockUniverseManager);
    });

    it('should classify prototype changes as IMMEDIATE priority', () => {
      const mockState = { graphs: new Map(), nodePrototypes: new Map(), edges: new Map() };
      const context = { type: 'prototype_create' };
      
      const priority = saveCoordinator.determinePriority(mockState, context);
      expect(priority.name).toBe('immediate');
      expect(priority.localDelay).toBe(0);
    });

    it('should classify node placement as HIGH priority', () => {
      const mockState = { graphs: new Map(), nodePrototypes: new Map(), edges: new Map() };
      const context = { type: 'node_place' };
      
      const priority = saveCoordinator.determinePriority(mockState, context);
      expect(priority.name).toBe('high');
      expect(priority.localDelay).toBe(2000);
    });

    it('should classify viewport changes as LOW priority', () => {
      const mockState = { graphs: new Map(), nodePrototypes: new Map(), edges: new Map() };
      const context = { type: 'viewport' };
      
      const priority = saveCoordinator.determinePriority(mockState, context);
      expect(priority.name).toBe('low');
      expect(priority.localDelay).toBe(10000);
    });
  });

  describe('Change Queuing', () => {
    beforeEach(() => {
      saveCoordinator.initialize(mockFileStorage, mockGitSyncEngine, mockUniverseManager);
    });

    it('should queue changes by priority', () => {
      const mockState = { graphs: new Map(), nodePrototypes: new Map(), edges: new Map() };
      const context = { type: 'prototype_create' };
      
      saveCoordinator.onStateChange(mockState, context);
      
      expect(saveCoordinator.pendingChanges.has('immediate')).toBe(true);
      const queuedChange = saveCoordinator.pendingChanges.get('immediate');
      expect(queuedChange.state).toBe(mockState);
      expect(queuedChange.count).toBe(1);
    });

    it('should batch multiple changes of same priority', () => {
      const mockState1 = { graphs: new Map(), nodePrototypes: new Map([['1', {}]]), edges: new Map() };
      const mockState2 = { graphs: new Map(), nodePrototypes: new Map([['1', {}], ['2', {}]]), edges: new Map() };
      const context = { type: 'prototype_create' };
      
      saveCoordinator.onStateChange(mockState1, context);
      saveCoordinator.onStateChange(mockState2, context);
      
      expect(saveCoordinator.pendingChanges.has('immediate')).toBe(true);
      const queuedChange = saveCoordinator.pendingChanges.get('immediate');
      expect(queuedChange.count).toBe(2);
      expect(queuedChange.state).toBe(mockState2); // Latest state
    });
  });

  describe('Drag Detection', () => {
    beforeEach(() => {
      saveCoordinator.initialize(mockFileStorage, mockGitSyncEngine, mockUniverseManager);
      vi.useFakeTimers();
    });

    it('should detect dragging from rapid updates', () => {
      const mockState = { graphs: new Map(), nodePrototypes: new Map(), edges: new Map() };
      const context = { type: 'node_position' };
      
      // First update
      saveCoordinator.onStateChange(mockState, context);
      
      // Second update within 100ms (simulates dragging)
      vi.advanceTimersByTime(50);
      saveCoordinator.onStateChange(mockState, context);
      
      expect(saveCoordinator.isDragging).toBe(true);
    });

    it('should debounce saves during dragging', () => {
      const mockState = { graphs: new Map(), nodePrototypes: new Map(), edges: new Map() };
      const context = { type: 'node_position' };
      
      // Trigger dragging
      saveCoordinator.onStateChange(mockState, context);
      vi.advanceTimersByTime(50);
      saveCoordinator.onStateChange(mockState, context);
      
      expect(saveCoordinator.isDragging).toBe(true);
      expect(saveCoordinator.pendingChanges.has('normal')).toBe(true);
    });
  });

  describe('Force Save', () => {
    beforeEach(() => {
      saveCoordinator.initialize(mockFileStorage, mockGitSyncEngine, mockUniverseManager);
    });

    it('should force immediate save to both local and git', async () => {
      const mockState = { graphs: new Map(), nodePrototypes: new Map(), edges: new Map() };
      
      await saveCoordinator.forceSave(mockState);
      
      expect(mockFileStorage.saveToFile).toHaveBeenCalledWith(mockState, true);
      expect(mockGitSyncEngine.forceCommit).toHaveBeenCalledWith(mockState);
    });

    it('should clear pending changes after force save', async () => {
      const mockState = { graphs: new Map(), nodePrototypes: new Map(), edges: new Map() };
      
      // Add some pending changes first
      saveCoordinator.onStateChange(mockState, { type: 'node_place' });
      expect(saveCoordinator.pendingChanges.size).toBeGreaterThan(0);
      
      await saveCoordinator.forceSave(mockState);
      
      expect(saveCoordinator.pendingChanges.size).toBe(0);
    });

    it('should handle errors gracefully', async () => {
      const mockState = { graphs: new Map(), nodePrototypes: new Map(), edges: new Map() };
      mockFileStorage.saveToFile.mockRejectedValue(new Error('Save failed'));
      
      await expect(saveCoordinator.forceSave(mockState)).rejects.toThrow('Save failed');
    });
  });

  describe('Rate Limiting', () => {
    beforeEach(() => {
      saveCoordinator.initialize(mockFileStorage, mockGitSyncEngine, mockUniverseManager);
      vi.useFakeTimers();
    });

    it('should respect minimum git commit interval', async () => {
      const mockState = { graphs: new Map(), nodePrototypes: new Map(), edges: new Map() };
      
      // First git save
      saveCoordinator.lastGitCommitTime = Date.now();
      
      // Try to save again too soon
      await saveCoordinator.executeGitSave('high');
      
      // Should not call GitSyncEngine due to rate limiting
      expect(mockGitSyncEngine.updateState).not.toHaveBeenCalled();
    });

    it('should allow git saves after rate limit period', async () => {
      const mockState = { graphs: new Map(), nodePrototypes: new Map(), edges: new Map() };
      
      // Set up a pending change
      saveCoordinator.pendingChanges.set('high', {
        state: mockState,
        context: { type: 'node_place' },
        timestamp: Date.now(),
        count: 1
      });
      
      // Set last commit time to allow new commits
      saveCoordinator.lastGitCommitTime = Date.now() - 6000; // 6 seconds ago
      
      await saveCoordinator.executeGitSave('high');
      
      expect(mockGitSyncEngine.updateState).toHaveBeenCalledWith(mockState);
    });
  });

  describe('Status Reporting', () => {
    beforeEach(() => {
      saveCoordinator.initialize(mockFileStorage, mockGitSyncEngine, mockUniverseManager);
    });

    it('should report current status', () => {
      const status = saveCoordinator.getStatus();
      
      expect(status).toHaveProperty('isEnabled');
      expect(status).toHaveProperty('isSaving');
      expect(status).toHaveProperty('isDragging');
      expect(status).toHaveProperty('pendingChanges');
      expect(status).toHaveProperty('activeTimers');
    });

    it('should call status handlers on status changes', () => {
      const statusHandler = vi.fn();
      saveCoordinator.onStatusChange(statusHandler);
      
      saveCoordinator.notifyStatus('info', 'Test message');
      
      expect(statusHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'info',
          message: 'Test message'
        })
      );
    });
  });

  describe('Hash Generation', () => {
    beforeEach(() => {
      saveCoordinator.initialize(mockFileStorage, mockGitSyncEngine, mockUniverseManager);
    });

    it('should generate consistent hashes for same content', () => {
      const state1 = {
        graphs: new Map([['g1', { id: 'g1', name: 'Graph1' }]]),
        nodePrototypes: new Map([['n1', { id: 'n1', name: 'Node1' }]]),
        edges: new Map()
      };
      
      const state2 = {
        graphs: new Map([['g1', { id: 'g1', name: 'Graph1' }]]),
        nodePrototypes: new Map([['n1', { id: 'n1', name: 'Node1' }]]),
        edges: new Map()
      };
      
      const hash1 = saveCoordinator.generateStateHash(state1);
      const hash2 = saveCoordinator.generateStateHash(state2);
      
      expect(hash1).toBe(hash2);
    });

    it('should ignore viewport changes in hash', () => {
      const state1 = {
        graphs: new Map([['g1', { id: 'g1', name: 'Graph1', panOffset: { x: 0, y: 0 } }]]),
        nodePrototypes: new Map(),
        edges: new Map()
      };
      
      const state2 = {
        graphs: new Map([['g1', { id: 'g1', name: 'Graph1', panOffset: { x: 100, y: 100 } }]]),
        nodePrototypes: new Map(),
        edges: new Map()
      };
      
      const hash1 = saveCoordinator.generateStateHash(state1);
      const hash2 = saveCoordinator.generateStateHash(state2);
      
      expect(hash1).toBe(hash2); // Should be same despite different viewport
    });
  });
});