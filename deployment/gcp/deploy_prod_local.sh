#!/bin/bash

# Production Deployment Script (Local Build) for Redstring UI React
# Builds Docker image locally and deploys to Cloud Run production
# This bypasses Cloud Build — faster iteration from your local machine

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
BOLD='\033[1m'
NC='\033[0m' # No Color

# Configuration
PROJECT_ID=${1:-$(gcloud config get-value project 2>/dev/null)}
REGION=${2:-"us-central1"}
SERVICE_NAME="redstring-prod"
IMAGE_NAME="redstring-app"

# Header
echo -e "${BOLD}${BLUE}🏭 Redstring UI React - PRODUCTION DEPLOYMENT (Local Build)${NC}"
echo -e "${BLUE}==============================================================${NC}"
echo ""

# Validation
if [ -z "$PROJECT_ID" ]; then
    echo -e "${RED}❌ No project ID specified and no default project set${NC}"
    echo -e "${YELLOW}Usage: $0 [project-id] [region]${NC}"
    echo -e "${YELLOW}Example: $0 my-project-123 us-central1${NC}"
    exit 1
fi

echo -e "${BLUE}📋 Deployment Configuration:${NC}"
echo -e "   Project ID: ${BOLD}${PROJECT_ID}${NC}"
echo -e "   Region: ${BOLD}${REGION}${NC}"
echo -e "   Service: ${BOLD}${SERVICE_NAME}${NC}"
echo -e "   Image: ${BOLD}gcr.io/${PROJECT_ID}/${IMAGE_NAME}:latest${NC}"
echo -e "   Build Method: ${BOLD}${GREEN}Local Docker${NC}"
echo -e "   Environment: ${BOLD}${RED}PRODUCTION${NC}"
echo ""

# Confirmation prompt
read -p "$(echo -e ${YELLOW}🚨 You are about to deploy to PRODUCTION. Continue? [y/N]: ${NC})" -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo -e "${YELLOW}⏹️  Deployment cancelled${NC}"
    exit 0
fi

# Set project context
echo -e "${YELLOW}🔧 Setting up project context...${NC}"
gcloud config set project $PROJECT_ID

# Verify we can access the project
PROJECT_NUMBER=$(gcloud projects describe $PROJECT_ID --format="value(projectNumber)" 2>/dev/null)
if [ -z "$PROJECT_NUMBER" ]; then
    echo -e "${RED}❌ Cannot access project ${PROJECT_ID}. Check permissions and project ID.${NC}"
    exit 1
fi

echo -e "${GREEN}✅ Project access confirmed (${PROJECT_NUMBER})${NC}"

# Check if required APIs are enabled
echo -e "${YELLOW}🔍 Checking required APIs...${NC}"
REQUIRED_APIS=(
    "run.googleapis.com"
    "secretmanager.googleapis.com"
    "containerregistry.googleapis.com"
)

for api in "${REQUIRED_APIS[@]}"; do
    if gcloud services list --enabled --filter="name:$api" --format="value(name)" | grep -q "$api"; then
        echo -e "   ✅ $api"
    else
        echo -e "${RED}   ❌ $api - MISSING${NC}"
        echo -e "${YELLOW}   Enable with: gcloud services enable $api${NC}"
        exit 1
    fi
done

# Check if secrets exist
echo -e "${YELLOW}🔐 Verifying production secrets...${NC}"
REQUIRED_SECRETS=(
    "github-client-id"
    "github-client-secret"
    "github-app-id"
    "github-app-client-id"
    "github-app-client-secret"
    "github-app-private-key"
    "github-app-webhook-secret"
    "github-app-slug"
)

for secret in "${REQUIRED_SECRETS[@]}"; do
    if gcloud secrets describe $secret >/dev/null 2>&1; then
        echo -e "   ✅ $secret"
    else
        echo -e "${RED}   ❌ $secret - MISSING${NC}"
        echo -e "${YELLOW}   Create with: echo 'your-value' | gcloud secrets create $secret --data-file=-${NC}"
        exit 1
    fi
done

# Pre-deployment checks
echo -e "${YELLOW}🔍 Pre-deployment checks...${NC}"

# Check if Dockerfile exists
if [ ! -f "deployment/docker/Dockerfile" ]; then
    echo -e "${RED}❌ deployment/docker/Dockerfile not found${NC}"
    exit 1
fi
echo -e "   ✅ Dockerfile found"

# Check if package.json exists
if [ ! -f "package.json" ]; then
    echo -e "${RED}❌ package.json not found${NC}"
    exit 1
fi
echo -e "   ✅ package.json found"

# Check Docker is running
if ! docker info >/dev/null 2>&1; then
    echo -e "${RED}❌ Docker is not running. Please start Docker Desktop.${NC}"
    exit 1
fi
echo -e "   ✅ Docker is running"

echo -e "${GREEN}✅ All pre-deployment checks passed${NC}"
echo ""

# Start deployment
echo -e "${BOLD}${BLUE}🚀 Starting Local Build + Cloud Deploy...${NC}"
echo ""

# Build Docker image locally
echo -e "${YELLOW}🏗️  Building Docker image locally...${NC}"
docker build --platform linux/amd64 -f deployment/docker/Dockerfile -t gcr.io/${PROJECT_ID}/${IMAGE_NAME}:latest .

if [ $? -eq 0 ]; then
    echo -e "${GREEN}✅ Docker image built successfully${NC}"
else
    echo -e "${RED}❌ Docker build failed${NC}"
    exit 1
fi

