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

# Production Deployment Script for Redstring UI React
# Deploys to Google Cloud Run production environment

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
SERVICE_NAME="your-service-name"

# Header
echo -e "${BOLD}${BLUE}🏭 Redstring UI React - PRODUCTION DEPLOYMENT${NC}"
echo -e "${BLUE}================================================${NC}"
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
    "cloudbuild.googleapis.com"
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

# Check if build config exists
if [ ! -f "cloudbuild.yaml" ]; then
    echo -e "${RED}❌ cloudbuild.yaml not found${NC}"
    exit 1
fi
echo -e "   ✅ cloudbuild.yaml found"

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
echo -e "${BOLD}${BLUE}🚀 Starting Production Deployment...${NC}"
echo ""

# Submit build
echo -e "${YELLOW}📦 Submitting build to Cloud Build...${NC}"
BUILD_ID=$(gcloud builds submit \
    --config cloudbuild.yaml \
    --substitutions _REGION=$REGION \
    --format="value(id)" \
    .)

if [ -z "$BUILD_ID" ]; then
    echo -e "${RED}❌ Failed to submit build${NC}"
    exit 1
fi

echo -e "${GREEN}✅ Build submitted successfully${NC}"
echo -e "${BLUE}   Build ID: ${BUILD_ID}${NC}"
echo -e "${BLUE}   View logs: gcloud builds log ${BUILD_ID}${NC}"
echo ""

# Wait for build to complete
echo -e "${YELLOW}⏳ Waiting for build to complete...${NC}"
gcloud builds log $BUILD_ID --stream

# Check build status
BUILD_STATUS=$(gcloud builds describe $BUILD_ID --format="value(status)")

if [ "$BUILD_STATUS" = "SUCCESS" ]; then
    echo -e "${GREEN}✅ Build completed successfully${NC}"
else
    echo -e "${RED}❌ Build failed with status: ${BUILD_STATUS}${NC}"
    echo -e "${YELLOW}💡 Check build logs: gcloud builds log ${BUILD_ID}${NC}"
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

# Deployment summary
echo ""
echo -e "${BOLD}${GREEN}🎉 PRODUCTION DEPLOYMENT COMPLETE!${NC}"
echo -e "${GREEN}=================================${NC}"
echo ""
echo -e "${BLUE}📊 Deployment Summary:${NC}"
echo -e "   Service: ${BOLD}${SERVICE_NAME}${NC}"
echo -e "   URL: ${BOLD}${GREEN}${SERVICE_URL}${NC}"
echo -e "   Region: ${BOLD}${REGION}${NC}"
echo -e "   Build ID: ${BOLD}${BUILD_ID}${NC}"
echo ""
echo -e "${BLUE}🔗 Useful Links:${NC}"
echo -e "   🌐 Application: ${SERVICE_URL}"
echo -e "   💚 Health Check: ${SERVICE_URL}/health"
echo -e "   📊 Cloud Console: https://console.cloud.google.com/run/detail/${REGION}/${SERVICE_NAME}/metrics?project=${PROJECT_ID}"
echo -e "   📋 Build Logs: https://console.cloud.google.com/cloud-build/builds/${BUILD_ID}?project=${PROJECT_ID}"
echo ""
echo -e "${BLUE}📋 Management Commands:${NC}"
echo -e "   View logs: ${BOLD}gcloud logs tail --filter=\"resource.type=cloud_run_revision AND resource.labels.service_name=${SERVICE_NAME}\"${NC}"
echo -e "   Scale service: ${BOLD}gcloud run services update ${SERVICE_NAME} --max-instances=20 --region=${REGION}${NC}"
echo -e "   View service: ${BOLD}gcloud run services describe ${SERVICE_NAME} --region=${REGION}${NC}"
echo ""
echo -e "${GREEN}✨ Your Redstring app is now live in production! ✨${NC}"
echo ""
echo -e "${GREEN}Deployment completed at: $(date)${NC}"