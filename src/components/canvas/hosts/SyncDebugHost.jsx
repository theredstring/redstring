import React, { Profiler, memo, useCallback, useEffect, useRef, useState } from 'react';
import DebugOverlay from '../../../DebugOverlay.jsx';
import debugConfig from '../../../utils/debugConfig.js';
import { onRenderProbe } from '../../../utils/perf/renderProbe.js';

/**
 * The on-screen sync diagnostics, outside NodeCanvas (P2.06a). Everything here
 * existed only to feed DebugOverlay: the ring buffer of recent actions, the
 * 2 s refresh while the overlay is on, and the retry / force-save / probe /
 * dump actions. Toggle: Settings → Debug → Show Debug Overlay.
 */
function SyncDebugHost() {
  // Owned by debugConfig: the switch lives in the Settings modal. "Hide" closes
  // the overlay without changing the setting, as before.
  const [debugMode, setDebugMode] = useState(() => debugConfig.isDebugOverlayEnabled());
  useEffect(() => {
    const unsubscribe = debugConfig.addListener((config) => setDebugMode(!!config.showDebugOverlay));
    setDebugMode(debugConfig.isDebugOverlayEnabled());
    return unsubscribe;
  }, []);

  // On-screen sync diagnostics (populated only while debugMode is on; primary
  // use-case is debugging the "Awaiting sync engine forever" symptom on
  // mobile where devtools aren't readily accessible).
  const [syncDebugData, setSyncDebugData] = useState(null);
  const syncDebugActionsRef = useRef([]); // ring buffer of recent action results

  const buildSyncDebugData = useCallback(async () => {
    try {
      const { default: universeBackend } = await import('../../../services/universeBackend.js');
      const { persistentAuth } = await import('../../../services/persistentAuth.js');
      const { default: saveCoordinator } = await import('../../../services/SaveCoordinator.js');

      const authStatus = universeBackend.getAuthStatus?.() || persistentAuth.getAuthStatus?.() || {};
      const universe = universeBackend.getActiveUniverse?.() || null;
      const universeSlug = universe?.slug || null;

      let saveCoordinatorDiag = null;
      try {
        saveCoordinatorDiag = typeof saveCoordinator?.getDiagnostics === 'function'
          ? saveCoordinator.getDiagnostics()
          : null;
      } catch (e) {
        saveCoordinatorDiag = { error: `getDiagnostics threw: ${e.message}` };
      }

      let engineSummary = {};
      try {
        const stat = universeSlug ? universeBackend.getSyncStatus?.(universeSlug) : null;
        const hasEngineMap = universeBackend.gitSyncEngines instanceof Map;
        const hasEngine = hasEngineMap && universeSlug ? universeBackend.gitSyncEngines.has(universeSlug) : null;
        engineSummary = {
          hasEngine,
          isRunning: stat?.isRunning ?? null,
          isHealthy: stat?.isHealthy ?? null,
          isInBackoff: stat?.isInBackoff ?? null,
          consecutiveErrors: stat?.consecutiveErrors ?? null,
          pendingCommits: stat?.pendingCommits ?? null,
          lastCommitTime: stat?.lastCommitTime ?? null,
          lastErrorTime: stat?.lastErrorTime ?? null,
          lastError: stat?.lastError?.message || stat?.lastError || null,
          statusLabel: stat?.label || stat?.state || null,
        };
      } catch (e) {
        engineSummary = { lastError: `getSyncStatus threw: ${e.message}` };
      }

      // Probe BOTH the in-memory caches and the real localStorage keys used
      // by persistentAuth (see LOCAL_STORAGE_KEYS in persistentAuth.js). The
      // OAuth scope is the critical piece — if mobile granted only
      // `public_repo` while desktop granted `repo`, that alone explains a 404
      // on a private repo even when both authenticate as the same user.
      let hasOauthInMemory = null;
      let hasAppInMemory = null;
      let hasOauthStored = null;
      let hasAppStored = null;
      let oauthScope = null;
      let appInstallationId = null;
      let tokenSource = null;
      try {
        hasOauthInMemory = !!(persistentAuth.oauthCache?.accessToken);
        hasAppInMemory = !!(persistentAuth.githubAppCache?.accessToken || persistentAuth.githubAppCache?.installationId);
        oauthScope = persistentAuth.oauthCache?.scope || null;
        appInstallationId = persistentAuth.githubAppCache?.installationId || null;
      } catch { }
      try {
        if (typeof window !== 'undefined' && window.localStorage) {
          hasOauthStored = !!window.localStorage.getItem('github_access_token');
          hasAppStored = !!window.localStorage.getItem('github_app_access_token') || !!window.localStorage.getItem('github_app_installation_id');
          if (!oauthScope) oauthScope = window.localStorage.getItem('github_token_scope') || null;
          if (!appInstallationId) appInstallationId = window.localStorage.getItem('github_app_installation_id') || null;
        }
        const anyMem = hasOauthInMemory || hasAppInMemory;
        const anyStored = hasOauthStored || hasAppStored;
        tokenSource = anyMem && anyStored
          ? 'memory+storage'
          : anyMem
            ? 'memory only'
            : anyStored
              ? 'storage only'
              : 'none';
      } catch (e) {
        tokenSource = `probe failed: ${e.message}`;
      }

      return {
        _sync: true,
        _meta: !engineSummary.hasEngine
          ? { notice: 'No sync engine instance for the active universe. Tap "Retry sync engine" to attempt setup; if it fails, the error will show under Recent actions.' }
          : null,
        device: {
          userAgent: typeof navigator !== 'undefined' ? navigator.userAgent.slice(0, 120) : null,
          isMobile: universeBackend.isMobile ?? null,
          isTouch: universeBackend.isTouch ?? null,
          hasFileAccess: universeBackend.hasFileAccess ?? null,
          isGitOnlyMode: universeBackend.isGitOnlyMode ?? null,
          defaultSourceOfTruth: universeBackend.deviceConfig?.sourceOfTruth ?? null,
        },
        auth: {
          isAuthenticated: authStatus.isAuthenticated ?? null,
          authType: authStatus.userData?.app_id ? 'github-app' : (authStatus.userData ? 'oauth' : null),
          user: authStatus.userData?.login || authStatus.userData?.name || null,
          tokenExpiresAt: authStatus.tokenExpiresAt || authStatus.userData?.tokenExpiresAt || null,
          oauthScope: oauthScope || '(none)',
          appInstallationId: appInstallationId || '(none)',
          hasOauthInMemory,
          hasAppInMemory,
          hasOauthStored,
          hasAppStored,
          tokenSource,
        },
        universe: {
          slug: universeSlug,
          name: universe?.name || null,
          gitEnabled: !!universe?.gitRepo?.enabled,
          linkedRepo: universe?.gitRepo?.linkedRepo
            ? `${universe.gitRepo.linkedRepo.user || universe.gitRepo.linkedRepo.owner || '?'}/${universe.gitRepo.linkedRepo.repo || universe.gitRepo.linkedRepo.name || '?'}`
            : null,
          universeFolder: universe?.gitRepo?.universeFolder || null,
          universeFile: universe?.gitRepo?.universeFile || null,
          sourceOfTruth: universe?.sourceOfTruth || null,
          nodeCount: universe?.nodeCount ?? null,
        },
        engine: engineSummary,
        saveCoordinator: saveCoordinatorDiag,
        lastActions: syncDebugActionsRef.current.slice(),
      };
    } catch (err) {
      return {
        _sync: true,
        _meta: { notice: `Failed to build diagnostics: ${err.message}` },
        device: {}, auth: {}, universe: {}, engine: {}, saveCoordinator: null,
        lastActions: syncDebugActionsRef.current.slice(),
      };
    }
  }, []);

  const recordSyncAction = useCallback((label, ok, detail) => {
    const ts = new Date().toISOString().slice(11, 19);
    syncDebugActionsRef.current = [
      ...syncDebugActionsRef.current.slice(-9),
      { ts, label, ok, detail: detail ? String(detail).slice(0, 200) : null },
    ];
  }, []);

  const refreshSyncDebug = useCallback(async () => {
    if (!debugMode) return;
    const data = await buildSyncDebugData();
    setSyncDebugData(data);
  }, [debugMode, buildSyncDebugData]);

  const handleRetrySyncEngine = useCallback(async () => {
    try {
      const { default: universeBackend } = await import('../../../services/universeBackend.js');
      const { persistentAuth } = await import('../../../services/persistentAuth.js');

      // Force-rehydrate the in-memory token cache from localStorage before
      // attempting engine setup. On mobile we've observed tokens persisted to
      // localStorage but `persistentAuth.oauthCache` left empty, which makes
      // `getAuthStatus().isAuthenticated` return false and skip auto-setup.
      // Calling loadFromBrowserStorage() is idempotent — if hydration already
      // ran successfully it's a no-op; if it hadn't, this populates the cache.
      const tokenBefore = !!persistentAuth.oauthCache?.accessToken;
      try {
        persistentAuth.loadFromBrowserStorage?.();
        const tokenAfter = !!persistentAuth.oauthCache?.accessToken;
        const appAfter = !!(persistentAuth.githubAppCache?.installationId || persistentAuth.githubAppCache?.accessToken);
        recordSyncAction(
          'rehydrateAuthCache',
          tokenAfter || appAfter,
          `oauth: ${tokenBefore ? 'was set' : 'was empty'} → ${tokenAfter ? 'set' : 'still empty'}; app: ${appAfter ? 'set' : 'empty'}`
        );
      } catch (hydrationErr) {
        recordSyncAction('rehydrateAuthCache', false, hydrationErr?.message || String(hydrationErr));
      }

      const universe = universeBackend.getActiveUniverse?.();
      if (!universe?.slug) throw new Error('No active universe');
      const engine = await universeBackend.ensureGitSyncEngine(universe.slug);
      recordSyncAction('ensureGitSyncEngine', !!engine, engine ? 'engine ready' : 'returned null');
    } catch (e) {
      recordSyncAction('ensureGitSyncEngine', false, e?.message || String(e));
    }
    refreshSyncDebug();
  }, [recordSyncAction, refreshSyncDebug]);

  const handleForceSaveDebug = useCallback(async () => {
    try {
      const { default: universeBackend } = await import('../../../services/universeBackend.js');
      const universe = universeBackend.getActiveUniverse?.();
      if (!universe?.slug) throw new Error('No active universe');
      await universeBackend.forceSave(universe.slug);
      recordSyncAction('forceSave', true, null);
    } catch (e) {
      recordSyncAction('forceSave', false, e?.message || String(e));
    }
    refreshSyncDebug();
  }, [recordSyncAction, refreshSyncDebug]);

  // Clear GitHub App installation data (in-memory cache + localStorage). Used
  // when the App auth path keeps failing (e.g. App not granted access to a
  // private repo) and the user prefers to fall through to OAuth, which has
  // `repo` scope and will succeed. After clearing, sync engine setup will
  // pick the OAuth branch in createProviderForUniverse.
  const handleClearGitHubAppCache = useCallback(async () => {
    try {
      const { persistentAuth } = await import('../../../services/persistentAuth.js');
      const { default: universeBackend } = await import('../../../services/universeBackend.js');

      const beforeInstallId = persistentAuth.githubAppCache?.installationId || null;
      const beforeHasToken = !!persistentAuth.githubAppCache?.accessToken;

      // Use clearAppInstallation so the sticky-disconnect flag is set.
      // Without that flag, attemptAppAutoConnect() on the next init silently
      // re-discovers the same install from the server's App-wide list and
      // re-populates the cache — which is exactly the "Clear doesn't work"
      // behavior the user was seeing.
      await persistentAuth.clearAppInstallation({ sticky: true });

      // Remove any existing sync engine for the active universe so the
      // next setup attempt rebuilds the provider (picking OAuth this time).
      try {
        const universe = universeBackend.getActiveUniverse?.();
        if (universe?.slug) {
          await universeBackend.removeGitSyncEngine?.(universe.slug);
        }
      } catch { /* best effort */ }

      recordSyncAction(
        'clearGitHubAppCache',
        true,
        `was installId=${beforeInstallId || '(none)'} hadToken=${beforeHasToken}; cleared with sticky disconnect — auto-rediscovery blocked until next explicit App install. Tap "Retry sync engine" next.`
      );
    } catch (e) {
      recordSyncAction('clearGitHubAppCache', false, e?.message || String(e));
    }
    refreshSyncDebug();
  }, [recordSyncAction, refreshSyncDebug]);

  // Direct GitHub API probe — bypasses the sync engine, rate limiter, and
  // provider abstraction entirely. Fires raw fetch() against
  // /repos/{owner}/{repo} with each cached token in turn, then logs status +
  // identifying headers + a verdict that maps the result pair to the
  // remaining hypothesis (server-side token issue / network-layer auth
  // stripping / engine-level token drift).
  const handleDirectGitHubProbe = useCallback(async () => {
    try {
      const { default: universeBackend } = await import('../../../services/universeBackend.js');
      const { persistentAuth } = await import('../../../services/persistentAuth.js');

      const universe = universeBackend.getActiveUniverse?.();
      const linkedRepo = universe?.gitRepo?.linkedRepo;
      let owner, repo;
      if (typeof linkedRepo === 'string') {
        const parts = linkedRepo.split('/');
        owner = parts[0];
        repo = parts[1];
      } else if (linkedRepo && typeof linkedRepo === 'object') {
        owner = linkedRepo.user;
        repo = linkedRepo.repo;
      }
      if (!owner || !repo) {
        recordSyncAction('probe.verdict', false, `cannot probe — no linked repo on active universe (got ${JSON.stringify(linkedRepo)})`);
        refreshSyncDebug();
        return;
      }

      const appToken = persistentAuth.githubAppCache?.accessToken || null;
      let oauthToken = null;
      try { oauthToken = await persistentAuth.getAccessToken?.(); } catch { /* ignore */ }
      if (!oauthToken) oauthToken = persistentAuth.oauthCache?.accessToken || null;

      const url = `https://api.github.com/repos/${owner}/${repo}`;

      const runProbe = async (token) => {
        const res = await fetch(url, {
          headers: {
            'Authorization': `token ${token}`,
            'Accept': 'application/vnd.github.v3+json',
          },
        });
        let apiMessage = null;
        try { const body = await res.json(); apiMessage = body?.message || null; } catch { /* not json */ }
        return {
          status: res.status,
          statusText: res.statusText,
          apiMessage,
          headers: {
            user: res.headers.get('x-github-user-login'),
            install: res.headers.get('x-github-installation-id'),
            scopes: res.headers.get('x-oauth-scopes'),
            reqId: res.headers.get('x-github-request-id'),
          },
        };
      };

      const fmt = (r, tokenKind, tokenLen) => {
        if (!r) return `skipped — no token in cache`;
        if (r.error) return `fetch threw: ${r.error}`;
        const h = r.headers || {};
        const parts = [`${r.status} ${r.statusText || ''}`.trim()];
        if (h.user) parts.push(`user=${h.user}`);
        if (h.install) parts.push(`install=${h.install}`);
        if (h.scopes) parts.push(`scopes=${h.scopes}`);
        if (h.reqId) parts.push(`reqId=${h.reqId}`);
        parts.push(`tokenKind=${tokenKind} tokenLen=${tokenLen}`);
        if (r.apiMessage) parts.push(`msg="${r.apiMessage}"`);
        return parts.join(' ');
      };

      const [appOutcome, oauthOutcome] = await Promise.allSettled([
        appToken ? runProbe(appToken) : Promise.resolve(null),
        oauthToken ? runProbe(oauthToken) : Promise.resolve(null),
      ]);

      const appResult = appToken
        ? (appOutcome.status === 'fulfilled' ? appOutcome.value : { error: appOutcome.reason?.message || String(appOutcome.reason) })
        : null;
      const oauthResult = oauthToken
        ? (oauthOutcome.status === 'fulfilled' ? oauthOutcome.value : { error: oauthOutcome.reason?.message || String(oauthOutcome.reason) })
        : null;

      const appKind = appToken ? String(appToken).slice(0, 4) : '?';
      const appLen = appToken ? String(appToken).length : 0;
      const oauthKind = oauthToken ? String(oauthToken).slice(0, 4) : '?';
      const oauthLen = oauthToken ? String(oauthToken).length : 0;

      recordSyncAction('probe.app', appResult?.status === 200, fmt(appResult, appKind, appLen));
      recordSyncAction('probe.oauth', oauthResult?.status === 200, fmt(oauthResult, oauthKind, oauthLen));

      // Verdict maps the (app, oauth) status pair to the remaining hypothesis.
      let verdict;
      const appStatus = appResult?.status;
      const oauthStatus = oauthResult?.status;
      if (!appToken && !oauthToken) {
        verdict = 'BOTH SKIPPED — no tokens in cache; tap "Retry sync engine" to rehydrate first';
      } else if (appStatus === 200 && oauthStatus === 200) {
        verdict = 'BOTH OK — engine is using a stale/different token than cache (token-cache drift)';
      } else if (appStatus === 200 && oauthStatus !== 200) {
        verdict = 'APP OK, OAUTH fails — engine should be working; if it isn\'t, engine is stale';
      } else if (appStatus !== 200 && oauthStatus === 200) {
        verdict = 'SERVER-SIDE token issue — /api/github/app/installation-token returns a token broken for this device';
      } else if (appStatus !== 200 && oauthStatus !== 200 && (appResult || oauthResult)) {
        verdict = 'NETWORK-LAYER auth stripping — iOS WebKit / Private Relay / proxy is interfering with Authorization';
      } else {
        verdict = `inconclusive — app=${appStatus ?? 'n/a'} oauth=${oauthStatus ?? 'n/a'}`;
      }
      recordSyncAction('probe.verdict', appStatus === 200 || oauthStatus === 200, verdict);
    } catch (e) {
      recordSyncAction('probe.verdict', false, e?.message || String(e));
    }
    refreshSyncDebug();
  }, [recordSyncAction, refreshSyncDebug]);

  // Dumps the live auth state to the action log. The diagnostic users need
  // most often (which install is cached, which account does OAuth see, what
  // repos does the App grant include) lives in in-memory caches that aren't
  // reachable from a devtools console in a bundled build. This makes it a
  // one-tap action instead.
  const handleDumpAuthState = useCallback(async () => {
    try {
      const { persistentAuth } = await import('../../../services/persistentAuth.js');
      const { default: universeBackend } = await import('../../../services/universeBackend.js');

      const appCache = persistentAuth.githubAppCache || null;
      const oauthCache = persistentAuth.oauthCache || null;
      const activeUni = universeBackend.getActiveUniverse?.() || null;

      const linkedRepo = activeUni?.gitRepo?.linkedRepo;
      let owner, repo;
      if (typeof linkedRepo === 'string') {
        const [o, r] = linkedRepo.split('/');
        owner = o; repo = r;
      } else if (linkedRepo && typeof linkedRepo === 'object') {
        owner = linkedRepo.user;
        repo = linkedRepo.repo;
      }
      recordSyncAction(
        'dump.universe',
        true,
        activeUni
          ? `slug=${activeUni.slug} linked=${owner || '?'}/${repo || '?'} truth=${activeUni.sourceOfTruth || '?'} folder=${activeUni.gitRepo?.universeFolder || '(default)'} file=${activeUni.gitRepo?.universeFile || '(slug.redstring)'}`
          : 'no active universe'
      );

      if (appCache) {
        const repos = Array.isArray(appCache.repositories)
          ? appCache.repositories.map(r => r.full_name || r.name).filter(Boolean)
          : [];
        const hasLinked = (owner && repo)
          ? repos.includes(`${owner}/${repo}`)
          : null;
        recordSyncAction(
          'dump.app',
          true,
          `installId=${appCache.installationId || '(none)'} account=${appCache.userData?.login || appCache.userData?.account?.login || '?'} tokenKind=${appCache.accessToken?.slice(0, 4) || '?'} tokenLen=${appCache.accessToken?.length || 0} repoCount=${repos.length} hasLinkedRepo=${hasLinked === null ? '?' : hasLinked} repos=[${repos.slice(0, 8).join(', ')}${repos.length > 8 ? ', ...' : ''}]`
        );
      } else {
        recordSyncAction('dump.app', false, 'NO App cache (no install stored in memory)');
      }

      if (oauthCache) {
        recordSyncAction(
          'dump.oauth',
          true,
          `user=${oauthCache.user?.login || '?'} tokenKind=${oauthCache.accessToken?.slice(0, 4) || '?'} tokenLen=${oauthCache.accessToken?.length || 0} scope=${oauthCache.scope || '?'}`
        );
      } else {
        recordSyncAction('dump.oauth', false, 'NO OAuth cache (no token stored in memory)');
      }

      // Bonus: hit the install's repositories endpoint with the cached App
      // token. This is the truth — what GitHub actually says this token can
      // see right now, regardless of stale repositories arrays in cache.
      if (appCache?.accessToken) {
        try {
          const r = await fetch('https://api.github.com/installation/repositories?per_page=100', {
            headers: {
              'Authorization': `token ${appCache.accessToken}`,
              'Accept': 'application/vnd.github.v3+json'
            }
          });
          const d = await r.json().catch(() => null);
          const liveRepos = Array.isArray(d?.repositories)
            ? d.repositories.map(x => x.full_name)
            : [];
          const hasLinkedLive = (owner && repo) ? liveRepos.includes(`${owner}/${repo}`) : null;
          recordSyncAction(
            'dump.app.live',
            r.status === 200,
            `status=${r.status} installHeader=${r.headers.get('x-github-installation-id') || '?'} selection=${d?.repository_selection || '?'} totalCount=${d?.total_count ?? '?'} hasLinkedRepo=${hasLinkedLive === null ? '?' : hasLinkedLive} repos=[${liveRepos.slice(0, 8).join(', ')}${liveRepos.length > 8 ? ', ...' : ''}]`
          );
        } catch (e) {
          recordSyncAction('dump.app.live', false, `fetch failed: ${e?.message || e}`);
        }
      }

      // Bonus: probe the OAuth token's identity (who does GitHub see?)
      if (oauthCache?.accessToken) {
        try {
          const r = await fetch('https://api.github.com/user', {
            headers: { 'Authorization': `token ${oauthCache.accessToken}` }
          });
          const d = await r.json().catch(() => null);
          recordSyncAction(
            'dump.oauth.live',
            r.status === 200,
            `status=${r.status} login=${d?.login || '?'} scopes=${r.headers.get('x-oauth-scopes') || '?'}`
          );
        } catch (e) {
          recordSyncAction('dump.oauth.live', false, `fetch failed: ${e?.message || e}`);
        }

        // CRITICAL: probe /user/installations DIRECTLY (bypassing our server
        // and the proxy). This tells us whether GitHub itself is rejecting
        // the OAuth token for install enumeration, vs. a problem in our
        // proxy / scope filter. If this 403s, it's a GitHub-side gate:
        // either SAML SSO needs to be authorized for the OAuth App, or the
        // OAuth App lacks permission to enumerate installs.
        try {
          const r = await fetch('https://api.github.com/user/installations?per_page=10', {
            headers: { 'Authorization': `token ${oauthCache.accessToken}` }
          });
          const d = await r.json().catch(() => null);
          const ssoHeader = r.headers.get('x-github-sso') || null;
          const acceptedScopes = r.headers.get('x-accepted-oauth-scopes') || null;
          const xMessage = d?.message || null;
          recordSyncAction(
            'dump.installs.live',
            r.status === 200,
            `status=${r.status} totalInstalls=${d?.total_count ?? '?'} sso=${ssoHeader || '(none)'} acceptedScopes=${acceptedScopes || '?'} reqId=${r.headers.get('x-github-request-id') || '?'}${xMessage ? ` githubMsg="${xMessage}"` : ''} installs=[${(d?.installations || []).map(i => `${i.id}/${i.account?.login}/${i.app_slug}`).slice(0, 5).join(', ')}]`
          );
        } catch (e) {
          recordSyncAction('dump.installs.live', false, `fetch failed: ${e?.message || e}`);
        }
      }
    } catch (e) {
      recordSyncAction('dump.error', false, e?.message || String(e));
    }
    refreshSyncDebug();
  }, [recordSyncAction, refreshSyncDebug]);

  useEffect(() => {
    if (!debugMode) {
      setSyncDebugData(null);
      return;
    }
    refreshSyncDebug();
    const id = setInterval(refreshSyncDebug, 2000);
    return () => clearInterval(id);
  }, [debugMode, refreshSyncDebug]);

  if (!debugMode) return null;
  return (
    <Profiler id="SyncDebugHost" onRender={onRenderProbe}>
      {/* Primary use: read the engine/auth/universe state on devices where
          devtools aren't accessible (mobile). */}
      <DebugOverlay
        debugData={syncDebugData}
        hideOverlay={() => setDebugMode(false)}
        actions={{
          onRetrySyncEngine: handleRetrySyncEngine,
          onForceSave: handleForceSaveDebug,
          onClearGitHubAppCache: handleClearGitHubAppCache,
          onDirectGitHubProbe: handleDirectGitHubProbe,
          onDumpAuthState: handleDumpAuthState,
          onRefresh: refreshSyncDebug,
        }}
      />
    </Profiler>
  );
}

export default memo(SyncDebugHost);
