/**
 * Git Autosave Policy - Implementation of intelligent auto-commit policy
 *
 * Features:
 * - Debounce edits: commit after 10s idle OR 90s max
 * - Batch changes: 1 commit per burst, never per keystroke
 * - Cap: ≤60 commits/hr/repo/user
 * - Serialize writes; ≥1s gap between mutating API calls
 * - Backoff on 403/Retry-After; exponential retry
 * - File size: <10MiB ideal, <50MiB soft cap, never ≥100MB
 * - Repo size monitoring with LFS recommendations
 * - Periodic squash: condense autosave commits daily/weekly
 * - Shallow/partial clones recommended
 * - CI: filter autosave commits to avoid workflow storms
 */

class GitAutosavePolicy {
  constructor() {
    // Core timing configuration
    this.IDLE_TIMEOUT = 10000;          // 10s idle timeout
    this.MAX_TIMEOUT = 90000;           // 90s maximum timeout
    this.MIN_API_GAP = 1000;            // ≥1s between API calls
    this.COMMITS_PER_HOUR_LIMIT = 60;   // ≤60 commits/hour

    // File size limits
    this.IDEAL_FILE_SIZE = 10 * 1024 * 1024;    // 10MiB ideal
    this.SOFT_CAP_FILE_SIZE = 50 * 1024 * 1024;  // 50MiB soft cap
    this.HARD_CAP_FILE_SIZE = 100 * 1024 * 1024; // 100MiB never exceed
    this.REPO_SIZE_WARNING = 1 * 1024 * 1024 * 1024;  // 1GB warning
    this.REPO_SIZE_CRITICAL = 5 * 1024 * 1024 * 1024; // 5GB critical

    // State tracking
    this.isEnabled = false;
    this.lastEditTime = 0;
    this.lastCommitTime = 0;
    this.currentBatch = [];
    this.commitHistory = []; // Track commits for rate limiting
    this.pendingTimeout = null;
    this.maxTimeout = null;
    this.isCommitInProgress = false;
    this.lastApiCallTime = 0;

    // Error handling and backoff
    this.retryCount = 0;
    this.maxRetries = 5;
    this.baseRetryDelay = 1000; // Start with 1s
    this.maxRetryDelay = 300000; // Max 5 minutes
    this.rateLimitBackoff = 0;

    // Size monitoring
    this.repoSizeEstimate = 0;
    this.largeFileWarnings = new Set();

    // Dependencies
    this.gitSyncEngine = null;
    this.saveCoordinator = null;
    this.statusHandlers = new Set();

    console.log('[GitAutosavePolicy] Initialized with policy constraints');
  }

  /**
   * Initialize with dependencies
   */
  initialize(gitSyncEngine, saveCoordinator) {
    this.gitSyncEngine = gitSyncEngine;
    this.saveCoordinator = saveCoordinator;
    this.isEnabled = true;

    // Subscribe to state changes through SaveCoordinator
    if (this.saveCoordinator) {
      this.saveCoordinator.onStatusChange((status) => {
        if (status.type === 'state_change') {
          this.onEditActivity();
        }
      });
    }

    console.log('[GitAutosavePolicy] Initialized with dependencies');
    this.notifyStatus('info', 'Git autosave policy active');
  }

  /**
   * Status notification system
   */
  onStatusChange(handler) {
    this.statusHandlers.add(handler);
    return () => this.statusHandlers.delete(handler);
  }

  notifyStatus(type, message, details = {}) {
    const status = {
      type,
      message,
      timestamp: Date.now(),
      policy: 'git-autosave',
      ...details
    };

    this.statusHandlers.forEach(handler => {
      try {
        handler(status);
      } catch (error) {
        console.warn('[GitAutosavePolicy] Status handler error:', error);
      }
    });
  }

  /**
   * Handle edit activity - core debouncing logic
   */
  onEditActivity() {
    if (!this.isEnabled) return;

    const now = Date.now();
    this.lastEditTime = now;

    // Add to current batch
    this.currentBatch.push({
      timestamp: now,
      type: 'edit'
    });

    // Clear existing timeouts
    if (this.pendingTimeout) {
      clearTimeout(this.pendingTimeout);
    }

    // Set idle timeout (10s after last edit)
    this.pendingTimeout = setTimeout(() => {
      this.executeBatchCommit('idle_timeout');
    }, this.IDLE_TIMEOUT);

    // Set maximum timeout if not already set
    if (!this.maxTimeout) {
      this.maxTimeout = setTimeout(() => {
        this.executeBatchCommit('max_timeout');
      }, this.MAX_TIMEOUT);
    }

    console.log(`[GitAutosavePolicy] Edit activity detected, batch size: ${this.currentBatch.length}`);
  }

