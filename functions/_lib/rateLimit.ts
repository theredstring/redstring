// Best-effort rate limiting for /api/github/*.
//
// Pages Functions have no rate-limiting binding of their own, so this is a
// fixed-window counter held in module scope — i.e. per Worker isolate. An
// attacker spread across many colos/isolates gets more than `limit`, so this
// is a speed bump, not a wall: the real limit is the Cloudflare WAF rate-limit
// rule on /api/github/* described in documentation/security/RUNBOOK.md.
//
// If the project ever gains a Workers Rate Limiting binding named
// RATE_LIMITER (`{ limit({ key }) => { success } }`), it is consulted too.

export interface RateRule {
  name: string;
  limit: number;
  windowMs: number;
}

export interface RateDecision {
  ok: boolean;
  retryAfterSec: number;
}

export function createRateLimiter(opts: { now?: () => number; maxKeys?: number } = {}) {
  const now = opts.now || (() => Date.now());
  const maxKeys = opts.maxKeys ?? 10_000;
  const buckets = new Map<string, { count: number; resetAt: number }>();

  function sweep(t: number) {
    for (const [k, b] of buckets) {
      if (b.resetAt <= t) buckets.delete(k);
    }
    // Still full (a flood of distinct keys): drop the oldest entries rather
    // than grow without bound. Map iteration is insertion order.
    while (buckets.size >= maxKeys) {
      const first = buckets.keys().next();
      if (first.done) break;
      buckets.delete(first.value);
    }
  }

  return {
    check(clientKey: string, rule: RateRule): RateDecision {
      const t = now();
      const key = `${rule.name}:${clientKey}`;
      let b = buckets.get(key);
      if (!b || b.resetAt <= t) {
        if (!b && buckets.size >= maxKeys) sweep(t);
        b = { count: 0, resetAt: t + rule.windowMs };
        buckets.set(key, b);
      }
      b.count += 1;
      if (b.count > rule.limit) {
        return { ok: false, retryAfterSec: Math.max(1, Math.ceil((b.resetAt - t) / 1000)) };
      }
      return { ok: true, retryAfterSec: 0 };
    },
    size() { return buckets.size; },
  };
}

// Routes that spend the App's or OAuth App's credentials, or mint tokens.
const SENSITIVE = [
  /^\/api\/github\/oauth\/(token|validate|revoke|create-repository|refresh)$/,
  /^\/api\/github\/app\/(installation-token|create-repository|installations)$/,
  /^\/api\/github\/app\/installation\/[^/]+$/,
];

export const GLOBAL_RULE: RateRule = { name: 'global', limit: 300, windowMs: 60_000 };
export const SENSITIVE_RULE: RateRule = { name: 'sensitive', limit: 60, windowMs: 60_000 };

export function isSensitivePath(path: string): boolean {
  return SENSITIVE.some((re) => re.test(path));
}
