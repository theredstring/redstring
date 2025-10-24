// Lazy-load role runners to avoid importing UI store on the Node daemon process

class OrchestratorScheduler {
  constructor() {
    this.enabled = false;
    this.timer = null;
    this.runners = null; // { runPlannerOnce, runExecutorOnce, runAuditorOnce }
    this.options = {
      cadenceMs: 250,
      planner: false,
      executor: false,
      auditor: false,
      maxPerTick: { planner: 1, executor: 2, auditor: 2 }
    };
    this.metrics = {
      startedAt: null,
      ticks: 0,
      runs: { planner: 0, executor: 0, auditor: 0 },
      lastError: null
    };
  }

  async _ensureRunners() {
    if (this.runners) return;
    const mod = await import('./roleRunners.js');
    this.runners = {
      runPlannerOnce: mod.runPlannerOnce,
      runExecutorOnce: mod.runExecutorOnce,
      runAuditorOnce: mod.runAuditorOnce
    };
  }

  start(opts = {}) {
    this.options = {
      ...this.options,
      ...opts,
      maxPerTick: { ...this.options.maxPerTick, ...(opts.maxPerTick || {}) }
    };
    if (this.enabled) return;
    this.enabled = true;
    this.metrics.startedAt = Date.now();
    this.timer = setInterval(() => this._tick().catch(e => { this.metrics.lastError = String(e?.message || e); }), this.options.cadenceMs);
  }

  stop() {
    if (!this.enabled) return;
    this.enabled = false;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  status() {
    return {
      enabled: this.enabled,
      options: this.options,
      metrics: this.metrics
    };
  }

  async _tick() {
    if (!this.enabled) return;
    await this._ensureRunners();
    this.metrics.ticks++;
    const { planner, executor, auditor, maxPerTick } = this.options;

    if (planner) {
      for (let i = 0; i < (maxPerTick.planner || 0); i++) {
        await this.runners.runPlannerOnce();
        this.metrics.runs.planner++;
      }
    }
    if (executor) {
      for (let i = 0; i < (maxPerTick.executor || 0); i++) {
        await this.runners.runExecutorOnce();
        this.metrics.runs.executor++;
      }
    }
    if (auditor) {
      for (let i = 0; i < (maxPerTick.auditor || 0); i++) {
        await this.runners.runAuditorOnce();
        this.metrics.runs.auditor++;
      }
    }
  }
}

const scheduler = new OrchestratorScheduler();
export default scheduler;


