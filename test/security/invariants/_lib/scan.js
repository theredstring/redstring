// Shared helpers for the security invariant tests: file listing, parsing,
// the allowlist, and the failure message format.
//
// Parsing uses @babel/parser + @babel/traverse (already in the tree through
// @vitejs/plugin-react) so the rules look at real syntax, not text: a comment
// or a string that mentions window.open is not a call to it.

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parse } from '@babel/parser';
import _traverse from '@babel/traverse';
import { rule as getRule, RULES } from './rules.js';

export const traverse = _traverse.default ?? _traverse;
export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
export const ALLOWLIST_PATH = 'test/security/invariants/allowlist.json';

// ── Files ────────────────────────────────────────────────────────────────

let fileListCache = null;
/**
 * Every file git would consider part of the tree: tracked files plus new,
 * not-ignored ones (fixes are validated before they are committed), minus
 * files deleted in the working tree. Repo-relative POSIX paths.
 */
export function allRepoFiles() {
  if (!fileListCache) {
    const out = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], {
      cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
    });
    fileListCache = [...new Set(out.split('\0').filter(Boolean))]
      .filter((f) => fs.existsSync(path.join(ROOT, f)))
      .sort();
  }
  return fileListCache;
}

export function trackedFiles() {
  const out = execFileSync('git', ['ls-files', '--cached', '-z'], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  // A file staged for removal (git rm --cached) is no longer in the index, so
  // it does not appear here; that is the state that will be committed.
  return out.split('\0').filter(Boolean);
}

const CODE_EXT = /\.(?:js|jsx|mjs|cjs|ts|tsx)$/;
const TEST_FILE = /(?:\.test\.|\.spec\.|__tests__\/|__mocks__\/)/;

/** Source files under the given top-level prefixes (e.g. 'src/'), tests excluded. */
export function codeFiles(prefixes, { includeTests = false } = {}) {
  return allRepoFiles().filter((f) =>
    CODE_EXT.test(f)
    && prefixes.some((p) => (p.endsWith('/') ? f.startsWith(p) : f === p))
    && (includeTests || !TEST_FILE.test(f)));
}

/** Files that run as Node servers or processes (not the renderer bundle). */
export function serverFiles() {
  return codeFiles([
    'agent-server.js', 'wizard-server.js', 'redstring-mcp-server.js', 'bridge-daemon.js', 'oauth-server.js',
    'cli/', 'src/headless/', 'src/security/', 'deployment/', 'electron/',
  ]);
}

export function exists(rel) {
  return fs.existsSync(path.join(ROOT, rel));
}

export function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

// ── Parsing ──────────────────────────────────────────────────────────────

const parseCache = new Map();
/** Returns { ast, source } or { error, source }. Cached per file. */
export function parseFile(rel) {
  if (parseCache.has(rel)) return parseCache.get(rel);
  const source = read(rel);
  let result;
  try {
    const plugins = ['jsx'];
    if (/\.tsx?$/.test(rel)) plugins.push('typescript');
    const ast = parse(source, {
      sourceType: 'unambiguous',
      allowReturnOutsideFunction: true,
      allowAwaitOutsideFunction: true,
      plugins,
    });
    result = { ast, source };
  } catch (error) {
    result = { error: error.message, source };
  }
  parseCache.set(rel, result);
  return result;
}

/** Parse many files; unparseable ones are returned separately (rule meta/unparseable). */
export function parseAll(files) {
  const parsed = [];
  const unparseable = [];
  for (const f of files) {
    const r = parseFile(f);
    if (r.ast) parsed.push({ file: f, ...r });
    else unparseable.push(violation(f, 1, `does not parse: ${r.error}`));
  }
  return { parsed, unparseable };
}

// ── AST utilities ────────────────────────────────────────────────────────

/** Source text of a node, collapsed to one line and shortened for messages. */
export function snippet(source, node, max = 110) {
  const text = source.slice(node.start, node.end).replace(/\s+/g, ' ').trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

export function src(source, node) {
  return source.slice(node.start, node.end);
}

/** `a.b.c` for a MemberExpression chain of identifiers, else null. */
export function memberName(node) {
  if (!node) return null;
  if (node.type === 'Identifier') return node.name;
  if (node.type === 'ThisExpression') return 'this';
  if ((node.type === 'MemberExpression' || node.type === 'OptionalMemberExpression') && !node.computed) {
    const obj = memberName(node.object);
    return obj ? `${obj}.${node.property.name}` : null;
  }
  if ((node.type === 'MemberExpression' || node.type === 'OptionalMemberExpression')
    && node.computed && node.property.type === 'StringLiteral') {
    const obj = memberName(node.object);
    return obj ? `${obj}.${node.property.value}` : null;
  }
  return null;
}

/** Callee name of a call: 'foo', 'a.b.foo', or null. */
export function calleeName(call) {
  return memberName(call.callee);
}

/** Last segment of a callee: foo for a.b.foo(). */
export function calleeTail(call) {
  const c = call.callee;
  if (c.type === 'Identifier') return c.name;
  if ((c.type === 'MemberExpression' || c.type === 'OptionalMemberExpression') && !c.computed) return c.property.name;
  return null;
}

export function isCall(node) {
  return node && (node.type === 'CallExpression' || node.type === 'OptionalCallExpression' || node.type === 'NewExpression');
}

export function stringValue(node) {
  if (!node) return null;
  if (node.type === 'StringLiteral') return node.value;
  if (node.type === 'TemplateLiteral' && node.expressions.length === 0) return node.quasis[0].value.cooked;
  return null;
}

/** Generic child walk over a Babel node (no scope tracking). */
export function walk(node, visit, parent = null) {
  if (!node || typeof node.type !== 'string') return;
  if (visit(node, parent) === false) return;
  for (const key of Object.keys(node)) {
    if (key === 'loc' || key === 'start' || key === 'end' || key === 'leadingComments'
      || key === 'trailingComments' || key === 'innerComments' || key === 'extra') continue;
    const child = node[key];
    if (Array.isArray(child)) {
      for (const c of child) if (c && typeof c.type === 'string') walk(c, visit, node);
    } else if (child && typeof child.type === 'string') {
      walk(child, visit, node);
    }
  }
}

const FN_TYPES = new Set(['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression', 'ObjectMethod', 'ClassMethod']);
export const isFunction = (n) => n && FN_TYPES.has(n.type);

/**
 * Named functions in a file: function declarations, `const x = () => {}` /
 * `function` expressions, `x = function` assignments, object methods, and
 * `module.exports = { x }` style re-bindings are all found by name.
 */
export function functionTable(ast) {
  const table = new Map();
  walk(ast, (n) => {
    if (n.type === 'FunctionDeclaration' && n.id) table.set(n.id.name, n);
    if (n.type === 'VariableDeclarator' && n.id.type === 'Identifier' && isFunction(n.init)) table.set(n.id.name, n.init);
    if (n.type === 'AssignmentExpression' && isFunction(n.right)) {
      const name = memberName(n.left);
      if (name) table.set(name.split('.').pop(), n.right);
    }
    if ((n.type === 'ObjectMethod' || n.type === 'ClassMethod') && n.key && n.key.type === 'Identifier') table.set(n.key.name, n);
    if (n.type === 'ObjectProperty' && n.key && n.key.type === 'Identifier' && isFunction(n.value)) table.set(n.key.name, n.value);
  });
  return table;
}

/**
 * Does `fnNode` (or anything it calls by name, transitively through `table`)
 * contain a node for which `pred(node)` is true?
 */
export function reaches(fnNode, pred, table, seen = new Set()) {
  if (!fnNode || seen.has(fnNode)) return false;
  seen.add(fnNode);
  let found = false;
  walk(fnNode, (n) => {
    if (found) return false;
    if (pred(n)) { found = true; return false; }
    if (isCall(n)) {
      const tail = calleeTail(n);
      if (tail && table.has(tail) && reaches(table.get(tail), pred, table, seen)) { found = true; return false; }
      // Functions passed by reference as arguments: wrap(handler)
      for (const a of n.arguments || []) {
        if (a.type === 'Identifier' && table.has(a.name) && reaches(table.get(a.name), pred, table, seen)) { found = true; return false; }
      }
    }
    return undefined;
  });
  return found;
}

export const callsNamed = (...names) => (n) => isCall(n) && names.includes(calleeTail(n));
export const mentionsIdentifier = (...names) => (n) => n.type === 'Identifier' && names.includes(n.name);

/** Resolve a relative import specifier from `fromFile` to a repo-relative path (extension optional). */
export function resolveImport(fromFile, spec) {
  if (!spec.startsWith('.')) return null;
  const base = path.posix.normalize(path.posix.join(path.posix.dirname(fromFile), spec));
  for (const cand of [base, `${base}.js`, `${base}.ts`, `${base}.jsx`, `${base}.cjs`, `${base}.mjs`, `${base}/index.js`, `${base}/index.ts`]) {
    if (exists(cand) && fs.statSync(path.join(ROOT, cand)).isFile()) return cand;
  }
  return base;
}

/**
 * Names imported (ESM import or CommonJS require destructuring) from a module
 * whose resolved path is `target` (repo-relative, extension-insensitive).
 * Returns a Map localName → importedName.
 */
export function importsFrom(file, ast, target) {
  const strip = (p) => p && p.replace(/\.(?:js|ts|jsx|cjs|mjs)$/, '');
  const want = strip(target);
  const names = new Map();
  walk(ast, (n) => {
    if (n.type === 'ImportDeclaration' && strip(resolveImport(file, n.source.value)) === want) {
      for (const s of n.specifiers) names.set(s.local.name, s.imported ? (s.imported.name ?? s.imported.value) : 'default');
    }
    if (n.type === 'VariableDeclarator' && isCall(n.init) && calleeName(n.init) === 'require'
      && n.init.arguments[0] && n.init.arguments[0].type === 'StringLiteral'
      && strip(resolveImport(file, n.init.arguments[0].value)) === want) {
      if (n.id.type === 'ObjectPattern') {
        for (const p of n.id.properties) if (p.type === 'ObjectProperty') names.set(p.value.name, p.key.name);
      } else if (n.id.type === 'Identifier') {
        names.set(n.id.name, '*');
      }
    }
    // Dynamic import: const { x } = await import('../utils/safeUrl.js')
    if (n.type === 'VariableDeclarator' && n.id.type === 'ObjectPattern') {
      let init = n.init;
      if (init && init.type === 'AwaitExpression') init = init.argument;
      if (init && init.type === 'ImportExpression' || (init && init.type === 'CallExpression' && init.callee.type === 'Import')) {
        const arg = init.source ?? init.arguments?.[0];
        if (arg && arg.type === 'StringLiteral' && strip(resolveImport(file, arg.value)) === want) {
          for (const p of n.id.properties) if (p.type === 'ObjectProperty') names.set(p.value.name, p.key.name);
        }
      }
    }
  });
  return names;
}

/** Is `name` used anywhere in the file other than in its import/require binding? */
export function isReferenced(ast, localName) {
  let found = false;
  traverse(ast, {
    Identifier(p) {
      if (!found && p.node.name === localName && p.isReferencedIdentifier()) { found = true; p.stop(); }
    },
    JSXIdentifier(p) {
      if (!found && p.node.name === localName && p.isReferencedIdentifier()) { found = true; p.stop(); }
    },
  });
  return found;
}

/** Nearest enclosing ancestor for which pred is true, given a Babel path. */
export function findAncestor(p, pred) {
  let cur = p.parentPath;
  while (cur) {
    if (pred(cur.node, cur)) return cur;
    cur = cur.parentPath;
  }
  return null;
}

// ── Violations, allowlist, messages ──────────────────────────────────────

export function violation(file, line, text) {
  return { file, line, text };
}

export function lineOf(node) {
  return node?.loc?.start?.line ?? 1;
}

let allowlistCache = null;
export function loadAllowlist() {
  if (!allowlistCache) {
    const data = JSON.parse(read(ALLOWLIST_PATH));
    allowlistCache = Array.isArray(data.entries) ? data.entries : [];
  }
  return allowlistCache;
}

/**
 * Splits violations into { remaining, allowed } using allowlist.json, and
 * reports allowlist entries for this rule that matched nothing (stale).
 * An entry matches when rule and file are equal and, if it has `contains`,
 * the violation text includes that string.
 */
export function applyAllowlist(ruleId, violations) {
  const entries = loadAllowlist().filter((e) => e.rule === ruleId);
  const used = new Set();
  const remaining = [];
  for (const v of violations) {
    const hit = entries.find((e) => e.file === v.file && (!e.contains || v.text.includes(e.contains)));
    if (hit) used.add(hit);
    else remaining.push(v);
  }
  const stale = entries.filter((e) => !used.has(e));
  return { remaining, stale };
}

/** Formats the failure message: what broke, why it matters, how to fix, where. */
export function formatFailure(ruleId, violations, { extra } = {}) {
  const r = getRule(ruleId);
  const lines = [
    '',
    `SECURITY INVARIANT BROKEN [${r.id}] ${r.title}`,
    `  Why it matters: ${r.why}`,
    `  How to fix:     ${r.fix}`,
    r.findings.length ? `  Audit refs:     ${r.findings.join(', ')} (documentation/security/HARDENING_PLAN.md)` : null,
    extra ? `  Note:           ${extra}` : null,
    `  ${violations.length} violation(s):`,
    ...violations.slice(0, 60).map((v) => `    ${v.file}${v.line ? `:${v.line}` : ''}  ${v.text}`),
    violations.length > 60 ? `    … and ${violations.length - 60} more` : null,
    `  A genuine exception goes in ${ALLOWLIST_PATH} as { "rule": "${r.id}", "file": "...", "reason": "..." }.`,
  ];
  return lines.filter((l) => l !== null).join('\n');
}

function formatStale(ruleId, stale) {
  return [
    '',
    `STALE ALLOWLIST ENTRY [${ruleId}] — these entries in ${ALLOWLIST_PATH} no longer match anything.`,
    '  The code they excused was fixed or moved; delete them so they cannot hide a future regression:',
    ...stale.map((e) => `    ${e.file}${e.contains ? ` (contains "${e.contains}")` : ''} — ${e.reason}`),
  ].join('\n');
}

/**
 * The single assertion every rule uses. Throws with the formatted message when
 * there are unallowlisted violations or stale allowlist entries for the rule.
 */
export function assertRule(ruleId, violations, opts = {}) {
  const { remaining, stale } = applyAllowlist(ruleId, violations);
  const problems = [];
  if (remaining.length) problems.push(formatFailure(ruleId, remaining, opts));
  if (stale.length && !opts.skipStaleCheck) problems.push(formatStale(ruleId, stale));
  if (problems.length) throw new Error(problems.join('\n'));
}

export const RULE_IDS = Object.keys(RULES);
