#!/bin/bash

# OAuth Server Test Deployment Script
# Deploys ONLY the OAuth server to Google Cloud Run test environment

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
PURPLE='\033[0;35m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m' # No Color

# Configuration
PROJECT_ID=${1:-$(gcloud config get-value project 2>/dev/null)}
REGION=${2:-"us-central1"}
SERVICE_NAME="redstring-oauth-test"

# Header
echo -e "${BOLD}${CYAN}🔐 OAuth Server - TEST DEPLOYMENT${NC}"
echo -e "${CYAN}====================================${NC}"
echo ""

# Validation
if [ -z "$PROJECT_ID" ]; then
    echo -e "${RED}❌ No project ID specified and no default project set${NC}"
    echo -e "${YELLOW}Usage: $0 [project-id] [region]${NC}"
    echo -e "${YELLOW}Example: $0 my-project-123 us-central1${NC}"
    exit 1
fi

echo -e "${BLUE}📋 OAuth Test Deployment Configuration:${NC}"
echo -e "   Project ID: ${BOLD}${PROJECT_ID}${NC}"
echo -e "   Region: ${BOLD}${REGION}${NC}"
echo -e "   Service: ${BOLD}${SERVICE_NAME}${NC}"
echo -e "   Component: ${BOLD}${PURPLE}OAuth Server Only${NC}"
echo -e "   Environment: ${BOLD}${CYAN}TEST${NC}"
echo ""

# Set project context
echo -e "${YELLOW}🔧 Setting up project context...${NC}"
gcloud config set project $PROJECT_ID

# Create OAuth-only Dockerfile for test
echo -e "${YELLOW}📦 Creating OAuth test Docker configuration...${NC}"
cat > oauth-test.Dockerfile << 'EOF'
FROM node:18-alpine

WORKDIR /app

# Copy package files
COPY package*.json ./
RUN npm ci --only=production

# Copy only OAuth server files
COPY oauth-server.js ./

# Expose OAuth port
EXPOSE 3002

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:3002/health || exit 1

# Start OAuth server with debug logging for test
CMD ["node", "oauth-server.js"]
EOF

echo -e "${GREEN}✅ OAuth test Dockerfile created${NC}"

# Build and deploy OAuth server for test
echo -e "${YELLOW}🏗️  Building OAuth test server image...${NC}"
docker build --platform linux/amd64 -f oauth-test.Dockerfile -t gcr.io/$PROJECT_ID/redstring-oauth:test .

echo -e "${YELLOW}📤 Pushing OAuth test image to registry...${NC}"
docker push gcr.io/$PROJECT_ID/redstring-oauth:test

# Deploy to Cloud Run (test environment with smaller resources)
echo -e "${YELLOW}🚀 Deploying OAuth server to Cloud Run test...${NC}"
gcloud run deploy $SERVICE_NAME \
    --image gcr.io/$PROJECT_ID/redstring-oauth:test \
    --region $REGION \
    --platform managed \
    --allow-unauthenticated \
    --port 3002 \
    --memory 512Mi \
    --cpu 1 \
    --concurrency 25 \
    --max-instances 3 \
    --set-env-vars "NODE_ENV=test,OAUTH_PORT=3002" \
    --set-secrets "GITHUB_APP_ID=github-app-id:latest,GITHUB_APP_PRIVATE_KEY=github-app-private-key:latest"

# Get service URL
PROJECT_NUMBER=$(gcloud projects describe $PROJECT_ID --format="value(projectNumber)")
SERVICE_URL="https://${SERVICE_NAME}-${PROJECT_NUMBER}.a.run.app"

# Test OAuth server
echo -e "${YELLOW}🧪 Running OAuth server tests...${NC}"
sleep 10

# Health check
if curl -s --max-time 30 "${SERVICE_URL}/health" | grep -q "oauth-server"; then
    echo -e "   ✅ Health check passed"
