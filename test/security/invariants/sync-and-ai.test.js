// @vitest-environment node
// Data-safety and AI-consent invariants that span platforms: the empty-write
// guard in git sync (S-75) and the consent gate before third-party LLM calls
// (S-81).
import { describe, it } from 'vitest';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT, exists, parseFile, walk, violation, assertRule, calleeTail, isCall } from './_lib/scan.js';

const GUARD = 'src/services/emptyWriteGuard.js';
const CONSENT = 'src/services/aiConsent.js';

describe('security invariants: sync data safety and AI consent', () => {
  it('an error that only *mentions* 404 never makes an empty write safe', async () => {
    const mod = await import(pathToFileURL(path.join(ROOT, GUARD)).href);
    const found = [];
    // Errors whose only "not found" signal is in the message, or whose
    // structured status says something else.
    const ambiguous = [
      new Error('Request failed with status 404'),
      new Error('File not found'),
      Object.assign(new Error('404 Not Found'), { status: 403 }),
      Object.assign(new Error('Not Found'), { status: 500 }),
      Object.assign(new Error('boom'), { code: 'FILE_NOT_FOUND', status: 401 }),
    ];
    for (const err of ambiguous) {
      const r = await mod.checkDestinationBeforeEmptyWrite({ readDestination: async () => { throw err; }, label: 'invariant-test' });
      if (r.safe) {
        found.push(violation(GUARD, 0, `treated as safe to overwrite: "${err.message}"${err.status ? ` (status ${err.status})` : ''}${err.code ? ` (code ${err.code})` : ''}`));
      }
    }
    // A structured not-found must still count, or new universes could never be written.
    const absent = Object.assign(new Error('missing'), { code: 'FILE_NOT_FOUND' });
    const r = await mod.checkDestinationBeforeEmptyWrite({ readDestination: async () => { throw absent; }, label: 'invariant-test' });
    if (!r.safe) found.push(violation(GUARD, 0, "a { code: 'FILE_NOT_FOUND' } error is not treated as absent (first writes would be refused)"));
    assertRule('sync/not-found-structured', found);
  });

  it('a consent gate is registered in front of third-party LLM requests', () => {
    const found = [];
    if (!exists(CONSENT)) {
      found.push(violation(CONSENT, 0, 'missing'));
    } else {
      const r = parseFile(CONSENT);
      let registers = false;
      walk(r.ast, (n) => {
        if (n.type === 'ImportDeclaration' && /^react(-dom)?(\/|$)/.test(n.source.value)) {
          found.push(violation(CONSENT, n.loc.start.line, `imports ${n.source.value}; keep the gate UI-free (Node/MCP load it)`));
        }
        if (isCall(n) && calleeTail(n) === 'setLLMRequestGate') registers = true;
      });
      if (!registers) found.push(violation(CONSENT, 0, 'never calls setLLMRequestGate(...)'));
    }
    const llm = parseFile('src/wizard/LLMClient.js');
    let exported = false;
    walk(llm.ast, (n) => {
      if (n.type === 'ExportNamedDeclaration' && n.declaration?.type === 'FunctionDeclaration' && n.declaration.id.name === 'setLLMRequestGate') exported = true;
    });
    if (!exported) found.push(violation('src/wizard/LLMClient.js', 0, 'does not export setLLMRequestGate'));
    assertRule('ai/consent-gate', found);
  });
});