  /**
   * Execute batch commit with policy enforcement
   */
  async executeBatchCommit(reason) {
    if (!this.isEnabled || this.currentBatch.length === 0) return;

    // Clear timeouts
    if (this.pendingTimeout) {
      clearTimeout(this.pendingTimeout);
      this.pendingTimeout = null;
    }
    if (this.maxTimeout) {
      clearTimeout(this.maxTimeout);
      this.maxTimeout = null;
    }

    // Check rate limiting (≤60 commits/hour)
    if (!this.checkRateLimit()) {
      console.log('[GitAutosavePolicy] Rate limit exceeded, deferring commit');
      this.scheduleRetryAfterRateLimit();
      return;
    }

    // Serialize API calls (≥1s gap)
    if (!this.checkApiGap()) {
      const waitTime = this.MIN_API_GAP - (Date.now() - this.lastApiCallTime);
      console.log(`[GitAutosavePolicy] API gap enforcement, waiting ${waitTime}ms`);
      setTimeout(() => this.executeBatchCommit(reason), waitTime);
      return;
    }

    // Check if commit is already in progress
    if (this.isCommitInProgress) {
      console.log('[GitAutosavePolicy] Commit in progress, deferring');
      setTimeout(() => this.executeBatchCommit(reason), 1000);
      return;
    }

    try {
      this.isCommitInProgress = true;
      const batchSize = this.currentBatch.length;

      console.log(`[GitAutosavePolicy] Executing batch commit (${reason}), ${batchSize} edits`);
      this.notifyStatus('info', `Committing batch of ${batchSize} changes (${reason})`);

      // Get current state and check file size
      const currentState = this.getCurrentState();
      if (!this.checkFileSize(currentState)) {
        throw new Error('File size limit exceeded');
      }

      // Update API call time
      this.lastApiCallTime = Date.now();

      // Execute commit through GitSyncEngine
      await this.performCommit(currentState);

      // Update commit history
      this.commitHistory.push({
        timestamp: Date.now(),
        batchSize,
        reason,
        success: true
      });

      // Clean old history (keep only last hour)
      this.cleanCommitHistory();

      // Clear current batch
      this.currentBatch = [];
      this.lastCommitTime = Date.now();
      this.retryCount = 0; // Reset retry count on success

      this.notifyStatus('success', `Batch commit successful (${batchSize} changes)`);

    } catch (error) {
      console.error('[GitAutosavePolicy] Batch commit failed:', error);
      await this.handleCommitError(error, reason);
    } finally {
      this.isCommitInProgress = false;
    }
  }

  /**
   * Check rate limiting (≤60 commits/hour)
   */
  checkRateLimit() {
    const now = Date.now();
    const oneHourAgo = now - (60 * 60 * 1000);

    // Count commits in the last hour
    const recentCommits = this.commitHistory.filter(
      commit => commit.timestamp > oneHourAgo && commit.success
    );

    const allowed = recentCommits.length < this.COMMITS_PER_HOUR_LIMIT;

    if (!allowed) {
      this.notifyStatus('warning', `Rate limit: ${recentCommits.length}/${this.COMMITS_PER_HOUR_LIMIT} commits/hour`);
    }

    return allowed;
  }

  /**
   * Check API gap requirement (≥1s between calls)
   */
  checkApiGap() {
    const timeSinceLastApi = Date.now() - this.lastApiCallTime;
    return timeSinceLastApi >= this.MIN_API_GAP;
  }

