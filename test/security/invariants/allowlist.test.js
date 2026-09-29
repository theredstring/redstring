// @vitest-environment node
// Keeps test/security/invariants/allowlist.json honest: every exception names
// a real rule and a real file and says why it is safe. Stale entries (ones
// that no longer match a violation) are caught by each rule's own test.
import { describe, it, expect } from 'vitest';
import { loadAllowlist, RULE_IDS, exists, read, ALLOWLIST_PATH } from './_lib/scan.js';

describe(`${ALLOWLIST_PATH}`, () => {
  const entries = loadAllowlist();

  it('every entry names a known rule, an existing file, and a real reason', () => {
    const problems = [];
    entries.forEach((e, i) => {
      const at = `entry #${i + 1} (${e.rule} ${e.file})`;
      if (!RULE_IDS.includes(e.rule)) problems.push(`${at}: unknown rule id — see test/security/invariants/_lib/rules.js`);
      if (typeof e.file !== 'string' || !e.file) problems.push(`${at}: "file" is required`);
      else if (!exists(e.file) && !e.file.endsWith('/')) problems.push(`${at}: file does not exist (fixed or moved? delete the entry)`);
      if (typeof e.reason !== 'string' || e.reason.trim().length < 40) {
        problems.push(`${at}: "reason" must explain why untrusted input cannot reach this code (40+ characters)`);
      }
      const extra = Object.keys(e).filter((k) => !['rule', 'file', 'contains', 'reason'].includes(k));
      if (extra.length) problems.push(`${at}: unknown field(s) ${extra.join(', ')}`);
    });
    expect(problems, problems.join('\n')).toEqual([]);
  });

  it('every rule is listed in documentation/security/THREAT_MODEL.md', () => {
    const doc = read('documentation/security/THREAT_MODEL.md');
    const missing = RULE_IDS.filter((id) => !doc.includes(`\`${id}\``));
    expect(missing, `add these rule ids to the invariants table in THREAT_MODEL.md: ${missing.join(', ')}`).toEqual([]);
  });

  it('has no duplicate entries', () => {
    const keys = entries.map((e) => `${e.rule}\u0000${e.file}\u0000${e.contains ?? ''}`);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
