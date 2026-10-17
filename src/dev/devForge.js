/**
 * Development only: make this dev-server origin one person in a shared
 * universe kept by scripts/fake-forge.mjs (a Git host on this machine).
 *
 *   http://localhost:5181/?devForge=http://localhost:4510&devForgeUser=ana&devForgeRepo=harness/forest
 *
 * `&devForgeApi=github` talks to the host through the GitHub provider (the
 * host speaks both APIs) instead of the Gitea one.
 *
 * Each port is its own origin with its own storage, so two ports are two
 * devices. The setting is remembered in this origin's localStorage, onboarding
 * is skipped, and the shared universe is opened (or created, for whoever is
 * first). `?devForge=off` turns it off. universeBackend reads the same
 * setting to send this origin's Git traffic to the fake host instead of
 * GitHub, and only in a dev build.
 *
 * scripts/shared-universe-harness.mjs starts the host and both ports.
 */
import { SemanticProviderFactory } from '../services/gitNativeProvider.js';

const KEY = 'redstring:dev-forge';
const SLUG = 'shared-forest';

export function hasDevForge() {
  try {
    return /[?&]devForge=/.test(window.location.search) || !!window.localStorage.getItem(KEY);
  } catch {
    return false;
  }
}

/** Read the URL parameters into this origin's setting, then drop them from the address bar. */
export function captureDevForgeParams() {
  const params = new URLSearchParams(window.location.search);
  const endpoint = params.get('devForge');
  if (endpoint === null) return readConfig();
  if (endpoint === 'off') {
    window.localStorage.removeItem(KEY);
  } else {
    const config = {
      endpoint: endpoint.replace(/\/+$/, ''),
      token: params.get('devForgeUser') || 'dev',
      repo: params.get('devForgeRepo') || 'harness/forest',
      api: params.get('devForgeApi') === 'github' ? 'github' : 'gitea'
    };
    window.localStorage.setItem(KEY, JSON.stringify(config));
    // Onboarding would ask where to keep universes; this origin keeps one, in the fake host.
    window.localStorage.setItem('redstring-welcome-seen', 'true');
  }
  for (const name of ['devForge', 'devForgeUser', 'devForgeRepo', 'devForgeApi']) params.delete(name);
  const query = params.toString();
  window.history.replaceState(null, '', `${window.location.pathname}${query ? `?${query}` : ''}${window.location.hash}`);
  return readConfig();
}

function readConfig() {
  try {
    const config = JSON.parse(window.localStorage.getItem(KEY) || 'null');
    return config?.endpoint && config?.token ? config : null;
  } catch {
    return null;
  }
}

/** Open the shared universe on this origin, creating its entry the first time. */
export async function joinDevForgeUniverse() {
  const config = readConfig();
  if (!config) return;
  const { default: backend, devForgeProvider } = await import('../services/universeBackend.js');
  if (!backend.isInitialized) await backend.initialize();

  const [owner, repo] = config.repo.split('/');
  const gitRepo = {
    enabled: true,
    linkedRepo: { type: config.api === 'github' ? 'github' : 'gitea', user: owner, repo },
    universeFolder: SLUG,
    universeFile: `${SLUG}.redstring`,
    schemaPath: 'schema'
  };

  let universe = backend.getUniverse(SLUG);
  if (!universe) {
    const created = await backend.createUniverse('Shared Forest', { enableGit: false, enableLocal: false, sourceOfTruth: 'git' });
    if (created.slug !== SLUG) console.warn(`[devForge] universe slug is ${created.slug}, expected ${SLUG}`);
    universe = created;
  }
  await backend.updateUniverse(universe.slug, {
    sourceOfTruth: 'git',
    localFile: { ...(universe.localFile || {}), enabled: false },
    gitRepo: { ...(universe.gitRepo || {}), ...gitRepo }
  });

  // Load it the way the app loads any Git universe: what the host has, or —
  // for whoever is first — a new empty one their first edit creates.
  const provider = SemanticProviderFactory.createProvider({ ...devForgeProvider(config), user: owner, repo });
  const sha = await provider.getRemoteFileSha(`universes/${SLUG}/${SLUG}.redstring`).catch(() => null);
  if (backend.activeUniverseSlug !== universe.slug) {
    await backend.switchActiveUniverse(universe.slug);
  } else {
    await backend.reloadUniverse(universe.slug);
  }
  await backend.ensureGitSyncEngine(universe.slug).catch((error) => console.warn('[devForge] sync engine:', error));

  window.__redstringDevForge = {
    config,
    backend,
    /** Check the host for others' saves now (the app also does every 30s and on focus). */
    checkNow: () => backend.checkForRemoteChanges('manual')
  };
  console.info(`[devForge] ${config.token} is in ${config.repo} through the ${config.api === 'github' ? 'GitHub' : 'Gitea'} API (${sha ? 'opened' : 'new — the first edit creates it'})`);
}