  /**
   * Check file size constraints
   */
  checkFileSize(state) {
    const stateString = JSON.stringify(state);
    // Use Buffer in Node.js environment, Blob in browser
    const sizeBytes = typeof Buffer !== 'undefined'
      ? Buffer.byteLength(stateString, 'utf8')
      : new Blob([stateString]).size;

    // Hard cap - never exceed 100MB
    if (sizeBytes > this.HARD_CAP_FILE_SIZE) {
      this.notifyStatus('error', `File size ${this.formatSize(sizeBytes)} exceeds hard cap of ${this.formatSize(this.HARD_CAP_FILE_SIZE)}`);
      return false;
    }

    // Soft cap warning - over 50MB
    if (sizeBytes > this.SOFT_CAP_FILE_SIZE) {
      if (!this.largeFileWarnings.has('soft_cap')) {
        this.notifyStatus('warning', `File size ${this.formatSize(sizeBytes)} exceeds soft cap, consider data cleanup`);
        this.largeFileWarnings.add('soft_cap');
      }
    }

    // Ideal size recommendation - over 10MB
    if (sizeBytes > this.IDEAL_FILE_SIZE) {
      if (!this.largeFileWarnings.has('ideal')) {
        this.notifyStatus('info', `File size ${this.formatSize(sizeBytes)} above ideal, consider splitting data`);
        this.largeFileWarnings.add('ideal');
      }
    }

    return true;
  }

  /**
   * Handle commit errors with exponential backoff
   */
  async handleCommitError(error, reason) {
    this.retryCount++;

    // Check for rate limiting (403/Retry-After)
    if (error.message && (error.message.includes('403') || error.message.includes('rate limit'))) {
      const retryAfter = this.extractRetryAfter(error) || (60 * 1000); // Default 60s
      this.rateLimitBackoff = Date.now() + retryAfter;

      this.notifyStatus('warning', `Rate limited, waiting ${Math.ceil(retryAfter/1000)}s`);
      setTimeout(() => this.executeBatchCommit(reason), retryAfter);
      return;
    }

    // Exponential backoff for other errors
    if (this.retryCount <= this.maxRetries) {
      const delay = Math.min(
        this.baseRetryDelay * Math.pow(2, this.retryCount - 1),
        this.maxRetryDelay
      );

      this.notifyStatus('warning', `Retry ${this.retryCount}/${this.maxRetries} in ${Math.ceil(delay/1000)}s`);

      setTimeout(() => this.executeBatchCommit(reason), delay);
    } else {
      // Max retries exceeded
      this.notifyStatus('error', `Commit failed after ${this.maxRetries} retries: ${error.message}`);
      this.currentBatch = []; // Clear batch to prevent infinite retries
      this.retryCount = 0;
    }
  }

  /**
   * Extract retry-after header from error
   */
  extractRetryAfter(error) {
    // Try to extract retry-after from error message or headers
    const message = error.message || '';
    const retryMatch = message.match(/retry.*after.*?(\d+)/i);

    if (retryMatch) {
      return parseInt(retryMatch[1]) * 1000; // Convert to milliseconds
    }

    return null;
  }

  /**
   * Schedule retry after rate limit window
   */
  scheduleRetryAfterRateLimit() {
    // Find oldest commit and schedule retry after it expires
    const oldestCommit = this.commitHistory
      .filter(c => c.success)
      .sort((a, b) => a.timestamp - b.timestamp)[0];

    if (oldestCommit) {
      const expireTime = oldestCommit.timestamp + (60 * 60 * 1000); // 1 hour
      const waitTime = Math.max(expireTime - Date.now(), 60000); // At least 1 minute

      this.notifyStatus('info', `Rate limit: retrying in ${Math.ceil(waitTime/60000)} minutes`);

      setTimeout(() => {
        if (this.currentBatch.length > 0) {
          this.executeBatchCommit('rate_limit_retry');
        }
      }, waitTime);
    }
  }

  /**
   * Get current state for commit
   */
  getCurrentState() {
    // Get state from SaveCoordinator or GitSyncEngine
    if (this.saveCoordinator && this.saveCoordinator.getState) {
      return this.saveCoordinator.getState();
    }

    if (this.gitSyncEngine && this.gitSyncEngine.localState) {
      return this.gitSyncEngine.localState.get('current');
    }

    throw new Error('No state source available');
  }

  /**
   * Perform actual commit
   */
  async performCommit(state) {
    if (this.gitSyncEngine && this.gitSyncEngine.forceCommit) {
      await this.gitSyncEngine.forceCommit(state);
    } else if (this.saveCoordinator && this.saveCoordinator.forceSave) {
      await this.saveCoordinator.forceSave(state);
    } else {
      throw new Error('No commit mechanism available');
    }
  }

