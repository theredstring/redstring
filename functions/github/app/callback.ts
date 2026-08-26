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
 * Behaviour is the Express handler's, unchanged: forward the three parameters
 * the SPA looks for to the app root and let the client take over. No secrets,
 * no GitHub calls — purely a redirect.
 */

interface CallbackEnv {
  [key: string]: unknown;
}

const FORWARDED = ['installation_id', 'setup_action', 'state'] as const;

export const onRequestGet: PagesFunction<CallbackEnv> = async (context) => {
  const url = new URL(context.request.url);

  const params = new URLSearchParams();
  for (const key of FORWARDED) {
    const value = url.searchParams.get(key);
    if (value) params.set(key, value);
  }

  const query = params.toString();
  const target = new URL(query ? `/?${query}` : '/', url.origin);

  // 302 rather than 301: the parameters differ on every install, and a cached
  // permanent redirect would strand a later install on a previous one's ids.
  return Response.redirect(target.toString(), 302);
};
