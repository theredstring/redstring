#!/bin/bash

# Update Dev GitHub App Secrets
# Run this after creating your dev GitHub Apps

set -e

echo "🔐 Updating dev GitHub App secrets..."

# Check if required arguments are provided
if [ $# -ne 5 ]; then
    echo "Usage: $0 <oauth-client-id> <oauth-client-secret> <app-id> <app-private-key-path> <app-slug>"
    echo ""
    echo "Example:"
    echo "  $0 'Ov23liXXXXXXXXXX' 'your-oauth-secret' '1234567' './dev-app-private-key.pem' 'redstring-semantic-sync-dev'"
    echo ""
    echo "Get these from:"
    echo "  - OAuth App: https://github.com/settings/applications"
    echo "  - GitHub App: https://github.com/settings/apps"
    exit 1
fi

OAUTH_CLIENT_ID="$1"
OAUTH_CLIENT_SECRET="$2"
APP_ID="$3"
PRIVATE_KEY_PATH="$4"
APP_SLUG="$5"

# Validate private key file exists
if [ ! -f "$PRIVATE_KEY_PATH" ]; then
    echo "❌ Private key file not found: $PRIVATE_KEY_PATH"
    exit 1
fi

echo "📝 Updating OAuth App secrets..."
echo "$OAUTH_CLIENT_ID" | gcloud secrets versions add github-client-id-dev --data-file=-
echo "$OAUTH_CLIENT_SECRET" | gcloud secrets versions add github-client-secret-dev --data-file=-

echo "📝 Updating GitHub App secrets..."
echo "$APP_ID" | gcloud secrets versions add github-app-id-dev --data-file=-
gcloud secrets versions add github-app-private-key-dev --data-file="$PRIVATE_KEY_PATH"
echo "$APP_SLUG" | gcloud secrets versions add github-app-slug-dev --data-file=-

echo "✅ All dev secrets updated!"
echo ""
echo "🚀 You can now run: ./scripts/local-build.sh"