# Push image to Google Container Registry
echo -e "${YELLOW}📤 Pushing image to Google Container Registry...${NC}"
docker push gcr.io/${PROJECT_ID}/${IMAGE_NAME}:latest

if [ $? -eq 0 ]; then
    echo -e "${GREEN}✅ Image pushed successfully${NC}"
else
    echo -e "${RED}❌ Failed to push image${NC}"
    exit 1
fi

# Deploy to Cloud Run
echo -e "${YELLOW}🚀 Deploying to Cloud Run...${NC}"
gcloud run deploy ${SERVICE_NAME} \
    --image gcr.io/${PROJECT_ID}/${IMAGE_NAME}:latest \
    --region ${REGION} \
    --platform managed \
    --allow-unauthenticated \
    --port 4000 \
    --memory 1Gi \
    --cpu 2 \
    --concurrency 100 \
    --max-instances 10 \
    --set-env-vars "NODE_ENV=production,OAUTH_PORT=3002,LOG_LEVEL=warn" \
    --set-secrets "GITHUB_CLIENT_ID=github-client-id:latest,GITHUB_CLIENT_SECRET=github-client-secret:latest,VITE_GITHUB_CLIENT_ID=github-client-id:latest,GITHUB_APP_ID=github-app-id:latest,GITHUB_APP_CLIENT_ID=github-app-client-id:latest,GITHUB_APP_CLIENT_SECRET=github-app-client-secret:latest,GITHUB_APP_PRIVATE_KEY=github-app-private-key:latest,GITHUB_APP_WEBHOOK_SECRET=github-app-webhook-secret:latest,GITHUB_APP_SLUG=github-app-slug:latest"

if [ $? -eq 0 ]; then
    echo -e "${GREEN}✅ Cloud Run deployment successful${NC}"
else
    echo -e "${RED}❌ Cloud Run deployment failed${NC}"
    exit 1
fi

# Get service URL
echo -e "${YELLOW}🌐 Getting service URL...${NC}"
SERVICE_URL=$(gcloud run services describe $SERVICE_NAME --region $REGION --format="value(status.url)" 2>/dev/null || echo "")

if [ -z "$SERVICE_URL" ]; then
    echo -e "${RED}❌ Could not retrieve service URL${NC}"
    SERVICE_URL="https://${SERVICE_NAME}-${PROJECT_NUMBER}.a.run.app"
    echo -e "${YELLOW}   Expected URL: ${SERVICE_URL}${NC}"
else
    echo -e "${GREEN}✅ Service URL retrieved${NC}"
fi

# Test deployment
echo -e "${YELLOW}🔍 Testing deployment...${NC}"
sleep 10  # Give service time to start

if curl -s --max-time 30 "${SERVICE_URL}/health" | grep -q "healthy"; then
    echo -e "${GREEN}✅ Health check passed${NC}"
else
    echo -e "${YELLOW}⚠️  Health check failed or timed out${NC}"
    echo -e "${YELLOW}   Service may still be starting up${NC}"
fi

# Run basic tests
echo -e "${YELLOW}🧪 Running basic integration tests...${NC}"

# Test OAuth endpoint
if curl -s --max-time 15 "${SERVICE_URL}/api/github/oauth/client-id" | grep -q "clientId\|configured"; then
    echo -e "   ✅ OAuth endpoint responding"
else
    echo -e "${YELLOW}   ⚠️  OAuth endpoint test inconclusive${NC}"
fi

# Test static assets
if curl -s --max-time 15 "${SERVICE_URL}/" | grep -q "<html\|<!DOCTYPE"; then
    echo -e "   ✅ Frontend serving correctly"
else
    echo -e "${YELLOW}   ⚠️  Frontend test inconclusive${NC}"
fi

# Deployment summary
echo ""
echo -e "${BOLD}${GREEN}🎉 PRODUCTION DEPLOYMENT COMPLETE!${NC}"
echo -e "${GREEN}=====================================${NC}"
echo ""
echo -e "${BLUE}📊 Deployment Summary:${NC}"
echo -e "   Service: ${BOLD}${SERVICE_NAME}${NC}"
echo -e "   URL: ${BOLD}${GREEN}${SERVICE_URL}${NC}"
echo -e "   Region: ${BOLD}${REGION}${NC}"
echo -e "   Build Method: ${BOLD}${GREEN}Local Docker + Cloud Deploy${NC}"
echo -e "   Environment: ${BOLD}${RED}PRODUCTION${NC}"
echo ""
echo -e "${BLUE}🔗 Useful Links:${NC}"
echo -e "   🌐 Application: ${SERVICE_URL}"
echo -e "   💚 Health Check: ${SERVICE_URL}/health"
echo -e "   🔐 OAuth Check: ${SERVICE_URL}/api/github/oauth/client-id"
echo -e "   📊 Cloud Console: https://console.cloud.google.com/run/detail/${REGION}/${SERVICE_NAME}/metrics?project=${PROJECT_ID}"
echo ""
echo -e "${BLUE}📋 Management Commands:${NC}"
echo -e "   View logs: ${BOLD}gcloud logs tail --filter=\"resource.type=cloud_run_revision AND resource.labels.service_name=${SERVICE_NAME}\"${NC}"
echo -e "   Scale service: ${BOLD}gcloud run services update ${SERVICE_NAME} --max-instances=20 --region=${REGION}${NC}"
echo -e "   View service: ${BOLD}gcloud run services describe ${SERVICE_NAME} --region=${REGION}${NC}"
echo ""
echo -e "${GREEN}✨ Production deployed from local build! ✨${NC}"
echo ""
echo -e "${GREEN}Deployment completed at: $(date)${NC}"
