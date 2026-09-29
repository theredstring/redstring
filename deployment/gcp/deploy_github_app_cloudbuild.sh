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

# GitHub App Production Deployment Script using Cloud Build
# Deploys OAuth server with GitHub App support via Cloud Build

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
echo -e "${BOLD}${PURPLE}🏗️  GitHub App OAuth Server - CLOUD BUILD DEPLOYMENT${NC}"
echo -e "${PURPLE}====================================================${NC}"
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
echo -e "   Build Method: ${BOLD}${PURPLE}Google Cloud Build${NC}"
echo ""

# Confirmation
read -p "🚨 Deploy to PRODUCTION via Cloud Build? [y/N]: " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo -e "${YELLOW}⏹️  Deployment cancelled${NC}"
    exit 0
fi

# Set project context
gcloud config set project $PROJECT_ID

# Check if Cloud Build API is enabled
echo -e "${YELLOW}🔍 Checking Cloud Build API...${NC}"
if ! gcloud services list --enabled --filter="name:cloudbuild.googleapis.com" --format="value(name)" | grep -q cloudbuild; then
    echo -e "${YELLOW}⚠️  Enabling Cloud Build API...${NC}"
    gcloud services enable cloudbuild.googleapis.com
    echo -e "${GREEN}✅ Cloud Build API enabled${NC}"
fi

# Submit build to Cloud Build
echo -e "${YELLOW}🏗️  Submitting GitHub App OAuth server build to Cloud Build...${NC}"
gcloud builds submit \
    --config cloudbuild-github-app.yaml \
    --substitutions _REGION=$REGION \
    --timeout=1200s \
    .

# Get service URL
echo -e "${YELLOW}🔍 Getting service information...${NC}"
SERVICE_URL=$(gcloud run services describe $SERVICE_NAME --region=$REGION --format="value(status.url)" 2>/dev/null || echo "")

if [ -z "$SERVICE_URL" ]; then
    echo -e "${RED}❌ Failed to get service URL. Deployment may have failed.${NC}"
    echo -e "${BLUE}💡 Check Cloud Build logs: https://console.cloud.google.com/cloud-build/builds?project=${PROJECT_ID}${NC}"
    exit 1
fi

# Test deployment
echo -e "${YELLOW}🔍 Testing deployment...${NC}"
sleep 15

if curl -s --max-time 30 "${SERVICE_URL}/health" | grep -q "oauth-server"; then
    echo -e "${GREEN}✅ OAuth server health check passed${NC}"
else
    echo -e "${YELLOW}⚠️  Health check didn't pass immediately - this is normal for new deployments${NC}"
    echo -e "${BLUE}💡 Try again in a few minutes: curl ${SERVICE_URL}/health${NC}"
fi

# Success
echo ""
echo -e "${BOLD}${GREEN}🎉 GITHUB APP OAUTH SERVER DEPLOYMENT COMPLETE!${NC}"
echo -e "${GREEN}============================================${NC}"
echo ""
echo -e "${BLUE}📊 Deployment Summary:${NC}"
echo -e "   Service: ${BOLD}${SERVICE_NAME}${NC}"
echo -e "   URL: ${BOLD}${PURPLE}${SERVICE_URL}${NC}"
echo -e "   Features: ${BOLD}${GREEN}OAuth + GitHub App Authentication${NC}"
echo -e "   Build Method: ${BOLD}${PURPLE}Google Cloud Build${NC}"
echo ""
echo -e "${BLUE}🔗 Endpoints:${NC}"
echo -e "   🔐 Health: ${SERVICE_URL}/health"
echo -e "   🆔 OAuth Client ID: ${SERVICE_URL}/api/github/oauth/client-id"
echo -e "   🔄 OAuth Token: ${SERVICE_URL}/api/github/oauth/token"
echo -e "   🏢 App Installation Token: ${SERVICE_URL}/api/github/app/installation-token"
echo -e "   📊 App Installation Data: ${SERVICE_URL}/api/github/app/installation/{id}"
echo -e "   🪝 App Webhook: ${SERVICE_URL}/api/github/app/webhook"
echo ""
echo -e "${BLUE}🔧 Management URLs:${NC}"
echo -e "   📊 Cloud Build History: https://console.cloud.google.com/cloud-build/builds?project=${PROJECT_ID}"
echo -e "   🏃 Cloud Run Service: https://console.cloud.google.com/run/detail/${REGION}/${SERVICE_NAME}?project=${PROJECT_ID}"
echo -e "   🔐 Secret Manager: https://console.cloud.google.com/security/secret-manager?project=${PROJECT_ID}"
echo ""
echo -e "${YELLOW}📝 Next Steps:${NC}"
echo -e "1. Update your GitHub App webhook URL to: ${BOLD}${SERVICE_URL}/api/github/app/webhook${NC}"
echo -e "2. Test GitHub App installation flow"
echo -e "3. Monitor Cloud Run logs for any issues"
echo ""
echo -e "${PURPLE}🚀 GitHub App integration is now live in production via Cloud Build! 🚀${NC}"