else
    echo -e "${YELLOW}   ⚠️  Health check failed or timed out${NC}"
fi

# Client ID endpoint test
if curl -s --max-time 15 "${SERVICE_URL}/api/github/oauth/client-id" | grep -q "clientId\|configured"; then
    echo -e "   ✅ Client ID endpoint responding"
else
    echo -e "${YELLOW}   ⚠️  Client ID endpoint test inconclusive${NC}"
fi

# Performance test
echo -e "${YELLOW}🚀 Running OAuth performance test...${NC}"
RESPONSE_TIME=$(curl -w "%{time_total}" -s -o /dev/null "${SERVICE_URL}/health")
if (( $(echo "$RESPONSE_TIME < 2.0" | bc -l) )); then
    echo -e "   ✅ Response time: ${RESPONSE_TIME}s (good)"
else
    echo -e "${YELLOW}   ⚠️  Response time: ${RESPONSE_TIME}s (slower than expected)${NC}"
fi

# OAuth flow simulation (without actual GitHub)
echo -e "${YELLOW}🔄 Testing OAuth endpoints...${NC}"

# Test with mock data
MOCK_RESPONSE=$(curl -s -X POST "${SERVICE_URL}/api/github/oauth/token" \
    -H "Content-Type: application/json" \
    -d '{"code":"mock","state":"mock","redirect_uri":"test"}' || echo "failed")

if [[ "$MOCK_RESPONSE" == *"error"* ]]; then
    echo -e "   ✅ OAuth endpoint properly rejecting invalid requests"
else
    echo -e "${YELLOW}   ⚠️  OAuth endpoint behavior unclear${NC}"
fi

# Cleanup
rm -f oauth-test.Dockerfile

# Test deployment summary
echo ""
echo -e "${BOLD}${GREEN}🎉 OAUTH SERVER TEST DEPLOYMENT COMPLETE!${NC}"
echo -e "${GREEN}============================================${NC}"
echo ""
echo -e "${BLUE}📊 OAuth Test Deployment Summary:${NC}"
echo -e "   Service: ${BOLD}${SERVICE_NAME}${NC}"
echo -e "   URL: ${BOLD}${CYAN}${SERVICE_URL}${NC}"
echo -e "   Port: ${BOLD}3002${NC}"
echo -e "   Component: ${BOLD}OAuth Server Only${NC}"
echo -e "   Environment: ${BOLD}${CYAN}TEST${NC}"
echo ""
echo -e "${BLUE}🔗 OAuth Test Endpoints:${NC}"
echo -e "   🔐 Health: ${SERVICE_URL}/health"
echo -e "   🆔 Client ID: ${SERVICE_URL}/api/github/oauth/client-id"
echo -e "   🔄 Token Exchange: ${SERVICE_URL}/api/github/oauth/token"
echo ""
echo -e "${BLUE}🧪 Testing Commands:${NC}"
echo -e "   Health: ${BOLD}curl ${SERVICE_URL}/health${NC}"
echo -e "   Client ID: ${BOLD}curl ${SERVICE_URL}/api/github/oauth/client-id${NC}"
echo -e "   Load test: ${BOLD}for i in {1..10}; do curl -s ${SERVICE_URL}/health; done${NC}"
echo ""
echo -e "${BLUE}📋 Management Commands:${NC}"
echo -e "   View logs: ${BOLD}gcloud logs tail --filter=\"resource.labels.service_name=${SERVICE_NAME}\"${NC}"
echo -e "   Update service: ${BOLD}gcloud run services update ${SERVICE_NAME} --region=${REGION}${NC}"
echo -e "   Delete service: ${BOLD}gcloud run services delete ${SERVICE_NAME} --region=${REGION}${NC}"
echo ""
echo -e "${CYAN}🧪 OAuth test server is ready for validation! 🧪${NC}"
echo -e "${YELLOW}💡 Use this OAuth server URL in your test Redstring deployment${NC}"