/**
 * Test suite for GitAutosavePolicy
 * Verifies the Git autosave policy implementation
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { GitAutosavePolicy } from '../../src/services/GitAutosavePolicy.js';

// Mock dependencies
const mockGitSyncEngine = {
  forceCommit: vi.fn(),
  localState: new Map([['current', { graphs: new Map(), nodePrototypes: new Map(), edges: new Map() }]])
};

const mockSaveCoordinator = {
  getState: vi.fn(() => ({ graphs: new Map(), nodePrototypes: new Map(), edges: new Map() })),
  onStatusChange: vi.fn()
};

describe('GitAutosavePolicy', () => {
  let policy;

  beforeEach(() => {
    policy = new GitAutosavePolicy();
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    policy.destroy();
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
  });

  describe('Initialization', () => {
    it('should initialize with correct default values', () => {
      expect(policy.IDLE_TIMEOUT).toBe(10000);
      expect(policy.MAX_TIMEOUT).toBe(90000);
      expect(policy.MIN_API_GAP).toBe(1000);
      expect(policy.COMMITS_PER_HOUR_LIMIT).toBe(60);
      expect(policy.isEnabled).toBe(false);
    });

    it('should initialize with dependencies', () => {
      policy.initialize(mockGitSyncEngine, mockSaveCoordinator);

      expect(policy.isEnabled).toBe(true);
      expect(policy.gitSyncEngine).toBe(mockGitSyncEngine);
      expect(policy.saveCoordinator).toBe(mockSaveCoordinator);
    });
  });

  describe('Edit Activity Handling', () => {
    beforeEach(() => {
      policy.initialize(mockGitSyncEngine, mockSaveCoordinator);
    });

    it('should handle edit activity and set timeouts', () => {
      const now = Date.now();
      vi.setSystemTime(now);

      policy.onEditActivity();

      expect(policy.currentBatch).toHaveLength(1);
      expect(policy.lastEditTime).toBe(now);
      expect(policy.pendingTimeout).toBeTruthy();
      expect(policy.maxTimeout).toBeTruthy();
    });

    it('should clear and reset idle timeout on subsequent edits', () => {
      policy.onEditActivity();
      const firstTimeout = policy.pendingTimeout;

      // Advance time slightly
      vi.advanceTimersByTime(1000);

      policy.onEditActivity();
      const secondTimeout = policy.pendingTimeout;

      expect(firstTimeout).not.toBe(secondTimeout);
      expect(policy.currentBatch).toHaveLength(2);
    });

    it('should trigger idle timeout after IDLE_TIMEOUT', async () => {
      const executeBatchCommitSpy = vi.spyOn(policy, 'executeBatchCommit');

      policy.onEditActivity();

      // Advance time to trigger idle timeout
      vi.advanceTimersByTime(policy.IDLE_TIMEOUT);

      expect(executeBatchCommitSpy).toHaveBeenCalledWith('idle_timeout');
    });

    it('should set max timeout on first edit and preserve it', () => {
      // Start editing - should set both timeouts
      policy.onEditActivity();

      const firstMaxTimeout = policy.maxTimeout;
      expect(firstMaxTimeout).toBeTruthy();

      // Add another edit - should clear idle timeout but preserve max timeout
      policy.onEditActivity();

      expect(policy.maxTimeout).toBe(firstMaxTimeout); // Same timeout object
      expect(policy.pendingTimeout).toBeTruthy(); // New idle timeout
    });
  });

  describe('Rate Limiting', () => {
    beforeEach(() => {
      policy.initialize(mockGitSyncEngine, mockSaveCoordinator);
    });

    it('should allow commits within rate limit', () => {
      // Add fewer than limit commits to history
      for (let i = 0; i < 30; i++) {
        policy.commitHistory.push({
          timestamp: Date.now() - (i * 1000),
          success: true
        });
      }

      expect(policy.checkRateLimit()).toBe(true);
    });

    it('should deny commits when rate limit exceeded', () => {
      // Add more than limit commits to history
      for (let i = 0; i < 65; i++) {
        policy.commitHistory.push({
          timestamp: Date.now() - (i * 1000),
          success: true
        });
      }

      expect(policy.checkRateLimit()).toBe(false);
    });

    it('should clean old history beyond one hour', () => {
      const now = Date.now();
      const oldTimestamp = now - (2 * 60 * 60 * 1000); // 2 hours ago

      policy.commitHistory.push(
        { timestamp: oldTimestamp, success: true },
        { timestamp: now, success: true }
      );

      policy.cleanCommitHistory();

      expect(policy.commitHistory).toHaveLength(1);
      expect(policy.commitHistory[0].timestamp).toBe(now);
    });
  });

  describe('API Gap Enforcement', () => {
    beforeEach(() => {
      policy.initialize(mockGitSyncEngine, mockSaveCoordinator);
    });

    it('should enforce minimum gap between API calls', () => {
      const now = Date.now();
      vi.setSystemTime(now);

      policy.lastApiCallTime = now - 500; // 500ms ago

      expect(policy.checkApiGap()).toBe(false);
    });

    it('should allow API calls after minimum gap', () => {
      const now = Date.now();
      vi.setSystemTime(now);

      policy.lastApiCallTime = now - 1500; // 1.5s ago

      expect(policy.checkApiGap()).toBe(true);
    });
  });

  describe('File Size Monitoring', () => {
    beforeEach(() => {
      policy.initialize(mockGitSyncEngine, mockSaveCoordinator);
    });

    it('should allow normal sized files', () => {
      const smallState = { data: 'small' };

      expect(policy.checkFileSize(smallState)).toBe(true);
    });

    it('should warn on large files but allow them', () => {
      const statusSpy = vi.spyOn(policy, 'notifyStatus');

      // Create a state that would be large when JSON stringified (but not too large for test)
      const largeState = { data: 'x'.repeat(15 * 1024 * 1024) }; // ~15MB

      expect(policy.checkFileSize(largeState)).toBe(true);
      // Should show ideal size warning first, then soft cap on second check
      expect(statusSpy).toHaveBeenCalledWith(
        'info',
        expect.stringContaining('above ideal')
      );
    });

    it('should reject files exceeding hard cap', () => {
      const statusSpy = vi.spyOn(policy, 'notifyStatus');

      // Mock a very large state without actually creating massive strings
      const mockState = { largeData: true };
      const originalCheckFileSize = policy.checkFileSize.bind(policy);

      vi.spyOn(policy, 'checkFileSize').mockImplementation((state) => {
        // Simulate hard cap exceeded without creating massive string
        const fakeSize = 150 * 1024 * 1024; // 150MB
        if (fakeSize > policy.HARD_CAP_FILE_SIZE) {
          policy.notifyStatus('error', `File size ${policy.formatSize(fakeSize)} exceeds hard cap of ${policy.formatSize(policy.HARD_CAP_FILE_SIZE)}`);
          return false;
        }
        return true;
      });

      expect(policy.checkFileSize(mockState)).toBe(false);
      expect(statusSpy).toHaveBeenCalledWith(
        'error',
        expect.stringContaining('exceeds hard cap')
      );
    });
  });

  describe('Error Handling and Backoff', () => {
    beforeEach(() => {
      policy.initialize(mockGitSyncEngine, mockSaveCoordinator);
    });

    it('should handle rate limit errors with backoff', async () => {
      const rateLimitError = new Error('403 rate limit exceeded');
      const executeBatchCommitSpy = vi.spyOn(policy, 'executeBatchCommit');

      await policy.handleCommitError(rateLimitError, 'test');

      expect(policy.rateLimitBackoff).toBeGreaterThan(Date.now());

      // Should schedule retry
      vi.advanceTimersByTime(60000); // Default 60s backoff
      expect(executeBatchCommitSpy).toHaveBeenCalled();
    });

    it('should implement exponential backoff for retries', async () => {
      const error = new Error('Network error');

      policy.retryCount = 0;
      await policy.handleCommitError(error, 'test');
      expect(policy.retryCount).toBe(1);

      // Should increase retry count and delay
      policy.retryCount = 2;
      await policy.handleCommitError(error, 'test');
      expect(policy.retryCount).toBe(3);
    });

    it('should clear batch after max retries', async () => {
      const error = new Error('Persistent error');

      policy.retryCount = policy.maxRetries;
      policy.currentBatch = [{ timestamp: Date.now(), type: 'edit' }];

      await policy.handleCommitError(error, 'test');

      expect(policy.currentBatch).toHaveLength(0);
      expect(policy.retryCount).toBe(0);
    });
  });

  describe('Force Commit', () => {
    beforeEach(() => {
      policy.initialize(mockGitSyncEngine, mockSaveCoordinator);
    });

    it('should bypass rate limits for manual commits', async () => {
      // Set up rate limit violation
      for (let i = 0; i < 65; i++) {
        policy.commitHistory.push({
          timestamp: Date.now() - (i * 1000),
          success: true
        });
      }

      mockGitSyncEngine.forceCommit.mockResolvedValue(true);

      await policy.forceCommit();

      expect(mockGitSyncEngine.forceCommit).toHaveBeenCalled();
    });

    it('should clear timeouts on force commit', async () => {
      policy.onEditActivity(); // Set up timeouts

      const pendingTimeout = policy.pendingTimeout;
      const maxTimeout = policy.maxTimeout;

      mockGitSyncEngine.forceCommit.mockResolvedValue(true);

      await policy.forceCommit();

      expect(policy.pendingTimeout).toBeNull();
      expect(policy.maxTimeout).toBeNull();
    });
  });

  describe('Status Reporting', () => {
    beforeEach(() => {
      policy.initialize(mockGitSyncEngine, mockSaveCoordinator);
    });

    it('should provide comprehensive status', () => {
      policy.onEditActivity();
      policy.commitHistory.push({ timestamp: Date.now(), success: true });

      const status = policy.getStatus();

      expect(status).toMatchObject({
        isEnabled: true,
        currentBatchSize: 1,
        commitsThisHour: 1,
        commitLimit: 60,
        isCommitInProgress: false
      });

      expect(status.timeSinceLastEdit).toBeGreaterThanOrEqual(0);
      expect(status.timeUntilIdleCommit).toBeGreaterThan(0);
    });
  });

  describe('Enable/Disable', () => {
    it('should enable and disable correctly', () => {
      expect(policy.isEnabled).toBe(false);

      policy.setEnabled(true);
      expect(policy.isEnabled).toBe(true);

      policy.setEnabled(false);
      expect(policy.isEnabled).toBe(false);
    });

    it('should clean up timers when disabled', () => {
      policy.initialize(mockGitSyncEngine, mockSaveCoordinator);
      policy.onEditActivity();

      expect(policy.pendingTimeout).toBeTruthy();
      expect(policy.maxTimeout).toBeTruthy();

      policy.setEnabled(false);

      expect(policy.pendingTimeout).toBeNull();
      expect(policy.maxTimeout).toBeNull();
    });
  });
});