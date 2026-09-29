// @vitest-environment node
// Electron main-process invariants (electron/*.cjs, electron-builder.json,
// entitlements.mac.plist). The renderer is untrusted: every IPC handler must
// check who is calling, and nothing it sends can widen file access.
import { describe, it } from 'vitest';
import {
  codeFiles, parseAll, traverse, violation, lineOf, snippet, memberName, calleeTail,
  stringValue, functionTable, reaches, callsNamed, isFunction, assertRule, read, exists, src,
  findAncestor, walk, isCall,
} from './_lib/scan.js';

const ELECTRON = codeFiles(['electron/']);
const { parsed } = parseAll(ELECTRON);

// One function table across electron/*.cjs, so a guard wrapper defined in
// ipcGuards.cjs and used from main.cjs is followed.
const TABLE = new Map();
for (const f of parsed) for (const [k, v] of functionTable(f.ast)) if (!TABLE.has(k)) TABLE.set(k, v);

const IPC_REGISTRARS = /(^|\.)ipcMain\.(handle|handleOnce|on)$/;

function ipcRegistrations() {
  const out = [];
  for (const { file, ast, source } of parsed) {
    traverse(ast, {
      CallExpression(p) {
        const name = memberName(p.node.callee) || '';
        if (!IPC_REGISTRARS.test(name)) return;
        const channel = stringValue(p.node.arguments[0]);
        out.push({ file, source, path: p, node: p.node, channel, handler: p.node.arguments[1] });
      },
    });
  }
  return out;
}

/** Does the handler argument (inline fn, named fn, or wrapper(fn)) reach pred? */
function handlerReaches(handler, pred) {
  if (!handler) return false;
  if (isFunction(handler)) return reaches(handler, pred, TABLE);
  if (handler.type === 'Identifier') return reaches(TABLE.get(handler.name), pred, TABLE);
  if (isCall(handler)) {
    const wrapper = TABLE.get(calleeTail(handler));
    if (wrapper && reaches(wrapper, pred, TABLE)) return true;
    return handler.arguments.some((a) => handlerReaches(a, pred));
  }
  return false;
}

// String constants declared anywhere in electron/*.cjs (`const APP_SCHEME = 'app'`),
// so a constant shared through require('./ipcGuards.cjs') still resolves.
const CONSTS = new Map();
for (const { ast } of parsed) {
  walk(ast, (n) => {
    if (n.type === 'VariableDeclarator' && n.id.type === 'Identifier' && stringValue(n.init) !== null) {
      CONSTS.set(n.id.name, CONSTS.has(n.id.name) && CONSTS.get(n.id.name) !== stringValue(n.init) ? null : stringValue(n.init));
    }
  });
}

/** The string a path evaluates to when it is a literal or a const bound to one. */
function constString(p, depth = 0) {
  if (!p || !p.node || depth > 3) return null;
  const lit = stringValue(p.node);
  if (lit !== null) return lit;
  if (p.isIdentifier()) {
    const b = p.scope.getBinding(p.node.name);
    if (b && b.path.isVariableDeclarator() && b.path.node.id.type === 'Identifier' && b.path.node.init) return constString(b.path.get('init'), depth + 1);
    // Destructured from another electron module: const { APP_SCHEME } = require('./ipcGuards.cjs')
    if (b && b.path.isVariableDeclarator() && b.path.node.id.type === 'ObjectPattern') {
      const prop = b.path.node.id.properties.find((pr) => pr.type === 'ObjectProperty' && pr.value.name === p.node.name);
      const key = prop && (prop.key.name ?? prop.key.value);
      return key ? (CONSTS.get(key) ?? null) : null;
    }
  }
  return null;
}

/** Source text of an expression plus the initialisers of any identifiers in it. */
function expandedText(p, source) {
  if (!p || !p.node) return '';
  let text = src(source, p.node);
  const addBinding = (ip) => {
    const b = ip.scope.getBinding(ip.node.name);
    if (b && b.path.isVariableDeclarator() && b.path.node.init) text += ` ${src(source, b.path.node.init)}`;
  };
  if (p.isIdentifier()) addBinding(p);
  p.traverse({ Identifier: addBinding });
  return text;
}

