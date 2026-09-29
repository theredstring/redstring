// The security invariants, one entry per rule. Each test file looks its rule
// up here, so the failure message always says the same three things:
// what rule was broken, why it matters, and how to fix it.
//
// `findings` point at the audit IDs in documentation/security/HARDENING_PLAN.md.
// `test` is the file that enforces the rule (documentation/security/THREAT_MODEL.md
// links each threat to these).

export const RULES = {
  // ── Renderer (src/) ────────────────────────────────────────────────────
  'renderer/window-open': {
    title: 'window.open() is only called inside src/utils/safeUrl.js',
    why: 'URLs in universe files are attacker-controlled; javascript:, file: and custom schemes must be filtered before opening.',
    fix: "Call openExternalUrl(url) from src/utils/safeUrl.js instead of window.open(...).",
    findings: ['S-40', 'C-1'],
    test: 'renderer-sinks.test.js',
  },
  'renderer/anchor-href': {
    title: '<a href={...}> only takes a literal, an https:// or mailto: template, or safeExternalHref(...)',
    why: 'A javascript: or data: href runs code in the app origin when clicked (XSS, and in Electron it can reach the file IPC).',
    fix: "Wrap the value: href={safeExternalHref(url) ?? undefined} (src/utils/safeUrl.js), or build it from a fixed https:// prefix.",
    findings: ['S-40', 'C-1'],
    test: 'renderer-sinks.test.js',
  },
  'renderer/navigation': {
    title: 'location.href / location.assign / element.href only receive vetted URLs',
    why: 'Navigating to a javascript: URL runs it; navigating the Electron window away from the app drops every protection.',
    fix: 'Assign a literal or https:// template, URL.createObjectURL(...) for downloads, or safeExternalHref(url).',
    findings: ['S-40', 'C-1'],
    test: 'renderer-sinks.test.js',
  },
  'renderer/html-injection': {
    title: 'No raw HTML injection: innerHTML/outerHTML/insertAdjacentHTML/document.write, and dangerouslySetInnerHTML only via sanitizeHtml()/DOMPurify',
    why: 'HTML from Wikipedia, LLM output or a universe file can carry <img onerror> and similar script.',
    fix: "Parse with new DOMParser().parseFromString(html, 'text/html') and read text, or pass sanitizeHtml(html) (src/utils/sanitizeHtml.js).",
    findings: ['S-44'],
    test: 'renderer-sinks.test.js',
  },
  'code/dynamic-eval': {
    title: 'No eval(), new Function(), or setTimeout/setInterval with a string',
    why: 'String-to-code turns any injected text into script, and the CSP (C-8) forbids it, so it would also break at runtime.',
    fix: 'Use a real function or a lookup table instead of building code from strings.',
    findings: ['C-8'],
    test: 'renderer-sinks.test.js',
  },
  'renderer/css-string-from-data': {
    title: 'CSS strings built from data (style.cssText, setAttribute("style")) are only built in files that use a safeColor.js sanitizer',
    why: "A node colour like red;background:url(https://tracker) or '}...' injects arbitrary CSS through cssText.",
    fix: "Pass every data colour through sanitizeColor(value, fallback) (or toHex6Color) from src/utils/safeColor.js before it reaches the string.",
    findings: ['S-42', 'C-2'],
    test: 'renderer-sinks.test.js',
  },
  'renderer/contract-wiring': {
    title: 'The sinks the audit found use the shared sanitizers (safeUrl / safeColor)',
    why: 'These files turn untrusted graph data into links, images, colours or imports; each must call the shared sanitizer.',
    fix: 'Import the named function from the contract module and call it on the value before it is rendered or stored.',
    findings: ['S-40', 'S-42', 'S-43', 'S-46', 'C-1', 'C-2'],
    test: 'renderer-sinks.test.js',
  },

  // ── Electron ───────────────────────────────────────────────────────────
  'electron/open-external': {
    title: 'Every shell.openExternal(url) is preceded by isSafeExternalUrl(url) in the same function',
    why: 'openExternal hands the URL to the OS: file:, smb: or a custom scheme can launch programs or leak NTLM hashes.',
    fix: "if (!isSafeExternalUrl(url)) return false; before shell.openExternal(url) (electron/ipcGuards.cjs).",
    findings: ['S-22', 'C-3'],
    test: 'electron.test.js',
  },
  'electron/ipc-sender': {
    title: 'Every ipcMain.handle / ipcMain.on handler checks isTrustedSender(event)',
    why: 'Without a sender check, any frame or navigated page in the window can drive file, storage and updater IPC.',
    fix: "Start the handler with: if (!isTrustedSender(event)) throw new Error('untrusted sender'); (or register through a wrapper that does).",
    findings: ['S-23', 'C-3'],
    test: 'electron.test.js',
  },
  'electron/no-renderer-approvals': {
    title: 'No storage:* IPC handler can approve a file path',
    why: 'If the renderer can write an "approved path" record, one XSS gets read/write on any file the user owns.',
    fix: 'Approve paths only from main-side showOpenDialog/showSaveDialog results (createPathApprovals in electron/ipcGuards.cjs).',
    findings: ['S-20', 'C-3'],
    test: 'electron.test.js',
  },
  'electron/web-preferences': {
    title: 'No insecure webPreferences (nodeIntegration, contextIsolation:false, webSecurity:false, sandbox:false, webviewTag, allowRunningInsecureContent)',
    why: 'Each of these hands renderer content (graph data, remote pages) a path to Node or to other origins.',
    fix: 'Remove the property or set it to the secure value; expose what the renderer needs through preload.cjs instead.',
    findings: ['S-23'],
    test: 'electron.test.js',
  },
  'electron/fuses': {
    title: 'electron-builder.json flips the Electron fuses (S-26)',
    why: 'With default fuses, ELECTRON_RUN_AS_NODE / NODE_OPTIONS / --inspect turn the signed app into a signed Node runtime for malware.',
    fix: 'Set "electronFuses" in electron-builder.json exactly as listed in the failure.',
    findings: ['S-26'],
    test: 'electron.test.js',
  },
  'electron/entitlements': {
    title: 'macOS entitlements do not disable library validation or allow unsigned executable memory',
    why: 'Those entitlements let any unsigned dylib or code page load into the signed, notarised app.',
    fix: 'Delete the two keys from entitlements.mac.plist (keep com.apple.security.cs.allow-jit).',
    findings: ['S-27'],
    test: 'electron.test.js',
  },
  'electron/app-origin': {
    title: 'The packaged app is served from app://redstring, not file://',
    why: 'file:// gives the page file-origin privileges and an opaque "null" Origin that local servers cannot distinguish from attackers.',
    fix: 'registerSchemesAsPrivileged([{ scheme: "app", ... }]) + protocol.handle("app", ...), and loadURL("app://redstring/index.html") (C-5).',
    findings: ['S-26', 'C-5'],
    test: 'electron.test.js',
  },
  'electron/navigation-lock': {
    title: 'The main window locks navigation and denies permission requests by default',
    why: 'A link or redirect that navigates the window to a remote page gives that page the preload API.',
    fix: "Add will-navigate / will-redirect handlers that preventDefault() for non-app URLs, and session.setPermissionRequestHandler / setPermissionCheckHandler.",
    findings: ['S-23'],
    test: 'electron.test.js',
  },
  'electron/dev-only-surface': {
    title: 'Debug-only IPC (updater:debug-downgrade) is only registered in development',
    why: 'In a packaged build, a renderer bug could otherwise install an older, vulnerable release.',
    fix: "Register the handler inside if (!app.isPackaged || process.env.REDSTRING_ENABLE_DEBUG_DOWNGRADE === '1') { ... }.",
    findings: ['S-25'],
    test: 'electron.test.js',
  },
  'electron/is-dev': {
    title: 'isDev is derived from app.isPackaged only, never from NODE_ENV',
    why: 'NODE_ENV is set by whoever launches the app; a packaged app must never switch into dev mode because of it.',
    fix: 'const isDev = !app.isPackaged;',
    findings: ['S-29'],
    test: 'electron.test.js',
  },
  'electron/no-run-as-node': {
    title: 'The agent server is not started through ELECTRON_RUN_AS_NODE',
    why: 'The runAsNode fuse must be off (S-26), and once it is, a child forked with ELECTRON_RUN_AS_NODE no longer starts.',
    fix: 'Start it with utilityProcess.fork(...) instead of child_process.fork + ELECTRON_RUN_AS_NODE.',
    findings: ['S-26'],
    test: 'electron.test.js',
  },
  'electron/updater-signature': {
    title: 'The macOS update swap verifies the code signature first (C-4)',
    why: 'Without it, anything that can write the staged update gets installed and de-quarantined as Redstring.',
    fix: 'Call verifyBundleSignature(...) from electron/updaterSignature.cjs before swapping, and abort on { ok: false }.',
    findings: ['S-24', 'C-4'],
    test: 'electron.test.js',
  },
  'electron/updater-argv': {
    title: 'The update swap script receives its paths as argv, not pasted into the script text',
    why: 'A path containing $(...) or a quote, pasted into a bash -c string, runs as a command.',
    fix: "spawn('/bin/bash', ['-c', script, '--', stagedPath, targetPath]) and use \"$1\" / \"$2\" inside the script.",
    findings: ['S-24'],
    test: 'electron.test.js',
  },

  // ── Local servers ──────────────────────────────────────────────────────
  'servers/no-open-cors': {
    title: 'No bare cors() (or origin "*" / true) on any server',
    why: 'Open CORS lets every website read responses from the local servers in the user’s browser.',
    fix: 'Use createLocalServerGuard (src/security/localServerGuard.js) or cors({ origin: [explicit list] }).',
    findings: ['S-50', 'S-51'],
    test: 'servers.test.js',
  },
  'servers/loopback-listen': {
    title: 'Every .listen() passes an explicit loopback host',
    why: 'Without a host, Node listens on every interface: anyone on the same Wi-Fi can reach the agent/MCP servers.',
    fix: "app.listen(PORT, '127.0.0.1', ...). A cloud entrypoint may use const HOST = process.env.HOST || '127.0.0.1'.",
    findings: ['S-52', 'S-53', 'S-51'],
    test: 'servers.test.js',
  },
  'servers/local-guard': {
    title: 'wizard-server.js and redstring-mcp-server.js use createLocalServerGuard and accept JSON only',
    why: 'Any website can POST to localhost; the guard (token + Host + Origin) is what stops DNS rebinding and CSRF.',
    fix: "import { createLocalServerGuard } from './src/security/localServerGuard.js' and app.use(createLocalServerGuard({ token, port })) before every route; drop express.urlencoded.",
    findings: ['S-50', 'S-51', 'C-6'],
    test: 'servers.test.js',
  },
  'servers/mcp-http-opt-in': {
    title: 'The MCP server’s HTTP listener only starts when REDSTRING_MCP_HTTP=1',
    why: 'Claude Desktop talks to it over stdio; an always-on HTTP port is attack surface nobody uses.',
    fix: "Wrap the listen in if (process.env.REDSTRING_MCP_HTTP === '1') { ... }.",
    findings: ['S-50'],
    test: 'servers.test.js',
  },
  'servers/queue-journal-secrets': {
    title: 'The queue journal never writes API keys or tokens to disk',
    why: 'data/queues/*.jsonl already leaked two OpenRouter keys into git history.',
    fix: 'Strip keys matching /api[-_]?key|token|secret|authorization/i (recursively) before _appendJournal.',
    findings: ['S-54'],
    test: 'servers.test.js',
  },
  'servers/vite-dev-exposure': {
    title: 'The Vite dev server listens on localhost by default and denies secret files',
    why: 'host: true serves the whole project folder (WIZARD_KEY.txt, github.env, data/queues) to the LAN.',
    fix: "server.host: process.env.VITE_HOST || 'localhost', and server.fs.deny covering the files listed in the failure (patterns with a '/' must start with **/).",
    findings: ['S-58'],
    test: 'servers.test.js',
  },

  // ── Cloudflare Functions / web ─────────────────────────────────────────
  'functions/ownership-check': {
    title: 'Installation-scoped GitHub App routes call verifyInstallOwnership (C-9)',
    why: 'Installation IDs are enumerable integers; without an ownership check anyone can mint a token for anyone’s repos.',
    fix: "Import verifyInstallOwnership from functions/_lib/ownership.ts and deny unless it verifies the caller owns the installation.",
    findings: ['S-01', 'S-04', 'C-9'],
    test: 'functions.test.js',
  },
  'functions/attacker-scenarios': {
    title: 'Cross-account installation-token and unsigned webhook requests are refused',
    why: 'These are the two concrete attacks from the audit (S-01, S-12), replayed against the real handler.',
    fix: 'See S-01 and S-12 in documentation/security/HARDENING_PLAN.md.',
    findings: ['S-01', 'S-12'],
    test: 'functions.test.js',
  },
  'web/headers': {
    title: 'public/_headers sets frame-ancestors, HSTS, nosniff and a referrer policy',
    why: 'Without them the site can be framed (clickjacking the OAuth flow) and downgraded to http.',
    fix: 'Add the headers listed in the failure under a /* block in public/_headers.',
    findings: ['S-11'],
    test: 'functions.test.js',
  },
  'web/public-dir': {
    title: 'public/ ships no debug, test or preview pages and no secrets',
    why: 'Everything in public/ is served from redstring.io; debug pages widen the attack surface of the real origin.',
    fix: 'Move the file to dev-preview/ (or delete it).',
    findings: ['S-10'],
    test: 'functions.test.js',
  },
  'web/csp': {
    title: "index.html carries a Content-Security-Policy meta with no 'unsafe-eval' or 'unsafe-inline' in script-src",
    why: 'The CSP is the backstop when a sanitizer is missed: it stops injected script from running at all.',
    fix: 'Add the C-8 policy as <meta http-equiv="Content-Security-Policy" content="..."> in index.html.',
    findings: ['S-41', 'C-8'],
    test: 'csp.test.js',
  },

  // ── Mobile ─────────────────────────────────────────────────────────────
  'mobile/android-manifest': {
    title: 'Android: allowBackup is false and cleartext traffic is not allowed',
    why: 'Backups copy the WebView storage (tokens, keys) off the device; cleartext lets the network read traffic.',
    fix: 'android:allowBackup="false" (plus dataExtractionRules), and no usesCleartextTraffic="true" / cleartextTrafficPermitted="true".',
    findings: ['S-70'],
    test: 'mobile.test.js',
  },
  'mobile/ios-plist': {
    title: 'iOS: no NSAllowsArbitraryLoads, and PrivacyInfo.xcprivacy exists and is in the Xcode project',
    why: 'ATS exceptions allow plaintext traffic; a missing privacy manifest gets the build rejected by App Store review.',
    fix: 'Remove NSAllowsArbitraryLoads; add ios/App/App/PrivacyInfo.xcprivacy and reference it in project.pbxproj.',
    findings: ['S-79'],
    test: 'mobile.test.js',
  },
  'mobile/no-lgpl-in-store-builds': {
    title: 'The Capacitor (store) build replaces heic-to with the stub',
    why: 'heic-to bundles LGPL-3.0 libheif; App Store / Play binaries cannot meet LGPL relinking terms, so it must not ship there.',
    fix: "In vite.config.js, for mode 'capacitor': resolve.alias { find: /^heic-to$/, replacement: <abs path to src/utils/heicUnsupportedStub.js> }.",
    findings: ['S-83'],
    test: 'mobile.test.js',
  },
  'sync/not-found-structured': {
    title: 'An empty write is only allowed when the destination is structurally "not found", never because an error message mentions 404',
    why: 'Treating an ambiguous read (auth race, 403, 5xx) as "absent" is how a device that never synced wiped a remote universe.',
    fix: "Decide on error.code === 'FILE_NOT_FOUND' / 'ENOENT' / name === 'NotFoundError' (and status 404 when present); never on message text.",
    findings: ['S-75'],
    test: 'sync-and-ai.test.js',
  },
  'ai/consent-gate': {
    title: 'A consent gate sits in front of every third-party LLM request',
    why: 'Graph content goes to the user’s AI provider; App Store 5.1.2(i) and Play require telling the user first.',
    fix: 'src/services/aiConsent.js registers setLLMRequestGate(...) from src/wizard/LLMClient.js; keep it free of React so the Node/MCP side can load it.',
    findings: ['S-81'],
    test: 'sync-and-ai.test.js',
  },
  'mobile/capacitor-config': {
    title: 'capacitor.config.ts does not enable cleartext or mixed content',
    why: 'server.cleartext / android.allowMixedContent let plaintext http content into the app WebView.',
    fix: 'Remove server.cleartext and android.allowMixedContent (use them only in a local, uncommitted dev config).',
    findings: ['S-70'],
    test: 'mobile.test.js',
  },

  // ── Supply chain / repo hygiene ────────────────────────────────────────
  'workflows/pinned-actions': {
    title: 'Every GitHub Action is pinned to a full 40-character commit SHA',
    why: 'A tag can be moved by whoever controls the action repo; the release job holds signing keys and GITHUB_TOKEN.',
    fix: 'uses: owner/repo@<40-hex sha> # vX.Y.Z (look it up with git ls-remote https://github.com/owner/repo refs/tags/vX.Y.Z).',
    findings: ['S-30'],
    test: 'workflows.test.js',
  },
  'workflows/permissions': {
    title: 'Every workflow declares top-level permissions',
    why: 'Without it, GITHUB_TOKEN gets the repository default, which can be write-all.',
    fix: 'Add permissions: { contents: read } at the top level and widen per job only where needed.',
    findings: ['S-30'],
    test: 'workflows.test.js',
  },
  'workflows/no-third-party-builder': {
    title: 'release.yml does not use samuelmeuli/action-electron-builder',
    why: 'An unmaintained third-party action runs with the code-signing certificate and notarisation credentials.',
    fix: 'Run npx electron-builder --publish always directly.',
    findings: ['S-30'],
    test: 'workflows.test.js',
  },
  'workflows/script-injection': {
    title: 'No untrusted event text interpolated into run: scripts, and no pull_request_target',
    why: '${{ github.event.* }} inside run: is pasted into the shell before it runs: a crafted PR title becomes a command.',
    fix: 'Pass the value through env: (FOO: ${{ github.event.x }}) and use "$FOO" in the script.',
    findings: ['S-30'],
    test: 'workflows.test.js',
  },
  'repo/ignore-files': {
    title: '.gitignore, .dockerignore and .gcloudignore all exclude the local secret files',
    why: 'Each ignore file guards a different upload path (git push, docker build, gcloud deploy); one gap leaks the key.',
    fix: 'Add the patterns listed in the failure to the named ignore file.',
    findings: ['S-59', 'S-60'],
    test: 'ignore-files.test.js',
  },
  'repo/tracked-secrets': {
    title: 'No secret or private-data file is tracked by git',
    why: 'The repo is public; a tracked file is published with every push, and stays in history after deletion.',
    fix: 'git rm --cached <file>, add it to .gitignore, and rotate anything it contained.',
    findings: ['S-60'],
    test: 'ignore-files.test.js',
  },

  // ── Contracts other agents implement ───────────────────────────────────
  'contracts/present': {
    title: 'The shared security modules exist at their contract paths and behave as specified',
    why: 'Every fix and every invariant above relies on these helpers; a missing or weakened helper silently disables them.',
    fix: 'Create or fix the module named in the failure as specified under "Shared contracts" in documentation/security/HARDENING_PLAN.md.',
    findings: ['C-1', 'C-2', 'C-3', 'C-4', 'C-6', 'C-7', 'C-9'],
    test: 'contracts.test.js',
  },

  // ── Meta ───────────────────────────────────────────────────────────────
  'meta/unparseable': {
    title: 'Every scanned source file parses',
    why: 'A file the scanner cannot parse is a blind spot: none of the rules above see inside it.',
    fix: 'Fix the syntax error, or allowlist the file with a reason if it is dead code that is never bundled.',
    findings: [],
    test: 'renderer-sinks.test.js',
  },
};

export function rule(id) {
  const r = RULES[id];
  if (!r) throw new Error(`Unknown security rule id "${id}" — add it to test/security/invariants/_lib/rules.js`);
  return { id, ...r };
}
