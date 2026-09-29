/**
 * GET /github/app/callback
 *
 * Registered as BOTH the Callback URL and the Setup URL of the GitHub App, so
 * GitHub sends a user's browser here after they authorize or install. Nothing
 * in the SPA calls it — which is exactly why it is easy to miss when moving
 * hosts, and why losing it breaks installation for new users only.
 *
 * The path has no `/api` prefix, so it sits outside the `[[path]].ts` router
 * and needs its own entry in `public/_routes.json`; without that, Pages serves
 * the SPA's index.html here and the install silently dead-ends on a page that
 * never reads the parameters.
 *
 * Forward the three parameters the SPA looks for to the app root and let the
 * client take over. No secrets, no GitHub calls — purely a redirect. Values
 * are shape-checked (numeric id, known setup_action, url-safe state) so
 * nothing else rides along. This is not the security boundary: the SPA only
 * accepts the installation_id when it has a pending install whose random
 * `state` matches (S-05), and the Function re-verifies ownership before it
 * mints anything (C-9).
 */

interface CallbackEnv {
  [key: string]: unknown;
}

const FORWARDED: Record<string, RegExp> = {
  installation_id: /^[1-9][0-9]{0,15}$/,
  setup_action: /^(install|update|request)$/,
  state: /^[A-Za-z0-9_-]{1,128}$/,
};

export const onRequestGet: PagesFunction<CallbackEnv> = async (context) => {
  const url = new URL(context.request.url);

  const params = new URLSearchParams();
  for (const [key, shape] of Object.entries(FORWARDED)) {
    const value = url.searchParams.get(key);
    if (value && shape.test(value)) params.set(key, value);
  }

  const query = params.toString();
  const target = new URL(query ? `/?${query}` : '/', url.origin);

  // 302 rather than 301: the parameters differ on every install, and a cached
  // permanent redirect would strand a later install on a previous one's ids.
  // Built by hand (not Response.redirect) so the hardening headers can be set.
  return new Response(null, {
    status: 302,
    headers: {
      'Location': target.toString(),
      'Cache-Control': 'no-store',
      'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff',
    },
  });
};
