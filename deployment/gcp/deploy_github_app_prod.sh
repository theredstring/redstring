#!/bin/bash

# GitHub App Production Deployment Script
# Deploys OAuth server with GitHub App support

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
PURPLE='\033[0;35m'
BOLD='\033[1m'
NC='\033[0m'

# Configuration
PROJECT_ID=${1:-$(gcloud config get-value project 2>/dev/null)}
REGION=${2:-"us-central1"}
SERVICE_NAME="redstring-oauth-prod"

# Header
echo -e "${BOLD}${PURPLE}🔐 GitHub App OAuth Server - PRODUCTION DEPLOYMENT${NC}"
echo -e "${PURPLE}=================================================${NC}"
echo ""

# Validation
if [ -z "$PROJECT_ID" ]; then
    echo -e "${RED}❌ No project ID specified and no default project set${NC}"
    echo -e "${YELLOW}Usage: $0 [project-id] [region]${NC}"
    exit 1
fi

echo -e "${BLUE}📋 Deployment Configuration:${NC}"
echo -e "   Project ID: ${BOLD}${PROJECT_ID}${NC}"
echo -e "   Region: ${BOLD}${REGION}${NC}"
echo -e "   Service: ${BOLD}${SERVICE_NAME}${NC}"
echo -e "   Features: ${BOLD}${GREEN}OAuth + GitHub App${NC}"
echo ""

# Confirmation
read -p "🚨 Deploy to PRODUCTION? [y/N]: " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo -e "${YELLOW}⏹️  Deployment cancelled${NC}"
    exit 0
fi

# Set project context
gcloud config set project $PROJECT_ID

# Create enhanced Dockerfile
echo -e "${YELLOW}📦 Creating enhanced OAuth+GitHub App Docker configuration...${NC}"
cat > oauth-app.Dockerfile << 'DOCKERFILE'
FROM node:18-alpine

WORKDIR /app

# Install curl for health checks
RUN apk add --no-cache curl

# Copy package files
COPY package*.json ./
RUN npm ci --only=production

# Copy OAuth server with GitHub App support
COPY oauth-server.js ./

# Expose OAuth port
EXPOSE 3002

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:3002/health || exit 1

# Start OAuth server
CMD ["node", "oauth-server.js"]
DOCKERFILE

echo -e "${GREEN}✅ Enhanced Dockerfile created${NC}"

# Build and deploy
echo -e "${YELLOW}🏗️  Building OAuth+GitHub App image...${NC}"
docker build -f oauth-app.Dockerfile -t gcr.io/$PROJECT_ID/redstring-oauth-app:latest .

echo -e "${YELLOW}📤 Pushing image to registry...${NC}"
docker push gcr.io/$PROJECT_ID/redstring-oauth-app:latest

# Deploy to Cloud Run with both OAuth and GitHub App secrets
echo -e "${YELLOW}🚀 Deploying OAuth+GitHub App server to Cloud Run...${NC}"
gcloud run deploy $SERVICE_NAME \
    --image gcr.io/$PROJECT_ID/redstring-oauth-app:latest \
    --region $REGION \
    --platform managed \
    --allow-unauthenticated \
    --port 3002 \
    --memory 512Mi \
    --cpu 0.5 \
    --concurrency 50 \
    --max-instances 10 \
    --set-env-vars "NODE_ENV=production,OAUTH_PORT=3002" \
    --set-secrets "GITHUB_CLIENT_ID=github-client-id:latest,GITHUB_CLIENT_SECRET=github-client-secret:latest,GITHUB_APP_ID=github-app-id:latest,GITHUB_APP_CLIENT_ID=github-app-client-id:latest,GITHUB_APP_CLIENT_SECRET=github-app-client-secret:latest,GITHUB_APP_PRIVATE_KEY=github-app-private-key:latest,GITHUB_APP_WEBHOOK_SECRET=github-app-webhook-secret:latest"

# Get service URL
SERVICE_URL=$(gcloud run services describe $SERVICE_NAME --region=$REGION --format="value(status.url)")

# Test deployment
echo -e "${YELLOW}🔍 Testing deployment...${NC}"
sleep 10

if curl -s --max-time 30 "${SERVICE_URL}/health" | grep -q "oauth-server"; then
    echo -e "${GREEN}✅ OAuth server health check passed${NC}"
else
    echo -e "${RED}❌ OAuth server health check failed${NC}"
fi

# Cleanup
rm -f oauth-app.Dockerfile

# Success
echo ""
echo -e "${BOLD}${GREEN}🎉 GITHUB APP OAUTH SERVER DEPLOYMENT COMPLETE!${NC}"
echo -e "${GREEN}============================================${NC}"
echo ""
echo -e "${BLUE}📊 Deployment Summary:${NC}"
echo -e "   Service: ${BOLD}${SERVICE_NAME}${NC}"
echo -e "   URL: ${BOLD}${PURPLE}${SERVICE_URL}${NC}"
echo -e "   Features: ${BOLD}${GREEN}OAuth + GitHub App Authentication${NC}"
echo ""
echo -e "${BLUE}🔗 Endpoints:${NC}"
echo -e "   🔐 Health: ${SERVICE_URL}/health"
echo -e "   🆔 OAuth Client ID: ${SERVICE_URL}/api/github/oauth/client-id"
echo -e "   🔄 OAuth Token: ${SERVICE_URL}/api/github/oauth/token"
echo -e "   🏢 App Installation Token: ${SERVICE_URL}/api/github/app/installation-token"
echo -e "   📊 App Installation Data: ${SERVICE_URL}/api/github/app/installation/{id}"
echo -e "   🪝 App Webhook: ${SERVICE_URL}/api/github/app/webhook"
echo ""
echo -e "${PURPLE}🚀 GitHub App integration is now live in production! 🚀${NC}"
echo ""
echo -e "${GREEN}Deployment completed at: $(date)${NC}"
