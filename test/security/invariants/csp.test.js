// @vitest-environment node
// C-8: the Content-Security-Policy meta in index.html. It applies to the web
// app, Electron (app://) and Capacitor alike. scripts/security/check-dist.mjs
// runs the same checks on the built dist/index.html.
import { describe, it } from 'vitest';
import { read, violation, assertRule } from './_lib/scan.js';
import { cspProblems } from '../../../scripts/security/csp-check.mjs';

describe('security invariants: Content-Security-Policy (index.html)', () => {
  it("index.html has a CSP meta with a strict script-src", () => {
    const found = cspProblems(read('index.html')).map((p) => violation('index.html', 0, p));
    assertRule('web/csp', found);
  });
});
