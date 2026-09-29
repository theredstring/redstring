#!/bin/bash

# ─────────────────────────────────────────────────────────────────────────────
# LEGACY — retired; see documentation/security/RUNBOOK.md.
# Redstring now ships via Cloudflare Pages. The Cloud Run services these
# scripts deploy held the GitHub App key and were public
# (--allow-unauthenticated). Refuses to run unless explicitly opted in.
# ─────────────────────────────────────────────────────────────────────────────
if [ "${REDSTRING_ALLOW_LEGACY_GCP:-}" != "1" ]; then
  echo "Refusing to run: this is a retired GCP deployment script." >&2
  echo "See documentation/security/RUNBOOK.md. Set REDSTRING_ALLOW_LEGACY_GCP=1 to override." >&2
  exit 1
fi

# Ultra-Fast Local Docker Build Script for M4 Pro
# Optimized for maximum speed with parallel operations

set -e

# Resolve to repo root so relative paths work from any location
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "${REPO_ROOT}"

# Start timing
START_TIME=$(date +%s)

PROJECT_ID="redstring-470201"
SERVICE_NAME="redstring-test"
REGION="us-central1"
PORT="8080"

echo "🚀 Starting FAST local Docker build for M4 Pro..."

# Use BuildKit for faster builds and parallel operations
export DOCKER_BUILDKIT=1

# Build the Docker image with max parallelism
echo "📦 Building Docker image with M4 Pro optimization..."
docker build \
    --platform linux/amd64 \
    --build-arg BUILDKIT_INLINE_CACHE=1 \
    --progress=plain \
    -t gcr.io/${PROJECT_ID}/${SERVICE_NAME}:local \
    -f deployment/docker/Dockerfile .

echo "✅ Docker image built successfully"

# Push and deploy in parallel using background jobs
echo "📤 Starting parallel push and deploy..."

# Start push in background
(
    echo "  📤 Pushing to GCR..."
    docker push gcr.io/${PROJECT_ID}/${SERVICE_NAME}:local
    echo "  ✅ Push complete"
) &
PUSH_PID=$!

# Wait for push to complete before deploying
wait $PUSH_PID

echo "🚀 Deploying to Cloud Run with M4 Pro specs..."

# Use custom domain for redstring-test
SERVICE_URL="https://redstring-test-umk552kp4q-uc.a.run.app"
echo "📍 Using service URL: ${SERVICE_URL}"

# Deploy with high-performance settings
gcloud run deploy ${SERVICE_NAME} \
    --image gcr.io/${PROJECT_ID}/${SERVICE_NAME}:local \
    --region ${REGION} \
    --platform managed \
    --allow-unauthenticated \
    --port ${PORT} \
    --memory 2Gi \
    --cpu 2 \
    --concurrency 200 \
    --max-instances 3 \
    --timeout 300 \
    --cpu-boost \
    --execution-environment gen2 \
    --set-env-vars "NODE_ENV=production,VITE_BRIDGE_URL=${SERVICE_URL},VITE_OAUTH_URL=${SERVICE_URL}" \
    --set-secrets "GITHUB_CLIENT_ID=github-client-id:latest,GITHUB_CLIENT_SECRET=github-client-secret:latest,GITHUB_APP_ID=github-app-id:latest,GITHUB_APP_PRIVATE_KEY=github-app-private-key:latest,GITHUB_CLIENT_ID_DEV=github-client-id-dev:latest,GITHUB_CLIENT_SECRET_DEV=github-client-secret-dev:latest,GITHUB_APP_ID_DEV=github-app-id-dev:latest,GITHUB_APP_PRIVATE_KEY_DEV=github-app-private-key-dev:latest,GITHUB_APP_SLUG_DEV=github-app-slug-dev:latest" \
    --quiet

echo "✅ M4 Pro optimized build and deployment complete!"

# Show the service URL (using custom domain)
echo "🌐 Service URL: ${SERVICE_URL}"
ACTUAL_URL=$(gcloud run services describe ${SERVICE_NAME} --region=${REGION} --format='value(status.url)')
echo "🔗 Auto-generated URL: ${ACTUAL_URL}"

echo ""
echo "⚡ M4 Pro Performance Settings Applied:"
echo "   • 2 CPU cores (max for Cloud Run)"
echo "   • 2GB RAM"
echo "   • CPU boost enabled"
echo "   • Gen2 execution environment"
echo "   • 200 concurrent requests"
echo "   • BuildKit optimized Docker builds"
echo ""
echo "📝 For your dev GitHub App, use:"
echo "   Homepage: ${SERVICE_URL}/"
echo "   OAuth callback: ${SERVICE_URL}/api/github/app/callback"
echo "   Setup URL: ${SERVICE_URL}/api/github/app/setup"
echo "   Webhook: ${SERVICE_URL}/api/github/app/webhook"
echo ""

# Calculate elapsed time and show completion time
END_TIME=$(date +%s)
ELAPSED=$((END_TIME - START_TIME))
MINUTES=$((ELAPSED / 60))
SECONDS=$((ELAPSED % 60))
COMPLETION_TIME=$(date +"%I:%M:%S %p")

echo "⏱️  Total build time: ${MINUTES}m ${SECONDS}s"
echo "🕐 Completed at: ${COMPLETION_TIME}"
