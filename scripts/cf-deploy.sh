#!/usr/bin/env bash
#
# Deploy the SPA + Pages Functions to Cloudflare Pages.
#
#   scripts/cf-deploy.sh dev     → redstring-staging.pages.dev  (dev GitHub App)
#   scripts/cf-deploy.sh prod    → redstring.io                 (prod GitHub App, confirms first)
#
# npm aliases: npm run cf:deploy:dev / npm run cf:deploy:prod
#
# Neither Pages project is Git-connected, so nothing deploys on push — a deploy
# only happens when this script (or a raw `wrangler pages deploy`) runs. The two
# projects take the SAME `dist`; they differ only in which GitHub credentials
# their Function is bound to. That is also the one thing worth checking after a
# deploy, so the script ends by asking the deployed Function which OAuth App it
# is wearing: prod serving staging's dev client id would 401 every stored user
# token. See scripts/cf-set-prod-secrets.sh for how those secrets get set.
#
# Flags:
#   --skip-build   deploy the existing dist/ (use to promote the exact bytes
#                  already verified on staging, with no rebuild in between)
#   --preview      deploy to a preview URL on the current branch instead of
#                  replacing what the project's main URL serves
#   --dry-run      run every check and the build, stop before uploading
#   --yes, -y      skip the production confirmation prompt
#   --tail         stream Function logs once the deploy lands

set -euo pipefail
cd "$(dirname "$0")/.."

bold=$'\033[1m'; dim=$'\033[2m'; green=$'\033[0;32m'; red=$'\033[0;31m'; yellow=$'\033[1;33m'; off=$'\033[0m'

# --- Arguments ---------------------------------------------------------------

TARGET=""; SKIP_BUILD=0; PREVIEW=0; DRY_RUN=0; ASSUME_YES=0; TAIL=0

usage() {
  cat <<EOF
${bold}Usage:${off} scripts/cf-deploy.sh <dev|prod> [flags]

  ${bold}dev${off}    → redstring-staging.pages.dev   (dev GitHub App)
  ${bold}prod${off}   → redstring.io                  (prod GitHub App, confirms first)

${bold}Flags:${off}
  --skip-build   Deploy the existing dist/ without rebuilding
  --preview      Deploy to a preview URL instead of the project's main URL
  --dry-run      Check and build, but do not upload
  -y, --yes      Skip the production confirmation prompt
  --tail         Stream Function logs after deploying
EOF
}

while [ $# -gt 0 ]; do
  case "$1" in
    dev|staging)      TARGET="dev" ;;
    prod|production)  TARGET="prod" ;;
    --skip-build|-s)  SKIP_BUILD=1 ;;
    --preview)        PREVIEW=1 ;;
    --dry-run)        DRY_RUN=1 ;;
    --yes|-y)         ASSUME_YES=1 ;;
    --tail)           TAIL=1 ;;
    --help|-h)        usage; exit 0 ;;
    *) echo "${red}✗ Unknown argument: $1${off}"; echo; usage; exit 1 ;;
  esac
  shift
done

if [ -z "$TARGET" ]; then
  echo "${red}✗ Pick a target: dev or prod${off}"; echo; usage; exit 1
fi

if [ "$TARGET" = "prod" ]; then
  PROJECT="redstring-prod"
  PRIMARY_URL="https://redstring.io"
  ALT_URL="https://redstring-prod.pages.dev"
  IS_PROD=1
else
  PROJECT="redstring-staging"
  PRIMARY_URL="https://redstring-staging.pages.dev"
  ALT_URL=""
  IS_PROD=0
fi

# The prod OAuth App's client id. Public — it is in every authorize URL — and
# already hardcoded as the desktop build's default, so read it from there rather
# than keeping a second copy in sync.
PROD_CLIENT_ID="$(sed -n "s/.*DEFAULT_OAUTH_CLIENT_ID = '\([^']*\)'.*/\1/p" src/config/githubClientIds.js)"

echo "${bold}Deploy → Cloudflare Pages${off}"
echo "  Target:  ${bold}${TARGET}${off}  (project ${bold}${PROJECT}${off})"
echo "  URL:     ${bold}${PRIMARY_URL}${off}"
echo

