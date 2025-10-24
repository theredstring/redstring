#!/bin/bash

# Deploy logging fixes to reduce console log spam in production
# This script deploys the updated servers with proper logging controls

set -e

echo "🔧 Deploying logging fixes to reduce console log spam..."

# Check if we're in the right directory
if [ ! -f "cloudbuild.yaml" ]; then
    echo "❌ Error: Please run this script from the project root directory"
    exit 1
fi

# Get project ID
PROJECT_ID=$(gcloud config get-value project 2>/dev/null)
if [ -z "$PROJECT_ID" ]; then
    echo "❌ Error: No Google Cloud project configured"
    echo "Please run: gcloud config set project YOUR_PROJECT_ID"
    exit 1
fi

echo "📋 Project: $PROJECT_ID"
echo "🌍 Environment: Production"
echo ""

# Deploy the fixes
echo "🚀 Deploying to production..."
gcloud builds submit \
    --config cloudbuild.yaml \
    --substitutions _REGION=us-central1,_GITHUB_CLIENT_ID=placeholder \
    .

echo ""
echo "✅ Deployment initiated!"
echo ""
echo "📊 Monitor deployment:"
echo "gcloud builds log \$(gcloud builds list --limit=1 --format='value(id)')"
echo ""
echo "🔍 The following changes were deployed:"
echo "  • Added environment-based logging controls to app-semantic-server.js"
echo "  • Added environment-based logging controls to oauth-server.js"
echo "  • Added environment-based logging controls to bridge-daemon.js"
echo "  • Set LOG_LEVEL=warn for production (reduces verbose logging)"
echo "  • Console logs now respect NODE_ENV and LOG_LEVEL settings"
echo ""
echo "🌐 Once deployed, your app will be available at:"
echo "https://redstring-prod-\$(gcloud projects describe $PROJECT_ID --format='value(projectNumber)').a.run.app"
echo ""
echo "📝 To adjust logging levels in the future, you can:"
echo "  • Set LOG_LEVEL=error for minimal logging"
echo "  • Set LOG_LEVEL=info for normal logging"
echo "  • Set LOG_LEVEL=debug for verbose logging"
