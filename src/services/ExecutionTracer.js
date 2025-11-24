/**
 * ExecutionTracer - Centralized trace recording for Wizard pipeline
 * 
 * Records execution traces across all pipeline stages:
 * Planner → Executor → Auditor → Committer → Continuation
 * 
 * Enables debugging by providing complete visibility into what
 * happened during each conversation.
 */

class ExecutionTracer {
    constructor() {
        this.traces = new Map(); // cid -> trace object
        this.maxTraces = 100; // Keep last 100 conversations
        this.cleanupInterval = null;

        // Start periodic cleanup
        this.startCleanup();
    }

    /**
     * Start a new trace for a conversation
     */
    startTrace(cid, userMessage, context = {}) {
        // Cleanup old traces if needed
        if (this.traces.size >= this.maxTraces) {
            this.cleanup();
        }

        this.traces.set(cid, {
            cid,
            userMessage,
            startTime: Date.now(),
            context,
            stages: [],
            metadata: {
                activeGraph: context.activeGraphId || null,
                activeGraphName: context.activeGraphName || null
            }
        });

        console.log(`[ExecutionTracer] Started trace for cid=${cid}`);
    }

    /**
     * Record the start of a stage
     */
    recordStage(cid, stageName, data = {}) {
        const trace = this.traces.get(cid);
        if (!trace) {
            console.warn(`[ExecutionTracer] No trace found for cid=${cid}, creating one`);
            this.startTrace(cid, 'Unknown message', {});
            return this.recordStage(cid, stageName, data);
        }

        // Check if this stage already exists and is still running
        const existingStage = trace.stages.find(
            s => s.stage === stageName && s.status === 'running'
        );

        if (existingStage) {
            console.warn(`[ExecutionTracer] Stage ${stageName} already running for cid=${cid}`);
            return;
        }

        const stage = {
            stage: stageName,
            timestamp: Date.now(),
            startTime: Date.now(),
            duration: null,
            status: 'running',
            data: this.sanitizeData(data),
            result: null,
            error: null
        };

        trace.stages.push(stage);
        console.log(`[ExecutionTracer] Recorded stage ${stageName} for cid=${cid}`);
    }

    /**
     * Mark a stage as complete with result
     */
    completeStage(cid, stageName, status = 'success', result = null) {
        const trace = this.traces.get(cid);
        if (!trace) {
            console.warn(`[ExecutionTracer] No trace found for cid=${cid}`);
            return;
        }

        // Find the most recent running instance of this stage
        const stages = trace.stages.filter(s => s.stage === stageName && s.status === 'running');
        const stage = stages[stages.length - 1];

        if (!stage) {
            console.warn(`[ExecutionTracer] No running stage ${stageName} found for cid=${cid}`);
            return;
        }

        stage.status = status;
        stage.duration = Date.now() - stage.startTime;
        stage.result = this.sanitizeData(result);

        if (status === 'error' && result && result.error) {
            stage.error = result.error;
        }

        console.log(`[ExecutionTracer] Completed stage ${stageName} for cid=${cid} (${stage.duration}ms, status=${status})`);
    }

    /**
     * Record an error in a stage
     */
    recordError(cid, stageName, error) {
        this.completeStage(cid, stageName, 'error', {
            error: error.message || String(error),
            stack: error.stack
        });
    }

    /**
     * Get trace for a specific conversation
     */
    getTrace(cid) {
        return this.traces.get(cid) || null;
    }

    /**
     * Get all traces (as array for easy iteration)
     */
    getAllTraces() {
        return Array.from(this.traces.values()).sort((a, b) => b.startTime - a.startTime);
    }

    /**
     * Get recent traces (limit)
     */
    getRecentTraces(limit = 20) {
        return this.getAllTraces().slice(0, limit);
    }

    /**
     * Get trace summary (without full data payloads)
     */
    getTraceSummary(cid) {
        const trace = this.getTrace(cid);
        if (!trace) return null;

        return {
            cid: trace.cid,
            userMessage: trace.userMessage,
            startTime: trace.startTime,
            duration: trace.stages.length > 0
                ? Math.max(...trace.stages.map(s => s.timestamp + (s.duration || 0))) - trace.startTime
                : 0,
            stageCount: trace.stages.length,
            stages: trace.stages.map(s => ({
                stage: s.stage,
                status: s.status,
                duration: s.duration
            })),
            status: this.getTraceStatus(trace),
            metadata: trace.metadata
        };
    }

    /**
     * Get overall status of a trace
     */
    getTraceStatus(trace) {
        if (trace.stages.length === 0) return 'pending';

        const hasError = trace.stages.some(s => s.status === 'error');
        if (hasError) return 'error';

        const allComplete = trace.stages.every(s => s.status === 'success' || s.status === 'error');
        if (allComplete) return 'success';

        return 'running';
    }

    /**
     * Sanitize data to prevent circular references and huge payloads
     */
    sanitizeData(data) {
        if (!data) return null;

        try {
            // Create a copy and limit depth to prevent circular refs
            const sanitized = JSON.parse(JSON.stringify(data, (key, value) => {
                // Limit string length
                if (typeof value === 'string' && value.length > 1000) {
                    return value.substring(0, 1000) + '... [truncated]';
                }
                // Limit array length
                if (Array.isArray(value) && value.length > 100) {
                    return [...value.slice(0, 100), `... [${value.length - 100} more items]`];
                }
                return value;
            }));

            return sanitized;
        } catch (error) {
            console.warn(`[ExecutionTracer] Failed to sanitize data:`, error.message);
            return { error: 'Failed to serialize data', type: typeof data };
        }
    }

    /**
     * Cleanup old traces
     */
    cleanup() {
        if (this.traces.size <= this.maxTraces) return;

        const traces = this.getAllTraces();
        const toRemove = traces.slice(this.maxTraces);

        toRemove.forEach(trace => {
            this.traces.delete(trace.cid);
        });

        console.log(`[ExecutionTracer] Cleaned up ${toRemove.length} old traces`);
    }

    /**
     * Start periodic cleanup
     */
    startCleanup() {
        if (this.cleanupInterval) return;

        // Cleanup every 5 minutes
        this.cleanupInterval = setInterval(() => {
            this.cleanup();
        }, 5 * 60 * 1000);
    }

    /**
     * Stop periodic cleanup (for testing)
     */
    stopCleanup() {
        if (this.cleanupInterval) {
            clearInterval(this.cleanupInterval);
            this.cleanupInterval = null;
        }
    }

    /**
     * Clear all traces (for testing)
     */
    clearAll() {
        this.traces.clear();
        console.log(`[ExecutionTracer] Cleared all traces`);
    }

    /**
     * Get statistics
     */
    getStats() {
        const traces = this.getAllTraces();

        return {
            totalTraces: traces.length,
            successTraces: traces.filter(t => this.getTraceStatus(t) === 'success').length,
            errorTraces: traces.filter(t => this.getTraceStatus(t) === 'error').length,
            runningTraces: traces.filter(t => this.getTraceStatus(t) === 'running').length,
            avgStagesPerTrace: traces.length > 0
                ? traces.reduce((sum, t) => sum + t.stages.length, 0) / traces.length
                : 0,
            avgDuration: traces.length > 0
                ? traces.reduce((sum, t) => {
                    const summary = this.getTraceSummary(t.cid);
                    return sum + (summary ? summary.duration : 0);
                }, 0) / traces.length
                : 0
        };
    }
}

// Export singleton instance
const executionTracer = new ExecutionTracer();
export default executionTracer;