# --- Preflight ---------------------------------------------------------------

if ! npx wrangler whoami >/dev/null 2>&1; then
  echo "${red}✗ Wrangler is not authenticated.${off}"
  echo "  Run:  npx wrangler login"
  exit 1
fi
echo "${green}✓${off} Wrangler authenticated"

if ! npx wrangler pages project list 2>/dev/null | grep -q "$PROJECT"; then
  echo "${red}✗ Pages project ${PROJECT} not found.${off}"
  echo "  Create it first:  npx wrangler pages project create ${PROJECT}"
  exit 1
fi
echo "${green}✓${off} Pages project exists"

GIT_BRANCH="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo unknown)"
GIT_COMMIT="$(git rev-parse --short HEAD 2>/dev/null || echo unknown)"
GIT_SUBJECT="$(git log -1 --pretty=%s 2>/dev/null || echo '')"
DIRTY_COUNT="$(git status --porcelain 2>/dev/null | wc -l | tr -d ' ')"

echo "${green}✓${off} On ${bold}${GIT_BRANCH}${off} at ${GIT_COMMIT} ${dim}${GIT_SUBJECT}${off}"
if [ "$DIRTY_COUNT" != "0" ]; then
  echo "${yellow}!${off} ${DIRTY_COUNT} uncommitted change(s) — they ${bold}will${off} ship in this build"
fi
if [ "$IS_PROD" = "1" ] && [ "$GIT_BRANCH" != "main" ] && [ "$PREVIEW" = "0" ]; then
  echo "${yellow}!${off} Branch is ${bold}${GIT_BRANCH}${off}, not main — this still replaces what redstring.io serves"
fi
echo

# --- Confirm production ------------------------------------------------------

if [ "$IS_PROD" = "1" ] && [ "$PREVIEW" = "0" ] && [ "$DRY_RUN" = "0" ] && [ "$ASSUME_YES" = "0" ]; then
  if [ ! -t 0 ]; then
    echo "${red}✗ Production deploy needs confirmation, but there is no terminal to ask.${off}"
    echo "  Re-run with --yes if this is intentional."
    exit 1
  fi
  printf "%s" "${bold}Replace what ${PRIMARY_URL} serves? [y/N] ${off}"
  read -r reply
  case "$reply" in
    y|Y|yes|YES) ;;
    *) echo "${dim}Aborted.${off}"; exit 1 ;;
  esac
  echo
fi

# --- Build -------------------------------------------------------------------

if [ "$SKIP_BUILD" = "1" ]; then
  if [ ! -f dist/index.html ]; then
    echo "${red}✗ --skip-build was passed but dist/ has no index.html.${off}"
    exit 1
  fi
  echo "${yellow}!${off} Skipping build — deploying dist/ as it stands${off}"
else
  echo "${bold}Building…${off}"
  npm run build
  echo
fi

# Two files decide whether the deploy is a working app or a static 404 factory,
# and both arrive by being copied out of public/ — so they are exactly the ones
# that go missing without the build failing.
for required in dist/index.html dist/_routes.json dist/oauth/callback.html; do
  if [ ! -f "$required" ]; then
    echo "${red}✗ Missing ${required}${off}"
    case "$required" in
      *_routes.json)  echo "  Without it, /api/github/* never reaches the Function." ;;
      *callback.html) echo "  Without it, the GitHub OAuth callback 404s." ;;
      *)              echo "  The build did not produce an SPA entry point." ;;
    esac
    exit 1
  fi
done
echo "${green}✓${off} dist/ has index.html, _routes.json, oauth/callback.html"
echo

# --- Deploy ------------------------------------------------------------------

# Pages treats a deploy on the project's production branch as the one its main
# URL serves; anything else becomes a preview. Naming the branch explicitly
# means the target is decided by the flag rather than by whatever branch
# happens to be checked out.
if [ "$PREVIEW" = "1" ]; then
  DEPLOY_BRANCH="$GIT_BRANCH"
else
  DEPLOY_BRANCH="main"
fi

