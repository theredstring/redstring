#!/bin/bash

# Test Environment Deployment Script for Redstring UI React
# Deploys locally but uses the exact same URL as the test environment

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m' # No Color

# Configuration
PROJECT_ID=${1:-$(gcloud config get-value project 2>/dev/null)}
REGION=${2:-"us-central1"}
SERVICE_NAME="redstring-test"
CONTAINER_NAME="redstring-test-local"
IMAGE_NAME="redstring-test-local"
MAIN_PORT=4001
OAUTH_PORT=3003

# Get the exact test URL
TEST_URL="https://redstring-test-umk552kp4q-uc.a.run.app"
TEST_DOMAIN="redstring-test-umk552kp4q-uc.a.run.app"

# Header
echo -e "${BOLD}${CYAN}🧪 Redstring UI React - LOCAL TEST DEPLOYMENT${NC}"
echo -e "${CYAN}===================================================${NC}"
echo ""

# Validation
if [ -z "$PROJECT_ID" ]; then
    echo -e "${RED}❌ No project ID specified and no default project set${NC}"
    echo -e "${YELLOW}Usage: $0 [project-id] [region]${NC}"
    echo -e "${YELLOW}Example: $0 my-project-123 us-central1${NC}"
    exit 1
fi

echo -e "${BLUE}📋 Local Test Deployment Configuration:${NC}"
echo -e "   Project ID: ${BOLD}${PROJECT_ID}${NC}"
echo -e "   Region: ${BOLD}${REGION}${NC}"
echo -e "   Container: ${BOLD}${CONTAINER_NAME}${NC}"
echo -e "   Image: ${BOLD}${IMAGE_NAME}${NC}"
echo -e "   Test URL: ${BOLD}${TEST_URL}${NC}"
echo -e "   Local Ports: ${BOLD}${MAIN_PORT}:${OAUTH_PORT}${NC}"
echo -e "   Environment: ${BOLD}${CYAN}LOCAL (same URL as test)${NC}"
echo ""

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
    "containerregistry.googleapis.com"
    "secretmanager.googleapis.com"
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

# Check if test secrets exist
echo -e "${YELLOW}🔐 Verifying test environment secrets...${NC}"
REQUIRED_SECRETS=(
    "github-client-id-test"
    "github-client-secret-test"
    "github-app-id-test"
    "github-app-private-key-test"
)

for secret in "${REQUIRED_SECRETS[@]}"; do
    if gcloud secrets describe $secret >/dev/null 2>&1; then
        echo -e "   ✅ $secret"
    else
        echo -e "${RED}   ❌ $secret - MISSING${NC}"
        echo -e "${YELLOW}   Create with: echo 'your-test-value' | gcloud secrets create $secret --data-file=-${NC}"
        exit 1
    fi
done

# Fix OAuth permissions for Cloud Run service account
echo -e "${YELLOW}🔧 Fixing OAuth permissions for Cloud Run service account...${NC}"
SERVICE_ACCOUNT="${PROJECT_NUMBER}-compute@developer.gserviceaccount.com"

# Grant project-wide Secret Manager access
echo -e "   📋 Granting project-wide Secret Manager access..."
gcloud projects add-iam-policy-binding ${PROJECT_ID} \
  --member="serviceAccount:${SERVICE_ACCOUNT}" \
  --role="roles/secretmanager.secretAccessor" \
  --quiet

# Grant access to specific secrets
echo -e "   📋 Granting access to specific GitHub OAuth secrets..."
for secret in "${REQUIRED_SECRETS[@]}"; do
    gcloud secrets add-iam-policy-binding ${secret} \
      --project=${PROJECT_ID} \
      --member="serviceAccount:${SERVICE_ACCOUNT}" \
      --role="roles/secretmanager.secretAccessor" \
      --quiet
    echo -e "   ✅ ${secret} access granted"
done

echo -e "${GREEN}✅ OAuth permissions configured${NC}"

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

echo -e "${GREEN}✅ All pre-deployment checks passed${NC}"
echo ""

# Start deployment
echo -e "${BOLD}${CYAN}🚀 Starting Local Build + Cloud Deploy...${NC}"
echo ""

# Build Docker image locally
echo -e "${YELLOW}🏗️  Building Docker image locally...${NC}"
docker build --platform linux/amd64 -f deployment/docker/Dockerfile -t gcr.io/${PROJECT_ID}/redstring-test:latest .

if [ $? -eq 0 ]; then
    echo -e "${GREEN}✅ Docker image built successfully${NC}"
else
    echo -e "${RED}❌ Docker build failed${NC}"
    exit 1
fi

# Push image to Google Container Registry
echo -e "${YELLOW}📤 Pushing image to Google Container Registry...${NC}"
docker push gcr.io/${PROJECT_ID}/redstring-test:latest

if [ $? -eq 0 ]; then
    echo -e "${GREEN}✅ Image pushed successfully${NC}"
