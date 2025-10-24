#!/bin/bash

# Ultra-Fast TEST Deployment Script for M4 Pro
# Deploys to redstring-test service with test GitHub credentials

set -e

# Resolve to repo root so relative paths work no matter where the script is run
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "${REPO_ROOT}"

# Start timing
START_TIME=$(date +%s)

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
BOLD='\033[1m'
NC='\033[0m' # No Color

PROJECT_ID="redstring-470201"
SERVICE_NAME="redstring-test"
REGION="us-central1"
PORT="4000"

echo -e "${BOLD}${BLUE}🧪 FAST TEST DEPLOYMENT${NC}"
echo -e "${BLUE}================================${NC}"
echo ""

# Test confirmation
read -p "$(echo -e ${YELLOW}🧪 Deploy to TEST environment? [y/N]: ${NC})" -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo -e "${YELLOW}⏹️  Deployment cancelled${NC}"
    exit 0
fi

echo "🚀 Starting FAST test build for M4 Pro..."

# Use BuildKit for faster builds and parallel operations
export DOCKER_BUILDKIT=1

# Build the Docker image with max parallelism using TEST Dockerfile
echo "📦 Building Docker image with TEST configuration..."
docker build \
    --platform linux/amd64 \
    --build-arg BUILDKIT_INLINE_CACHE=1 \
    --progress=plain \
    -t gcr.io/${PROJECT_ID}/${SERVICE_NAME}:latest \
    -f deployment/docker/Dockerfile.test .

echo -e "${GREEN}✅ Docker image built successfully${NC}"

# Push to GCR
echo "📤 Pushing to GCR..."
docker push gcr.io/${PROJECT_ID}/${SERVICE_NAME}:latest

echo -e "${GREEN}✅ Push complete${NC}"

# Deploy to Cloud Run with TEST settings
echo -e "${BLUE}🚀 Deploying to TEST Cloud Run...${NC}"

gcloud run deploy ${SERVICE_NAME} \
    --image gcr.io/${PROJECT_ID}/${SERVICE_NAME}:latest \
    --region ${REGION} \
    --platform managed \
    --allow-unauthenticated \
    --port ${PORT} \
    --memory 1Gi \
    --cpu 2 \
    --concurrency 100 \
    --max-instances 10 \
    --set-env-vars "NODE_ENV=development,OAUTH_PORT=3002,LOG_LEVEL=info" \
    --set-secrets "GITHUB_CLIENT_ID=github-client-id-test:latest,GITHUB_CLIENT_SECRET=github-client-secret-test:latest,VITE_GITHUB_CLIENT_ID=github-client-id-test:latest,GITHUB_APP_ID=github-app-id-test:latest,GITHUB_APP_CLIENT_ID=github-app-client-id-test:latest,GITHUB_APP_CLIENT_SECRET=github-app-client-secret-test:latest,GITHUB_APP_PRIVATE_KEY=github-app-private-key-test:latest,GITHUB_APP_WEBHOOK_SECRET=github-app-webhook-secret:latest,GITHUB_APP_SLUG=github-app-slug-test:latest,GITHUB_APP_SLUG_DEV=github-app-slug-test:latest" \
    --quiet

echo -e "${GREEN}✅ Test deployment complete!${NC}"

# Get service URL
SERVICE_URL=$(gcloud run services describe ${SERVICE_NAME} --region=${REGION} --format='value(status.url)')
echo -e "${BOLD}${GREEN}🌐 Test URL: ${SERVICE_URL}${NC}"

# Quick health check
echo "🔍 Testing deployment..."
sleep 10
if curl -s --max-time 30 "${SERVICE_URL}/health" | grep -q "healthy"; then
    echo -e "${GREEN}✅ Health check passed${NC}"
else
    echo -e "${YELLOW}⚠️  Health check failed or timed out - service may still be starting${NC}"
fi

echo ""
echo -e "${BOLD}${GREEN}🎉 FAST TEST DEPLOYMENT COMPLETE!${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""
echo -e "${BLUE}📊 Test Environment Settings:${NC}"
echo -e "   • 2 CPU cores"
echo -e "   • 1GB RAM"
echo -e "   • 100 concurrent requests"
echo -e "   • Max 10 instances"
echo -e "   • Port 4000"
echo -e "   • OAuth Port 3002"
echo -e "   • Log Level: INFO"
echo -e "   • GitHub App: ${BOLD}redstring-semantic-sync-test${NC}"
echo -e "   • OAuth: ${BOLD}TEST credentials${NC}"
echo ""
echo -e "${BLUE}🔗 Test Links:${NC}"
echo -e "   🌐 Application: ${SERVICE_URL}"
echo -e "   💚 Health Check: ${SERVICE_URL}/health"
echo -e "   📊 Console: https://console.cloud.google.com/run/detail/${REGION}/${SERVICE_NAME}/metrics?project=${PROJECT_ID}"
echo ""

# Calculate elapsed time
END_TIME=$(date +%s)
ELAPSED=$((END_TIME - START_TIME))
MINUTES=$((ELAPSED / 60))
SECONDS=$((ELAPSED % 60))
COMPLETION_TIME=$(date +"%I:%M:%S %p")

echo -e "${BOLD}⏱️  Total deployment time: ${MINUTES}m ${SECONDS}s${NC}"
echo -e "${BOLD}🕐 Completed at: ${COMPLETION_TIME}${NC}"
echo ""
echo -e "${GREEN}✨ Test environment is LIVE! ✨${NC}"