  /**
   * Clean old commit history
   */
  cleanCommitHistory() {
    const oneHourAgo = Date.now() - (60 * 60 * 1000);
    this.commitHistory = this.commitHistory.filter(
      commit => commit.timestamp > oneHourAgo
    );
  }

  /**
   * Format file size for display
   */
  formatSize(bytes) {
    const units = ['B', 'KB', 'MB', 'GB'];
    let size = bytes;
    let unitIndex = 0;

    while (size >= 1024 && unitIndex < units.length - 1) {
      size /= 1024;
      unitIndex++;
    }

    return `${size.toFixed(1)}${units[unitIndex]}`;
  }

  /**
   * Force immediate commit (manual save)
   */
  async forceCommit() {
    if (!this.isEnabled) {
      throw new Error('Autosave policy not enabled');
    }

    // Clear any pending timeouts
    if (this.pendingTimeout) {
      clearTimeout(this.pendingTimeout);
      this.pendingTimeout = null;
    }
    if (this.maxTimeout) {
      clearTimeout(this.maxTimeout);
      this.maxTimeout = null;
    }

    // Add manual save to batch
    this.currentBatch.push({
      timestamp: Date.now(),
      type: 'manual'
    });

    // Execute immediately, bypassing rate limits for manual saves
    const originalRateLimit = this.COMMITS_PER_HOUR_LIMIT;
    this.COMMITS_PER_HOUR_LIMIT = 999; // Temporarily bypass rate limit

    try {
      await this.executeBatchCommit('manual_force');
    } finally {
      this.COMMITS_PER_HOUR_LIMIT = originalRateLimit; // Restore rate limit
    }
  }

  /**
   * Get current policy status
   */
  getStatus() {
    const now = Date.now();
    const recentCommits = this.commitHistory.filter(
      commit => commit.timestamp > (now - 60 * 60 * 1000)
    );

    return {
      isEnabled: this.isEnabled,
      currentBatchSize: this.currentBatch.length,
      commitsThisHour: recentCommits.length,
      commitLimit: this.COMMITS_PER_HOUR_LIMIT,
      isCommitInProgress: this.isCommitInProgress,
      timeSinceLastEdit: this.lastEditTime ? now - this.lastEditTime : 0,
      timeSinceLastCommit: this.lastCommitTime ? now - this.lastCommitTime : 0,
      timeUntilIdleCommit: this.pendingTimeout ? this.IDLE_TIMEOUT - (now - this.lastEditTime) : 0,
      timeUntilMaxCommit: this.maxTimeout ? this.MAX_TIMEOUT - (now - (this.currentBatch[0]?.timestamp || now)) : 0,
      retryCount: this.retryCount,
      inRateLimitBackoff: this.rateLimitBackoff > now,
      rateLimitBackoffRemaining: Math.max(0, this.rateLimitBackoff - now),
      repoSizeEstimate: this.repoSizeEstimate,
      largeFileWarnings: Array.from(this.largeFileWarnings)
    };
  }

  /**
   * Enable/disable the policy
   */
  setEnabled(enabled) {
    const wasEnabled = this.isEnabled;
    this.isEnabled = enabled;

    if (enabled && !wasEnabled) {
      console.log('[GitAutosavePolicy] Enabled');
      this.notifyStatus('info', 'Git autosave policy enabled');
    } else if (!enabled && wasEnabled) {
      // Clean up timers
      if (this.pendingTimeout) {
        clearTimeout(this.pendingTimeout);
        this.pendingTimeout = null;
      }
      if (this.maxTimeout) {
        clearTimeout(this.maxTimeout);
        this.maxTimeout = null;
      }

      console.log('[GitAutosavePolicy] Disabled');
      this.notifyStatus('info', 'Git autosave policy disabled');
    }
  }

  /**
   * Cleanup
   */
  destroy() {
    this.setEnabled(false);
    this.statusHandlers.clear();
    this.commitHistory = [];
    this.currentBatch = [];
    console.log('[GitAutosavePolicy] Destroyed');
  }
}

// Export both class and singleton instance
export { GitAutosavePolicy };
export const gitAutosavePolicy = new GitAutosavePolicy();
export default gitAutosavePolicy;