// Content-Security-Policy checks shared by test/security/invariants/csp.test.js and
// check-dist.mjs (which runs the same checks on the built
// dist/index.html). Plain string parsing, no DOM, so both can use it.

/** Finds <meta http-equiv="Content-Security-Policy" content="..."> in an HTML string. */
export function findCspMeta(html) {
  const metas = html.match(/<meta\b[^>]*>/gi) || [];
  for (const tag of metas) {
    const equiv = /http-equiv\s*=\s*["']?content-security-policy["']?/i.test(tag);
    if (!equiv) continue;
    const m = tag.match(/content\s*=\s*"([^"]*)"/i) || tag.match(/content\s*=\s*'([^']*)'/i);
    return { tag, policy: m ? m[1].replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&') : '', index: html.indexOf(tag) };
  }
  return null;
}

/** 'a b; c d' → Map { a → [b], c → [d] } (directive names lower-cased). */
export function parsePolicy(policy) {
  const map = new Map();
  for (const part of policy.split(';')) {
    const tokens = part.trim().split(/\s+/).filter(Boolean);
    if (!tokens.length) continue;
    const name = tokens[0].toLowerCase();
    if (!map.has(name)) map.set(name, tokens.slice(1));
  }
  return map;
}

/**
 * Returns a list of human-readable problems with an HTML document's CSP.
 * An empty list means the policy meets the C-8 baseline's hard rules.
 */
export function cspProblems(html) {
  const problems = [];
  const meta = findCspMeta(html);
  if (!meta) return ['no <meta http-equiv="Content-Security-Policy"> tag'];
  const firstScript = html.search(/<script\b/i);
  if (firstScript !== -1 && firstScript < meta.index) problems.push('the CSP meta comes after a <script>; it only applies to content after it, so it must be first in <head>');
  const d = parsePolicy(meta.policy);
  const scriptSrc = d.get('script-src') ?? d.get('default-src');
  if (!scriptSrc) problems.push('no script-src (or default-src) directive');
  else {
    for (const bad of ["'unsafe-eval'", "'unsafe-inline'", '*', 'data:', 'http:', 'https:', 'blob:']) {
      if (scriptSrc.map((t) => t.toLowerCase()).includes(bad)) problems.push(`script-src allows ${bad}`);
    }
  }
  const objectSrc = d.get('object-src') ?? d.get('default-src');
  if (!objectSrc || !(objectSrc.length === 1 && objectSrc[0] === "'none'")) problems.push("object-src is not 'none'");
  if (!d.has('base-uri')) problems.push('no base-uri directive (an injected <base> could redirect every relative script URL)');
  // With no 'unsafe-inline', inline scripts and handlers in the page itself would be blocked.
  const inlineScripts = (html.match(/<script\b(?![^>]*\bsrc\s*=)[^>]*>[\s\S]*?<\/script>/gi) || [])
    .filter((s) => !/type\s*=\s*["']?application\/(ld\+)?json/i.test(s));
  if (inlineScripts.length) problems.push(`${inlineScripts.length} inline <script> block(s) — move them to a file; the CSP blocks them`);
  if (/<[a-z][^>]*\son[a-z]+\s*=/i.test(html)) problems.push('an inline event-handler attribute (onload=, onclick=, …) — the CSP blocks it');
  return problems;
}
