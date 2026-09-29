// @vitest-environment node
// Renderer sink invariants (src/): where untrusted text (universe files, LLM
// output, Wikipedia, GitHub) can become a navigation, a script, HTML or CSS.
// See test/security/README.md for how these rules work and how to add one.
import { describe, it } from 'vitest';
import {
  codeFiles, serverFiles, parseAll, traverse, violation, lineOf, snippet, memberName,
  calleeTail, stringValue, assertRule, importsFrom, isReferenced, exists, parseFile, resolveImport,
} from './_lib/scan.js';

const SRC = codeFiles(['src/']);
const { parsed: SRC_PARSED, unparseable: SRC_UNPARSEABLE } = parseAll(SRC);

const SAFE_URL = 'src/utils/safeUrl.js';
const SAFE_COLOR = 'src/utils/safeColor.js';

// ── URL vetting shared by the href / navigation rules ────────────────────

const DANGEROUS_SCHEME = /^\s*(?:javascript|data|vbscript|file):/i;
const FIXED_PREFIX = /^(?:https?:\/\/|mailto:|\/|#|\.\/|\?)/i;
const SANITIZERS = new Set(['safeExternalHref', 'createObjectURL']);

/**
 * True when the expression at `p` can only produce a URL the app chose:
 * a literal, a template with a fixed https://, mailto:, / or # prefix,
 * safeExternalHref(...), URL.createObjectURL(...), undefined/null, or a
 * never-reassigned local bound to one of those. Anything else (a prop, a
 * member of graph data, a function parameter) is unvetted.
 */
function isVettedUrl(p, depth = 0) {
  if (!p || !p.node || depth > 5) return false;
  const n = p.node;
  switch (n.type) {
    case 'StringLiteral': return !DANGEROUS_SCHEME.test(n.value);
    case 'NullLiteral': return true;
    case 'TemplateLiteral': {
      const head = n.quasis[0].value.cooked ?? '';
      return n.expressions.length === 0 ? !DANGEROUS_SCHEME.test(head) : FIXED_PREFIX.test(head);
    }
    case 'Identifier': {
      if (n.name === 'undefined') return true;
      const binding = p.scope.getBinding(n.name);
      if (!binding || binding.constantViolations.length > 0) return false;
      if (binding.path.isVariableDeclarator() && binding.path.node.id.type === 'Identifier' && binding.path.node.init) {
        return isVettedUrl(binding.path.get('init'), depth + 1);
      }
      return false;
    }
    case 'CallExpression':
    case 'OptionalCallExpression':
      if (SANITIZERS.has(calleeTail(n))) return true;
      // A URL builder (local or imported from this repo) counts when every
      // value it returns is itself vetted, e.g. `return \`https://github.com/...\``.
      return returnsVettedUrl(resolveCalledFunction(p), depth + 1);
    case 'ConditionalExpression':
      return isVettedUrl(p.get('consequent'), depth + 1) && isVettedUrl(p.get('alternate'), depth + 1);
    case 'LogicalExpression':
      if (n.operator === '&&') return isVettedUrl(p.get('right'), depth + 1);
      return isVettedUrl(p.get('left'), depth + 1) && isVettedUrl(p.get('right'), depth + 1);
    case 'AwaitExpression':
      return isVettedUrl(p.get('argument'), depth + 1);
    case 'TSAsExpression':
    case 'TSNonNullExpression':
    case 'ParenthesizedExpression':
      return isVettedUrl(p.get('expression'), depth + 1);
    default:
      return false;
  }
}

// The file being walked, so imported URL builders can be resolved.
let currentFile = null;

/** Babel path of the function a call invokes, if it is defined in this repo. */
function resolveCalledFunction(p) {
  const callee = p.node.callee;
  if (callee.type !== 'Identifier') return null;
  const b = p.scope.getBinding(callee.name);
  if (!b) return null;
  if (b.path.isFunctionDeclaration()) return b.path;
  if (b.path.isVariableDeclarator() && b.path.get('init').isFunction()) return b.path.get('init');
  if (b.path.isImportSpecifier() && currentFile) {
    const target = resolveImport(currentFile, b.path.parentPath.node.source.value);
    const imported = b.path.node.imported.name ?? b.path.node.imported.value;
    const r = target && exists(target) ? parseFile(target) : null;
    if (!r || !r.ast) return null;
    let found = null;
    traverse(r.ast, {
      FunctionDeclaration(fp) { if (!found && fp.node.id?.name === imported) found = fp; },
      VariableDeclarator(vp) { if (!found && vp.node.id.name === imported && vp.get('init').isFunction()) found = vp.get('init'); },
    });
    return found;
  }
  return null;
}

function returnsVettedUrl(fnPath, depth) {
  if (!fnPath || depth > 5) return false;
  if (fnPath.isArrowFunctionExpression() && !fnPath.get('body').isBlockStatement()) return isVettedUrl(fnPath.get('body'), depth);
  const returns = [];
  fnPath.traverse({
    Function(inner) { inner.skip(); },
    ReturnStatement(rp) { returns.push(rp.get('argument')); },
  });
  return returns.length > 0 && returns.every((r) => isVettedUrl(r, depth));
}

/**
 * Does `file` use (reference) one of `fns` exported by `contract` (any export
 * when fns is null), directly or through a src/ module it imports and uses,
 * up to two hops away?
 */
const contractCache = new Map();
function usesContract(file, contract, fns, depth) {
  const key = `${file}|${contract}|${fns}|${depth}`;
  if (contractCache.has(key)) return contractCache.get(key);
  contractCache.set(key, false); // cycle guard
  const r = parseFile(file);
  let ok = false;
  if (r.ast) {
    const names = importsFrom(file, r.ast, contract);
    ok = [...names].some(([local, imported]) => (imported === '*' || !fns || fns.includes(imported)) && (imported === '*' || isReferenced(r.ast, local)));
    if (!ok && depth < 2) {
      for (const node of r.ast.program.body) {
        if (node.type !== 'ImportDeclaration' || !node.source.value.startsWith('.')) continue;
        const dep = resolveImport(file, node.source.value);
        if (!dep || !dep.startsWith('src/') || !exists(dep) || dep === contract) continue;
        if (!node.specifiers.some((sp) => isReferenced(r.ast, sp.local.name))) continue;
        if (usesContract(dep, contract, fns, depth + 1)) { ok = true; break; }
      }
    }
  }
  contractCache.set(key, ok);
  return ok;
}

function eachFile(visitor) {
  const out = [];
  for (const { file, ast, source } of SRC_PARSED) {
    currentFile = file;
    traverse(ast, visitor({ file, source, report: (node, text) => out.push(violation(file, lineOf(node), text ?? snippet(source, node))) }));
  }
  return out;
}

describe('security invariants: renderer sinks (src/)', () => {
  it('every source file parses (no blind spots)', () => {
    assertRule('meta/unparseable', SRC_UNPARSEABLE);
  });

  it('window.open() is only called inside src/utils/safeUrl.js', () => {
    const OPENERS = new Set(['window.open', 'globalThis.open', 'self.open', 'top.open', 'parent.open']);
    const found = eachFile(({ file, report }) => ({
      'CallExpression|OptionalCallExpression'(p) {
        if (file === SAFE_URL) return;
        const name = memberName(p.node.callee);
        const bareGlobalOpen = name === 'open' && !p.scope.hasBinding('open');
        if (OPENERS.has(name) || bareGlobalOpen) report(p.node);
      },
    }));
    assertRule('renderer/window-open', found);
  });

  it('<a href> / <area href> only take vetted URLs', () => {
    const found = eachFile(({ report, source }) => ({
      JSXAttribute(p) {
        const attr = p.node.name.type === 'JSXNamespacedName' ? `${p.node.name.namespace.name}:${p.node.name.name.name}` : p.node.name.name;
        if (!['href', 'xlinkHref', 'xlink:href'].includes(attr)) return;
        const el = p.parentPath.node.name;
        if (el.type !== 'JSXIdentifier' || !['a', 'area'].includes(el.name)) return;
        const value = p.node.value;
        if (!value) return;
        if (value.type === 'StringLiteral') {
          if (DANGEROUS_SCHEME.test(value.value)) report(p.node);
          return;
        }
        if (value.type === 'JSXExpressionContainer' && !isVettedUrl(p.get('value.expression'))) {
          report(p.node, `<${el.name} ${snippet(source, p.node)}>`);
        }
      },
    }));
    assertRule('renderer/anchor-href', found);
  });

  it('navigations (location.href/assign/replace, element.href =) only take vetted URLs', () => {
    const found = eachFile(({ report }) => ({
      AssignmentExpression(p) {
        const left = memberName(p.node.left) || '';
        const isLocation = /(^|\.)location$/.test(left);
        // element.href = … (a bare local named `href` is not a navigation)
        const isHref = /\.href$/.test(left);
        if (!isLocation && !isHref) return;
        if (!isVettedUrl(p.get('right'))) report(p.node);
      },
      'CallExpression|OptionalCallExpression'(p) {
        const name = memberName(p.node.callee) || '';
        if (!/(^|\.)location\.(assign|replace)$/.test(name)) return;
        if (!isVettedUrl(p.get('arguments.0'))) report(p.node);
      },
    }));
    assertRule('renderer/navigation', found);
  });

  it('no raw HTML injection', () => {
    const found = eachFile(({ report }) => ({
      AssignmentExpression(p) {
        const left = p.node.left;
        const prop = (left.type === 'MemberExpression' || left.type === 'OptionalMemberExpression') && !left.computed ? left.property.name : null;
        if (!['innerHTML', 'outerHTML'].includes(prop)) return;
        // A fixed string (usually '' to clear a node) carries no untrusted markup.
        if (stringValue(p.node.right) !== null) return;
        report(p.node);
      },
      'CallExpression|OptionalCallExpression'(p) {
        const tail = calleeTail(p.node);
        const name = memberName(p.node.callee) || '';
        const htmlSink = tail === 'insertAdjacentHTML' || tail === 'createContextualFragment'
          || /(^|\.)document\.(write|writeln)$/.test(name);
        if (!htmlSink) return;
        const htmlArg = tail === 'insertAdjacentHTML' ? p.node.arguments[1] : p.node.arguments[0];
        if (stringValue(htmlArg) !== null) return;
        report(p.node);
      },
      JSXAttribute(p) {
        const attr = p.node.name.name;
        if (attr === 'srcDoc' && p.node.value && p.node.value.type === 'JSXExpressionContainer') {
          report(p.node);
          return;
        }
        if (attr !== 'dangerouslySetInnerHTML') return;
        const expr = p.node.value && p.node.value.type === 'JSXExpressionContainer' ? p.node.value.expression : null;
        const html = expr && expr.type === 'ObjectExpression'
          ? expr.properties.find((pr) => pr.type === 'ObjectProperty' && (pr.key.name === '__html' || pr.key.value === '__html'))
          : null;
        const v = html && html.value;
        const sanitized = v && (v.type === 'CallExpression')
          && (calleeTail(v) === 'sanitizeHtml' || memberName(v.callee) === 'DOMPurify.sanitize');
        if (!sanitized) report(p.node);
      },
    }));
    assertRule('renderer/html-injection', found);
  });

  it('no eval(), new Function(), or string timers (src/, servers, functions/)', () => {
    const files = [...new Set([...SRC, ...serverFiles(), ...codeFiles(['functions/'])])];
    const { parsed } = parseAll(files);
    const out = [];
    for (const { file, ast, source } of parsed) {
      traverse(ast, {
        'CallExpression|NewExpression|OptionalCallExpression'(p) {
          const name = memberName(p.node.callee);
          const report = () => out.push(violation(file, lineOf(p.node), snippet(source, p.node)));
          if ((name === 'eval' && !p.scope.hasBinding('eval')) || name === 'window.eval' || name === 'globalThis.eval') return report();
          if (name === 'Function' && !p.scope.hasBinding('Function')) return report();
          if (['setTimeout', 'setInterval', 'setImmediate', 'window.setTimeout', 'window.setInterval'].includes(name)) {
            const a = p.node.arguments[0];
            if (a && (a.type === 'StringLiteral' || a.type === 'TemplateLiteral'
              || (a.type === 'BinaryExpression' && a.operator === '+'))) report();
          }
          return undefined;
        },
      });
    }
    assertRule('code/dynamic-eval', out);
  });

  it('CSS strings built from data are only built in files that use a safeColor.js sanitizer', () => {
    const found = [];
    for (const { file, ast, source } of SRC_PARSED) {
      const sinks = [];
      traverse(ast, {
        AssignmentExpression(p) {
          const left = memberName(p.node.left) || '';
          if (!/\.cssText$/.test(left)) return;
          if (stringValue(p.node.right) !== null) return;
          sinks.push(violation(file, lineOf(p.node), snippet(source, p.node)));
        },
        CallExpression(p) {
          if (calleeTail(p.node) !== 'setAttribute') return;
          const [name, value] = p.node.arguments;
          if (stringValue(name) !== 'style' || stringValue(value) !== null) return;
          sinks.push(violation(file, lineOf(p.node), snippet(source, p.node)));
        },
      });
      if (sinks.length && !usesContract(file, SAFE_COLOR, null, 0)) found.push(...sinks);
    }
    assertRule('renderer/css-string-from-data', found);
  });

  // The specific sinks the audit found. Each must use the contract helper,
  // directly or through a helper module it imports (up to two hops, e.g.
  // toolResultApplier → linkIdentifier → externalIdentifiers → safeExternalHref).
  // `fns: null` accepts any export of the contract module (e.g. toHex6Color).
  // This is a wiring check; the area suites test the behaviour.
  const WIRING = [
    ['src/formats/redstringFormat.js', SAFE_URL, null, 'S-40: drop unsafe externalLinks / seeAlso / sameAs / wikipediaUrl / origin.href / images on import'],
    ['src/formats/redstringFormat.js', SAFE_COLOR, null, 'S-42: sanitize node / prototype colours on import'],
    ['src/utils/externalIdentifiers.js', SAFE_URL, ['safeExternalHref'], 'S-40: identifierFromUrl must never return a raw href'],
    ['src/utils/nodeOrigin.js', SAFE_URL, ['safeExternalHref'], 'S-40: resolveOrigin must vet origin URLs'],
    ['src/UnifiedSelector.jsx', SAFE_COLOR, null, 'S-42: style={{ background: prototype.color }}'],
    ['src/components/EdgeGlowIndicator.jsx', SAFE_COLOR, null, 'S-42: colour interpolated into style.cssText'],
    ['src/wizard/tools/linkIdentifier.js', SAFE_URL, ['safeExternalHref'], 'S-43: LLM-supplied identifier URLs'],
    ['src/wizard/tools/updateNode.js', SAFE_COLOR, null, 'S-42: LLM-supplied colours'],
    ['src/services/toolResultApplier.js', SAFE_URL, ['safeExternalHref'], 'S-43: writes LLM-supplied links into the graph'],
    ['src/services/toolResultApplier.js', SAFE_COLOR, null, 'S-42: writes LLM-supplied colours into the graph'],
    ['src/Node.jsx', SAFE_URL, ['safeImageSrc'], 'S-46: node thumbnail <image href>'],
    ['src/UniversalNodeRenderer.jsx', SAFE_URL, ['safeImageSrc'], 'S-46: node image <image href>'],
  ];

  it('the audited sinks call the shared sanitizers', () => {
    const found = [];
    for (const [file, contract, fns, why] of WIRING) {
      if (!exists(file)) continue; // a deleted sink is a fixed sink
      if (!parseFile(file).ast) continue; // reported by the parse rule
      if (!usesContract(file, contract, fns, 0)) {
        found.push(violation(file, 0, `does not use ${fns ? `${fns.join('/')}()` : 'a sanitizer'} from ${contract} — ${why}`));
      }
    }
    assertRule('renderer/contract-wiring', found);
  });
});
