#!/usr/bin/env bash
#
# Copy the production GitHub credentials from Google Secret Manager into a
# Cloudflare Pages project, without any value touching the terminal.
#
# Values are piped straight from `gcloud` into `wrangler`, so nothing renders in
# scrollback, shell history, or a process listing.
#
# Trailing newlines are the reason this is a script and not five pasted lines.
# Two of the GCP secrets carry one, and the two consumers disagree about whether
# that matters:
#
#   github-app-id   MUST be trimmed. appJwt() does setIssuer(String(appId)) with
#                   no trim of its own, so the newline lands inside the JWT's
#                   `iss` claim, GitHub rejects the assertion, and installation
#                   token minting fails outright. The error is misleading — the
#                   Function's hint blames GITHUB_APP_ID *or* the private key.
#
#   github-app-slug MUST be trimmed. The Function compares
#                   `inst.app_slug === configuredSlug` exactly and interpolates
#                   the slug into install URLs. The App-ID check masks a
#                   mismatch, which is what makes it hard to find later.
#
#   private key     MUST NOT be trimmed. Its internal newlines are structural.
#                   normalizePem() already trims the ends itself, so stripping
#                   here only risks flattening the PEM — which a PKCS#8 key
#                   would not survive.
#
# Usage: scripts/cf-set-prod-secrets.sh [pages-project] [gcp-project]

set -euo pipefail

PAGES_PROJECT="${1:-redstring-prod}"
GCP_PROJECT="${2:-redstring-470201}"

bold=$'\033[1m'; green=$'\033[0;32m'; red=$'\033[0;31m'; yellow=$'\033[1;33m'; off=$'\033[0m'

echo "${bold}Copying GitHub credentials → Cloudflare Pages${off}"
echo "  Pages project: ${bold}${PAGES_PROJECT}${off}"
echo "  GCP project:   ${bold}${GCP_PROJECT}${off}"
echo

# --- Preflight ---------------------------------------------------------------
# Fail before writing anything, rather than halfway through the set.

if ! gcloud projects describe "$GCP_PROJECT" >/dev/null 2>&1; then
  echo "${red}✗ Cannot read GCP project ${GCP_PROJECT}. Check gcloud auth.${off}"
  exit 1
fi
echo "${green}✓${off} GCP project reachable"

if ! npx wrangler pages project list 2>/dev/null | grep -q "$PAGES_PROJECT"; then
  echo "${red}✗ Pages project ${PAGES_PROJECT} not found.${off}"
  echo "  Create it first:  npx wrangler pages project create ${PAGES_PROJECT}"
  exit 1
fi
echo "${green}✓${off} Pages project exists"

# secret-manager-name : worker-binding-name : trim?
MAPPINGS=(
  "github-client-id:GITHUB_CLIENT_ID:trim"
  "github-client-secret:GITHUB_CLIENT_SECRET:trim"
  "github-app-id:GITHUB_APP_ID:trim"
  "github-app-slug:GITHUB_APP_SLUG:trim"
  "github-app-private-key:GITHUB_APP_PRIVATE_KEY:raw"
  "github-app-webhook-secret:GITHUB_APP_WEBHOOK_SECRET:trim"
)

for entry in "${MAPPINGS[@]}"; do
  src="${entry%%:*}"
  if ! gcloud secrets describe "$src" --project="$GCP_PROJECT" >/dev/null 2>&1; then
    echo "${red}✗ Secret ${src} not found in ${GCP_PROJECT}${off}"
    exit 1
  fi
done
echo "${green}✓${off} All ${#MAPPINGS[@]} source secrets present"
echo

# --- Copy --------------------------------------------------------------------

for entry in "${MAPPINGS[@]}"; do
  src="${entry%%:*}"
  rest="${entry#*:}"
  binding="${rest%%:*}"
  mode="${rest##*:}"

  printf "  %-24s → %-24s " "$src" "$binding"

  if [ "$mode" = "trim" ]; then
    gcloud secrets versions access latest --secret="$src" --project="$GCP_PROJECT" \
      | tr -d '\n' \
      | npx wrangler pages secret put "$binding" --project-name="$PAGES_PROJECT" >/dev/null 2>&1
  else
    gcloud secrets versions access latest --secret="$src" --project="$GCP_PROJECT" \
      | npx wrangler pages secret put "$binding" --project-name="$PAGES_PROJECT" >/dev/null 2>&1
  fi

  echo "${green}✓${off}"
done

echo
echo "${bold}Stored bindings:${off}"
npx wrangler pages secret list --project-name="$PAGES_PROJECT"

echo
echo "${yellow}Next:${off} deploy, then confirm the Function answers with the PROD client id"
echo "  npm run build && npx wrangler pages deploy dist --project-name=${PAGES_PROJECT}"
echo "  curl -s https://${PAGES_PROJECT}.pages.dev/api/github/oauth/client-id"
echo
echo "  Expect the prod OAuth App. If it returns staging's dev client id, stop —"
echo "  every stored user token was minted by the prod App and would 401."