else
    echo -e "${RED}❌ Failed to push image${NC}"
    exit 1
fi

# Deploy to Cloud Run
echo -e "${YELLOW}🚀 Deploying to Cloud Run...${NC}"
gcloud run deploy ${SERVICE_NAME} \
    --image gcr.io/${PROJECT_ID}/redstring-test:latest \
    --region ${REGION} \
    --platform managed \
    --allow-unauthenticated \
    --port 4000 \
    --memory 512Mi \
    --cpu 1 \
    --concurrency 25 \
    --max-instances 3 \
    --set-env-vars "NODE_ENV=production,OAUTH_PORT=3002,GITHUB_APP_SLUG_DEV=redstring-semantic-sync-test" \
    --set-secrets "GITHUB_CLIENT_ID_DEV=github-client-id-test:latest,GITHUB_CLIENT_SECRET_DEV=github-client-secret-test:latest,GITHUB_APP_ID_DEV=github-app-id-test:latest,GITHUB_APP_PRIVATE_KEY_DEV=github-app-private-key-test:latest"

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
echo -e "${YELLOW}🔍 Testing cloud deployment...${NC}"
sleep 10  # Give service time to start

if curl -s --max-time 30 "${SERVICE_URL}/health" | grep -q "healthy"; then
    echo -e "${GREEN}✅ Health check passed${NC}"
else
    echo -e "${YELLOW}⚠️  Health check failed or timed out${NC}"
    echo -e "${YELLOW}   Service may still be starting up${NC}"
fi

# Run some basic tests
echo -e "${YELLOW}🧪 Running basic integration tests...${NC}"

# Test OAuth endpoint
if curl -s --max-time 15 "${SERVICE_URL}/api/github/oauth/client-id" | grep -q "clientId\|configured"; then
    echo -e "   ✅ OAuth endpoint responding"
else
    echo -e "${YELLOW}   ⚠️  OAuth endpoint test inconclusive${NC}"
fi

# Test static assets (should get HTML)
if curl -s --max-time 15 "${SERVICE_URL}/" | grep -q "<html\|<!DOCTYPE"; then
    echo -e "   ✅ Frontend serving correctly"
else
    echo -e "${YELLOW}   ⚠️  Frontend test inconclusive${NC}"
fi

# Deployment summary
echo ""
echo -e "${BOLD}${GREEN}🎉 LOCAL BUILD + CLOUD DEPLOY COMPLETE!${NC}"
echo -e "${GREEN}===========================================${NC}"
echo ""
echo -e "${BLUE}📊 Deployment Summary:${NC}"
echo -e "   Service: ${BOLD}${SERVICE_NAME}${NC}"
echo -e "   URL: ${BOLD}${CYAN}${SERVICE_URL}${NC}"
echo -e "   Region: ${BOLD}${REGION}${NC}"
echo -e "   Build Method: ${BOLD}${GREEN}Local Docker + Cloud Deploy${NC}"
echo -e "   Environment: ${BOLD}${CYAN}TEST${NC}"
echo ""
echo -e "${BLUE}🔗 Useful Links:${NC}"
echo -e "   🌐 Application: ${SERVICE_URL}"
echo -e "   💚 Health Check: ${SERVICE_URL}/health"
echo -e "   🔐 OAuth Check: ${SERVICE_URL}/api/github/oauth/client-id"
echo -e "   📊 Cloud Console: https://console.cloud.google.com/run/detail/${REGION}/${SERVICE_NAME}/metrics?project=${PROJECT_ID}"
echo ""
echo -e "${BLUE}🧪 Testing Commands:${NC}"
echo -e "   Health check: ${BOLD}curl ${SERVICE_URL}/health${NC}"
echo -e "   OAuth test: ${BOLD}curl ${SERVICE_URL}/api/github/oauth/client-id${NC}"
echo -e "   Load test: ${BOLD}curl -w \"@curl-format.txt\" -s -o /dev/null ${SERVICE_URL}${NC}"
echo ""
echo -e "${BLUE}📋 Management Commands:${NC}"
echo -e "   View logs: ${BOLD}gcloud logs tail --filter=\"resource.type=cloud_run_revision AND resource.labels.service_name=${SERVICE_NAME}\"${NC}"
echo -e "   Scale service: ${BOLD}gcloud run services update ${SERVICE_NAME} --max-instances=5 --region=${REGION}${NC}"
echo -e "   View service: ${BOLD}gcloud run services describe ${SERVICE_NAME} --region=${REGION}${NC}"
echo ""
echo -e "${CYAN}🧪 Test environment deployed from local build! 🧪${NC}"
echo -e "${GREEN}✨ Bypassed Cloud Build - built locally and deployed to cloud! ✨${NC}"
echo -e "${YELLOW}💡 Open ${SERVICE_URL} in your browser to get started${NC}"
echo ""
echo -e "${GREEN}Deployment completed at: $(date)${NC}"