describe('security invariants: Electron', () => {
  it('every shell.openExternal(url) is guarded by isSafeExternalUrl(url)', () => {
    const found = [];
    for (const { file, ast, source } of parsed) {
      traverse(ast, {
        CallExpression(p) {
          const name = memberName(p.node.callee) || '';
          if (!/(^|\.)shell\.openExternal$/.test(name)) return;
          const arg = p.node.arguments[0];
          const lit = arg && (stringValue(arg) ?? (arg.type === 'TemplateLiteral' ? arg.quasis[0].value.cooked : null));
          if (lit && /^https:\/\/[^/]+\//i.test(lit)) return; // fixed https:// destination
          const scope = p.getFunctionParent()?.node ?? ast;
          const argText = arg ? src(source, arg) : '';
          let guarded = false;
          walk(scope, (n) => {
            if (guarded) return false;
            if (isCall(n) && calleeTail(n) === 'isSafeExternalUrl' && n.start < p.node.start
              && n.arguments[0] && src(source, n.arguments[0]) === argText) guarded = true;
            return undefined;
          });
          if (!guarded) found.push(violation(file, lineOf(p.node), snippet(source, p.node)));
        },
      });
    }
    assertRule('electron/open-external', found);
  });

  it('every ipcMain handler checks isTrustedSender(event)', () => {
    const found = ipcRegistrations()
      .filter((r) => !handlerReaches(r.handler, callsNamed('isTrustedSender')))
      .map((r) => violation(r.file, lineOf(r.node), `ipcMain handler '${r.channel ?? '?'}' never calls isTrustedSender`));
    assertRule('electron/ipc-sender', found);
  });

  it('no storage:* handler can approve a file path', () => {
    const approves = callsNamed('rememberApprovedPath', 'approve', 'approvePath');
    const found = ipcRegistrations()
      .filter((r) => r.channel && r.channel.startsWith('storage:'))
      .filter((r) => handlerReaches(r.handler, approves))
      .map((r) => violation(r.file, lineOf(r.node), `'${r.channel}' handler reaches a path-approval call`));
    assertRule('electron/no-renderer-approvals', found);
  });

  it('no insecure webPreferences', () => {
    const INSECURE = {
      nodeIntegration: true, nodeIntegrationInWorker: true, nodeIntegrationInSubFrames: true,
      contextIsolation: false, webSecurity: false, sandbox: false, webviewTag: true,
      allowRunningInsecureContent: true, experimentalFeatures: true,
    };
    const found = [];
    for (const { file, ast, source } of parsed) {
      walk(ast, (n) => {
        if (n.type !== 'ObjectProperty' || n.computed) return;
        const key = n.key.name ?? n.key.value;
        if (!(key in INSECURE)) return;
        if (n.value.type === 'BooleanLiteral' && n.value.value === INSECURE[key]) {
          found.push(violation(file, lineOf(n), snippet(source, n)));
        }
      });
    }
    assertRule('electron/web-preferences', found);
  });

  it('electron-builder.json flips the security fuses', () => {
    const REQUIRED = {
      runAsNode: false,
      enableNodeOptionsEnvironmentVariable: false,
      enableNodeCliInspectArguments: false,
      enableEmbeddedAsarIntegrityValidation: true,
      onlyLoadAppFromAsar: true,
      grantFileProtocolExtraPrivileges: false,
      enableCookieEncryption: true,
    };
    const cfg = JSON.parse(read('electron-builder.json'));
    const fuses = cfg.electronFuses || {};
    const found = Object.entries(REQUIRED)
      .filter(([k, v]) => fuses[k] !== v)
      .map(([k, v]) => violation('electron-builder.json', 0, `electronFuses.${k} must be ${v} (is ${JSON.stringify(fuses[k])})`));
    assertRule('electron/fuses', found);
  });

  it('entitlements do not disable library validation or allow unsigned executable memory', () => {
    const cfg = JSON.parse(read('electron-builder.json'));
    const files = new Set(['entitlements.mac.plist', cfg.mac?.entitlements, cfg.mac?.entitlementsInherit].filter(Boolean));
    const BANNED = ['com.apple.security.cs.allow-unsigned-executable-memory', 'com.apple.security.cs.disable-library-validation'];
    const found = [];
    for (const f of files) {
      if (!exists(f)) continue;
      const text = read(f);
      for (const key of BANNED) {
        const re = new RegExp(`<key>\\s*${key.replace(/\./g, '\\.')}\\s*</key>\\s*<true\\s*/>`);
        if (re.test(text)) found.push(violation(f, text.slice(0, text.indexOf(key)).split('\n').length, key));
      }
    }
    assertRule('electron/entitlements', found);
  });

  it('the packaged app is served from app://redstring, not file://', () => {
    const found = [];
    let privileged = false;
    let handled = false;
    for (const { file, ast, source } of parsed) {
      traverse(ast, {
        CallExpression(p) {
          const name = memberName(p.node.callee) || '';
          if (/registerSchemesAsPrivileged$/.test(name)) {
            p.get('arguments.0').traverse({
              ObjectProperty(op) {
                if ((op.node.key.name ?? op.node.key.value) === 'scheme' && constString(op.get('value')) === 'app') privileged = true;
              },
            });
          }
          if (/(^|\.)protocol\.handle$/.test(name) && constString(p.get('arguments.0')) === 'app') handled = true;
          if (file === 'electron/main.cjs' && calleeTail(p.node) === 'loadFile') {
            const arg = p.get('arguments.0');
            let text = arg.node ? src(source, arg.node) : '';
            if (arg.isIdentifier()) {
              const b = p.scope.getBinding(arg.node.name);
              if (b && b.path.isVariableDeclarator() && b.path.node.init) text += src(source, b.path.node.init);
            }
            if (/dist|index\.html/.test(text)) found.push(violation(file, lineOf(p.node), `${snippet(source, p.node)} — app UI loaded over file://`));
          }
        },
      });
    }
    if (!privileged) found.push(violation('electron/', 0, "no protocol.registerSchemesAsPrivileged([{ scheme: 'app', ... }])"));
    if (!handled) found.push(violation('electron/', 0, "no protocol.handle('app', ...)"));
    assertRule('electron/app-origin', found);
  });

  it('navigation is locked and permission requests are handled', () => {
    const events = new Set();
    const calls = new Set();
    for (const { ast } of parsed) {
      walk(ast, (n) => {
        if (!isCall(n)) return;
        const tail = calleeTail(n);
        if (tail === 'on' || tail === 'once') {
          const ev = stringValue(n.arguments[0]);
          if (ev) events.add(ev);
        }
        if (tail) calls.add(tail);
      });
    }
    const found = [];
    for (const ev of ['will-navigate', 'will-redirect']) {
      if (!events.has(ev)) found.push(violation('electron/', 0, `no '${ev}' handler`));
    }
    for (const fn of ['setPermissionRequestHandler', 'setPermissionCheckHandler']) {
      if (!calls.has(fn)) found.push(violation('electron/', 0, `session.${fn}(...) is never called`));
    }
    assertRule('electron/navigation-lock', found);
  });

  it('updater:debug-downgrade is only registered in development', () => {
    const found = ipcRegistrations()
      .filter((r) => r.channel === 'updater:debug-downgrade')
      .filter((r) => !findAncestor(r.path, (n, ap) =>
        (n.type === 'IfStatement' || n.type === 'ConditionalExpression' || n.type === 'LogicalExpression')
        && /isPackaged|isDev|REDSTRING_ENABLE_DEBUG_DOWNGRADE/.test(expandedText(ap.get(n.test ? 'test' : 'left'), r.source))))
      .map((r) => violation(r.file, lineOf(r.node), 'registered unconditionally (packaged builds expose it)'));
    assertRule('electron/dev-only-surface', found);
  });

  it('isDev never depends on NODE_ENV', () => {
    const found = [];
    for (const { file, ast, source } of parsed) {
      walk(ast, (n) => {
        if (n.type === 'VariableDeclarator' && n.id.type === 'Identifier' && n.id.name === 'isDev'
          && n.init && /NODE_ENV/.test(src(source, n.init))) found.push(violation(file, lineOf(n), snippet(source, n)));
      });
    }
    assertRule('electron/is-dev', found);
  });

  it('nothing is started through ELECTRON_RUN_AS_NODE', () => {
    const found = [];
    for (const { file, ast, source } of parsed) {
      walk(ast, (n) => {
        const key = n.type === 'ObjectProperty' ? (n.key.name ?? n.key.value) : null;
        const lit = n.type === 'StringLiteral' ? n.value : null;
        if (key === 'ELECTRON_RUN_AS_NODE' || lit === 'ELECTRON_RUN_AS_NODE') found.push(violation(file, lineOf(n), snippet(source, n)));
      });
    }
    assertRule('electron/no-run-as-node', found);
  });

  // The swap is whatever function spawns /bin/bash. Every path to it must pass
  // through verifyBundleSignature first: either the spawning function checks,
  // or each of its callers checks before calling it.
  function bashSpawns() {
    const out = [];
    for (const { file, ast, source } of parsed) {
      traverse(ast, {
        CallExpression(p) {
          if (calleeTail(p.node) !== 'spawn' || stringValue(p.node.arguments[0]) !== '/bin/bash') return;
          out.push({ file, source, path: p, node: p.node });
        },
      });
    }
    return out;
  }

  it('the macOS update swap verifies the code signature first', () => {
    const found = [];
    const verifies = callsNamed('verifyBundleSignature');
    for (const s of bashSpawns()) {
      const fnPath = s.path.getFunctionParent();
      const fnName = fnPath?.node.id?.name ?? (fnPath?.parentPath?.isVariableDeclarator() ? fnPath.parentPath.node.id.name : null);
      if (fnPath && reaches(fnPath.node, verifies, TABLE)) continue;
      // Otherwise every caller must verify before it calls the swap.
      const callers = [];
      for (const { file, ast, source } of parsed) {
        traverse(ast, {
          CallExpression(p) {
            if (!fnName || calleeTail(p.node) !== fnName) return;
            const scope = p.getFunctionParent()?.node ?? ast;
            let ok = false;
            walk(scope, (n) => {
              if (ok || !isCall(n) || n.start >= p.node.start) return;
              const tail = calleeTail(n);
              if (tail === 'verifyBundleSignature' || (tail !== fnName && reaches(TABLE.get(tail), verifies, TABLE))) ok = true;
            });
            callers.push({ file, line: lineOf(p.node), ok, text: snippet(source, p.node) });
          },
        });
      }
      if (callers.length === 0) {
        found.push(violation(s.file, lineOf(s.node), 'bash swap spawn with no verifyBundleSignature on its path'));
      }
      for (const c of callers.filter((x) => !x.ok)) found.push(violation(c.file, c.line, `${c.text} — swap without a prior verifyBundleSignature()`));
    }
    assertRule('electron/updater-signature', found);
  });

  /** Does the argv expression (array, const, or builder function's return) carry more than '-c script'? */
  function argvHasPaths(p, depth = 0) {
    if (!p || !p.node || depth > 4) return false;
    if (p.isArrayExpression()) return p.node.elements.length > 2;
    if (p.isIdentifier()) {
      const b = p.scope.getBinding(p.node.name);
      return !!(b && b.path.isVariableDeclarator() && b.path.node.init && argvHasPaths(b.path.get('init'), depth + 1));
    }
    if (p.isCallExpression()) {
      const fn = TABLE.get(calleeTail(p.node));
      if (!fn) return false;
      let ok = false;
      walk(fn, (n) => {
        if (n.type === 'ReturnStatement' && n.argument && n.argument.type === 'ArrayExpression' && n.argument.elements.length > 2) ok = true;
      });
      return ok;
    }
    return false;
  }

  it('the swap script gets its paths as argv', () => {
    const found = bashSpawns()
      .filter((s) => !argvHasPaths(s.path.get('arguments.1')))
      .map((s) => violation(s.file, lineOf(s.node), `${snippet(s.source, s.node)} — only '-c script', paths must follow as argv`));
    assertRule('electron/updater-argv', found);
  });
});