if [ "$DRY_RUN" = "1" ]; then
  echo "${yellow}Dry run — stopping before upload.${off}"
  echo "  Would run: npx wrangler pages deploy dist --project-name=${PROJECT} --branch=${DEPLOY_BRANCH}"
  exit 0
fi

echo "${bold}Uploading to ${PROJECT} (branch ${DEPLOY_BRANCH})…${off}"
DEPLOY_LOG="$(mktemp)"
trap 'rm -f "$DEPLOY_LOG"' EXIT

npx wrangler pages deploy dist \
  --project-name="$PROJECT" \
  --branch="$DEPLOY_BRANCH" \
  --commit-dirty=true 2>&1 | tee "$DEPLOY_LOG"

DEPLOY_URL="$(grep -oE 'https://[a-z0-9-]+\.redstring-(prod|staging)\.pages\.dev' "$DEPLOY_LOG" | tail -1 || true)"
echo

# --- Verify ------------------------------------------------------------------

if [ "$PREVIEW" = "1" ]; then
  CHECK_URL="${DEPLOY_URL:-$PRIMARY_URL}"
else
  CHECK_URL="$PRIMARY_URL"
fi

echo "${bold}Verifying ${CHECK_URL}${off}"

STATUS=""
for attempt in 1 2 3 4 5; do
  STATUS="$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 "$CHECK_URL/" || echo 000)"
  [ "$STATUS" = "200" ] && break
  sleep 2
done

if [ "$STATUS" = "200" ]; then
  echo "${green}✓${off} SPA responds 200"
else
  echo "${yellow}!${off} SPA returned ${STATUS} — may still be propagating"
fi

CLIENT_JSON="$(curl -s --max-time 15 "$CHECK_URL/api/github/oauth/client-id" || echo '')"
CLIENT_ID="$(printf '%s' "$CLIENT_JSON" | sed -n 's/.*"clientId":"\([^"]*\)".*/\1/p')"

if [ -z "$CLIENT_ID" ]; then
  echo "${red}✗ The Function did not return a client id.${off}"
  echo "  Response: ${CLIENT_JSON:-<empty>}"
  echo "  Check that _routes.json shipped and the secrets are set:"
  echo "    npx wrangler pages secret list --project-name=${PROJECT}"
  exit 1
fi

if [ "$IS_PROD" = "1" ]; then
  if [ "$CLIENT_ID" = "$PROD_CLIENT_ID" ]; then
    echo "${green}✓${off} Function is wearing the ${bold}prod${off} GitHub App (${CLIENT_ID})"
  else
    echo "${red}✗ Production returned client id ${CLIENT_ID}, expected ${PROD_CLIENT_ID}.${off}"
    echo "  Every stored user token was minted by the prod App and will 401 against this one."
    echo "  Fix the secrets before anyone signs in:  scripts/cf-set-prod-secrets.sh"
    exit 1
  fi
else
  if [ "$CLIENT_ID" = "$PROD_CLIENT_ID" ]; then
    echo "${yellow}!${off} Staging is wearing the ${bold}prod${off} GitHub App (${CLIENT_ID})."
    echo "  Staging is meant to hold the dev credentials so prod stays isolated."
  else
    echo "${green}✓${off} Function is wearing the ${bold}dev${off} GitHub App (${CLIENT_ID})"
  fi
fi

echo
echo "${bold}Live:${off} ${CHECK_URL}"
[ -n "$ALT_URL" ] && [ "$PREVIEW" = "0" ] && echo "      ${ALT_URL}"
[ -n "$DEPLOY_URL" ] && echo "${dim}This deploy: ${DEPLOY_URL}${off}"
echo
echo "${dim}Logs:     npm run cf:tail:${TARGET}${off}"
echo "${dim}Rollback: npx wrangler pages deployment list --project-name=${PROJECT}${off}"
echo "${dim}          then roll back from the dashboard build link${off}"

if [ "$TAIL" = "1" ]; then
  echo
  echo "${bold}Streaming Function logs (Ctrl-C to stop)…${off}"
  exec npx wrangler pages deployment tail --project-name="$PROJECT"
fi
