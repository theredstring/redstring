// Secret patterns shared by secret-scan.mjs and check-dist.mjs.
//
// Each pattern is tuned to the provider's real key shape (prefix + length +
// alphabet) so placeholders in docs ("sk-or-v1-xxxx", "ghp_YOUR_TOKEN",
// a bare "-----BEGIN PRIVATE KEY-----" header) do not trip it. `group` picks
// the capture that holds the secret when the match includes a label.
//
// Output never contains a secret: redact() keeps the known prefix plus three
// characters, and fingerprint() is a truncated SHA-256 that identifies a
// specific value (for allowlisting a revoked key) without revealing it.

import { createHash } from 'node:crypto';

export const PATTERNS = [
  { id: 'openrouter-key', label: 'OpenRouter API key', re: /\bsk-or-v1-[a-f0-9]{64}(?![a-f0-9])/g, prefix: 'sk-or-v1-' },
  { id: 'anthropic-key', label: 'Anthropic API key', re: /\bsk-ant-[A-Za-z0-9_-]{40,}/g, prefix: 'sk-ant-' },
  { id: 'openai-key', label: 'OpenAI API key', re: /\bsk-(?:proj|svcacct|admin)-[A-Za-z0-9_-]{40,}/g, prefix: 'sk-proj-' },
  { id: 'openai-legacy-key', label: 'OpenAI API key (legacy)', re: /\bsk-[A-Za-z0-9]{20}T3BlbkFJ[A-Za-z0-9]{20}(?![A-Za-z0-9])/g, prefix: 'sk-' },
  { id: 'openai-legacy-key', label: 'OpenAI-style sk- key', re: /\bsk-[A-Za-z0-9]{48}(?![A-Za-z0-9])/g, prefix: 'sk-' },
  { id: 'github-token', label: 'GitHub token', re: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36}(?![A-Za-z0-9])/g, prefix: 'gh?_' },
  { id: 'github-pat', label: 'GitHub fine-grained PAT', re: /\bgithub_pat_[A-Za-z0-9_]{60,}/g, prefix: 'github_pat_' },
  { id: 'google-api-key', label: 'Google API key', re: /\bAIza[0-9A-Za-z_-]{35}(?![0-9A-Za-z_-])/g, prefix: 'AIza' },
  { id: 'aws-access-key', label: 'AWS access key id', re: /\b(?:AKIA|ASIA)[0-9A-Z]{16}(?![0-9A-Z])/g, prefix: 'AKIA' },
  { id: 'slack-token', label: 'Slack token', re: /\bxox[baprs]-[A-Za-z0-9-]{10,}/g, prefix: 'xox?-' },
  { id: 'slack-webhook', label: 'Slack webhook URL', re: /https:\/\/hooks\.slack\.com\/services\/T[A-Z0-9]+\/B[A-Z0-9]+\/[A-Za-z0-9]{16,}/g, prefix: 'https://hooks.slack.com/services/' },
  { id: 'stripe-live-key', label: 'Stripe live key', re: /\b(?:sk|rk)_live_[A-Za-z0-9]{24,}/g, prefix: 'sk_live_' },
  { id: 'npm-token', label: 'npm token', re: /\bnpm_[A-Za-z0-9]{36}(?![A-Za-z0-9])/g, prefix: 'npm_' },
  {
    // A header alone (docs, code that builds PEMs) is not a key; require a
    // base64 body line right after it, with a real or JSON-escaped newline.
    id: 'private-key',
    label: 'PEM private key',
    re: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |ENCRYPTED |PGP )?PRIVATE KEY(?: BLOCK)?-----(?:\\r|\\n|\r|\n|\s)+[A-Za-z0-9+/=]{40,}/g,
    prefix: '-----BEGIN PRIVATE KEY-----',
  },
  {
    // GITHUB_CLIENT_SECRET=<40 hex>, "client_secret": "<40 hex>", clientSecret: '<40 hex>'
    id: 'oauth-client-secret',
    label: 'OAuth client secret',
    re: /client[_-]?secret[A-Za-z0-9_]*["']?\s*[:=]\s*["']?([a-f0-9]{40})(?![a-f0-9])/gi,
    group: 1,
    prefix: '',
  },
];

export function fingerprint(value) {
  return createHash('sha256').update(value).digest('hex').slice(0, 16);
}

/** Known prefix + 3 characters of the secret body + length. Never the secret. */
export function redact(pattern, value) {
  if (pattern.id === 'private-key') return '-----BEGIN … PRIVATE KEY----- [body redacted]';
  const m = value.match(/^(sk-or-v1-|sk-ant-(?:api|admin|oat|sid)?\d{0,2}-?|sk-(?:proj|svcacct|admin)-|sk-|gh[pousr]_|github_pat_|AIza|AKIA|ASIA|xox[baprs]-|https:\/\/hooks\.slack\.com\/services\/|[sr]k_live_|npm_)/);
  const prefix = m ? m[1] : '';
  const body = value.slice(prefix.length);
  return `${prefix}${body.slice(0, 3)}… (${value.length} chars)`;
}

/**
 * Scan one text. Returns [{ rule, label, line, redacted, fingerprint }].
 * Overlapping matches of the same value (e.g. a key matching two OpenAI
 * shapes) are reported once.
 */
export function scanText(text) {
  const hits = [];
  const seen = new Set();
  for (const p of PATTERNS) {
    p.re.lastIndex = 0;
    let m;
    while ((m = p.re.exec(text)) !== null) {
      const value = p.group ? m[p.group] : m[0];
      const fp = fingerprint(value);
      const at = m.index + (p.group ? m[0].indexOf(value) : 0);
      const key = `${fp}:${at}`;
      if (seen.has(key)) continue;
      seen.add(key);
      hits.push({
        rule: p.id,
        label: p.label,
        line: text.slice(0, at).split('\n').length,
        redacted: p.group ? `${m[0].slice(0, m[0].indexOf(value)).trim()}${value.slice(0, 3)}… (${value.length} chars)` : redact(p, value),
        fingerprint: fp,
      });
    }
  }
  return hits;
}

/** Heuristic binary check: a NUL byte in the first 8 KB. */
export function isBinary(buf) {
  const n = Math.min(buf.length, 8192);
  for (let i = 0; i < n; i++) if (buf[i] === 0) return true;
  return false;
}
