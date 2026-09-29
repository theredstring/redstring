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

# OAuth Server Production Deployment Script
# Deploys ONLY the OAuth server to Google Cloud Run production environment

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
PURPLE='\033[0;35m'
BOLD='\033[1m'
NC='\033[0m' # No Color

# Configuration
PROJECT_ID=${1:-$(gcloud config get-value project 2>/dev/null)}
REGION=${2:-"us-central1"}
SERVICE_NAME="redstring-oauth-prod"

# Header
echo -e "${BOLD}${PURPLE}🔐 OAuth Server - PRODUCTION DEPLOYMENT${NC}"
echo -e "${PURPLE}=============================================${NC}"
echo ""

# Validation
if [ -z "$PROJECT_ID" ]; then
    echo -e "${RED}❌ No project ID specified and no default project set${NC}"
    echo -e "${YELLOW}Usage: $0 [project-id] [region]${NC}"
    echo -e "${YELLOW}Example: $0 my-project-123 us-central1${NC}"
    exit 1
fi

echo -e "${BLUE}📋 OAuth Deployment Configuration:${NC}"
echo -e "   Project ID: ${BOLD}${PROJECT_ID}${NC}"
echo -e "   Region: ${BOLD}${REGION}${NC}"
echo -e "   Service: ${BOLD}${SERVICE_NAME}${NC}"
echo -e "   Component: ${BOLD}${PURPLE}OAuth Server Only${NC}"
echo -e "   Environment: ${BOLD}${RED}PRODUCTION${NC}"
echo ""

# Confirmation prompt
read -p "$(echo -e ${YELLOW}🚨 Deploy OAuth server to PRODUCTION? [y/N]: ${NC})" -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo -e "${YELLOW}⏹️  OAuth deployment cancelled${NC}"
    exit 0
fi

# Set project context
echo -e "${YELLOW}🔧 Setting up project context...${NC}"
gcloud config set project $PROJECT_ID

# Create OAuth-only Dockerfile
echo -e "${YELLOW}📦 Creating OAuth-only Docker configuration...${NC}"
cat > oauth.Dockerfile << 'EOF'
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

# Start OAuth server
CMD ["node", "oauth-server.js"]
EOF

echo -e "${GREEN}✅ OAuth Dockerfile created${NC}"

# Build and deploy OAuth server
echo -e "${YELLOW}🏗️  Building OAuth server image...${NC}"
docker build -f oauth.Dockerfile -t gcr.io/$PROJECT_ID/redstring-oauth:latest .

echo -e "${YELLOW}📤 Pushing OAuth image to registry...${NC}"
docker push gcr.io/$PROJECT_ID/redstring-oauth:latest

# Deploy to Cloud Run
echo -e "${YELLOW}🚀 Deploying OAuth server to Cloud Run...${NC}"
gcloud run deploy $SERVICE_NAME \
    --image gcr.io/$PROJECT_ID/redstring-oauth:latest \
    --region $REGION \
    --platform managed \
    --allow-unauthenticated \
    --port 3002 \
    --memory 256Mi \
    --cpu 1 \
    --concurrency 50 \
    --max-instances 5 \
    --set-env-vars "NODE_ENV=production,OAUTH_PORT=3002,OAUTH_BIND_HOST=0.0.0.0" \
    --set-secrets "GITHUB_CLIENT_ID=github-client-id:latest,GITHUB_CLIENT_SECRET=github-client-secret:latest"

# Get service URL
PROJECT_NUMBER=$(gcloud projects describe $PROJECT_ID --format="value(projectNumber)")
SERVICE_URL="https://${SERVICE_NAME}-${PROJECT_NUMBER}.a.run.app"

# Test OAuth server
echo -e "${YELLOW}🔍 Testing OAuth server deployment...${NC}"
sleep 10

if curl -s --max-time 30 "${SERVICE_URL}/health" | grep -q "oauth-server"; then
    echo -e "${GREEN}✅ OAuth server health check passed${NC}"
else
    echo -e "${YELLOW}⚠️  OAuth server health check failed or timed out${NC}"
fi

# Test OAuth endpoints
if curl -s --max-time 15 "${SERVICE_URL}/api/github/oauth/client-id" | grep -q "clientId\|configured"; then
    echo -e "${GREEN}✅ OAuth client-id endpoint responding${NC}"
else
    echo -e "${YELLOW}⚠️  OAuth client-id endpoint test inconclusive${NC}"
fi

# Cleanup
rm -f oauth.Dockerfile

# Deployment summary
echo ""
echo -e "${BOLD}${GREEN}🎉 OAUTH SERVER PRODUCTION DEPLOYMENT COMPLETE!${NC}"
echo -e "${GREEN}================================================${NC}"
echo ""
echo -e "${BLUE}📊 OAuth Deployment Summary:${NC}"
echo -e "   Service: ${BOLD}${SERVICE_NAME}${NC}"
echo -e "   URL: ${BOLD}${PURPLE}${SERVICE_URL}${NC}"
echo -e "   Port: ${BOLD}3002${NC}"
echo -e "   Component: ${BOLD}OAuth Server Only${NC}"
echo ""
echo -e "${BLUE}🔗 OAuth Endpoints:${NC}"
echo -e "   🔐 Health: ${SERVICE_URL}/health"
echo -e "   🆔 Client ID: ${SERVICE_URL}/api/github/oauth/client-id"
echo -e "   🔄 Token Exchange: ${SERVICE_URL}/api/github/oauth/token"
echo ""
echo -e "${BLUE}📋 Management Commands:${NC}"
echo -e "   View logs: ${BOLD}gcloud logs tail --filter=\"resource.labels.service_name=${SERVICE_NAME}\"${NC}"
echo -e "   Update service: ${BOLD}gcloud run services update ${SERVICE_NAME} --region=${REGION}${NC}"
echo -e "   Delete service: ${BOLD}gcloud run services delete ${SERVICE_NAME} --region=${REGION}${NC}"
echo ""
echo -e "${PURPLE}🔐 OAuth server is now live in production! 🔐${NC}"
echo -e "${YELLOW}💡 Remember to update your main Redstring app to use this OAuth server URL${NC}"
echo ""
echo -e "${GREEN}Deployment completed at: $(date)${NC}"