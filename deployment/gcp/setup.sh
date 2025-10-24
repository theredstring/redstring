#!/bin/bash

# Google Cloud Platform Setup Script for Redstring UI React
# Run this after setting up your GCP project

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
PROJECT_ID=${1:-"your-project-id"}
REGION=${2:-"us-central1"}

echo -e "${BLUE}🚀 Setting up Redstring UI React on Google Cloud Platform${NC}"
echo -e "${BLUE}Project: ${PROJECT_ID}${NC}"
echo -e "${BLUE}Region: ${REGION}${NC}"
echo ""

# Check if gcloud is installed
if ! command -v gcloud &> /dev/null; then
    echo -e "${RED}❌ gcloud CLI not found. Please install it first.${NC}"
    echo "https://cloud.google.com/sdk/docs/install"
    exit 1
fi

# Set project
echo -e "${YELLOW}📋 Setting project...${NC}"
gcloud config set project $PROJECT_ID

# Enable required APIs
echo -e "${YELLOW}🔧 Enabling required APIs...${NC}"
gcloud services enable \
    cloudbuild.googleapis.com \
    run.googleapis.com \
    containerregistry.googleapis.com \
    secretmanager.googleapis.com \
    logging.googleapis.com \
    monitoring.googleapis.com

# Create build logs bucket
echo -e "${YELLOW}🪣 Creating build logs bucket...${NC}"
gsutil mb -p $PROJECT_ID gs://${PROJECT_ID}-build-logs || echo "Bucket might already exist"

# Create secrets (you'll need to add the actual values)
echo -e "${YELLOW}🔐 Creating Secret Manager secrets...${NC}"

# Production secrets
gcloud secrets create github-client-id --data-file=- <<< "your-production-github-client-id"
gcloud secrets create github-client-secret --data-file=- <<< "your-production-github-client-secret"

# Test secrets  
gcloud secrets create github-client-id-test --data-file=- <<< "your-test-github-client-id"
gcloud secrets create github-client-secret-test --data-file=- <<< "your-test-github-client-secret"

echo -e "${RED}⚠️  Remember to update the secret values with your actual GitHub OAuth credentials:${NC}"
echo "gcloud secrets versions add github-client-id --data-file=-"
echo "gcloud secrets versions add github-client-secret --data-file=-"

# Grant Cloud Build access to secrets
echo -e "${YELLOW}🔑 Granting Cloud Build access to secrets...${NC}"
PROJECT_NUMBER=$(gcloud projects describe $PROJECT_ID --format="value(projectNumber)")
CLOUD_BUILD_SA="${PROJECT_NUMBER}@cloudbuild.gserviceaccount.com"

gcloud secrets add-iam-policy-binding github-client-id \
    --member="serviceAccount:${CLOUD_BUILD_SA}" \
    --role="roles/secretmanager.secretAccessor"

gcloud secrets add-iam-policy-binding github-client-secret \
    --member="serviceAccount:${CLOUD_BUILD_SA}" \
    --role="roles/secretmanager.secretAccessor"

gcloud secrets add-iam-policy-binding github-client-id-test \
    --member="serviceAccount:${CLOUD_BUILD_SA}" \
    --role="roles/secretmanager.secretAccessor"

gcloud secrets add-iam-policy-binding github-client-secret-test \
    --member="serviceAccount:${CLOUD_BUILD_SA}" \
    --role="roles/secretmanager.secretAccessor"

# Grant Cloud Build permissions for Cloud Run
echo -e "${YELLOW}🏃 Granting Cloud Build permissions for Cloud Run...${NC}"
gcloud projects add-iam-policy-binding $PROJECT_ID \
    --member="serviceAccount:${CLOUD_BUILD_SA}" \
    --role="roles/run.admin"

gcloud projects add-iam-policy-binding $PROJECT_ID \
    --member="serviceAccount:${CLOUD_BUILD_SA}" \
    --role="roles/iam.serviceAccountUser"

# Create Cloud Build trigger for production (main branch)
echo -e "${YELLOW}🔄 Creating Cloud Build trigger for production...${NC}"
gcloud builds triggers create github \
    --repo-name="redstringuireact" \
    --repo-owner="yourusername" \
    --branch-pattern="^main$" \
    --build-config="cloudbuild.yaml" \
    --description="Redstring Production Deploy" \
    --name="your-service-name-deploy" \
    --substitutions="_REGION=${REGION},_GITHUB_CLIENT_ID=your-prod-client-id"

# Create Cloud Build trigger for test (develop branch)
echo -e "${YELLOW}🧪 Creating Cloud Build trigger for test...${NC}"
gcloud builds triggers create github \
    --repo-name="redstringuireact" \
    --repo-owner="yourusername" \
    --branch-pattern="^develop$" \
    --build-config="cloudbuild-test.yaml" \
    --description="Redstring Test Deploy" \
    --name="redstring-test-deploy" \
    --substitutions="_REGION=${REGION},_TEST_GITHUB_CLIENT_ID=your-test-client-id"

echo ""
echo -e "${GREEN}✅ Setup complete!${NC}"
echo ""
echo -e "${BLUE}📋 Next steps:${NC}"
echo "1. Update your GitHub OAuth app callback URLs:"
echo "   Production: https://your-service-name-PROJECT_NUMBER.a.run.app/oauth/callback"
echo "   Test: https://redstring-test-PROJECT_NUMBER.a.run.app/oauth/callback"
echo ""
echo "2. Update the secret values with your real GitHub OAuth credentials:"
echo "   echo 'your-real-client-id' | gcloud secrets versions add github-client-id --data-file=-"
echo "   echo 'your-real-client-secret' | gcloud secrets versions add github-client-secret --data-file=-"
echo ""
echo "3. Update the build triggers with your GitHub repo details:"
echo "   gcloud builds triggers describe your-service-name-deploy"
echo ""
echo "4. Push to main branch to trigger production deployment!"
echo ""
echo -e "${GREEN}🎉 Your Redstring app will be available at:${NC}"
echo -e "${GREEN}Production: https://your-service-name-${PROJECT_NUMBER}.a.run.app${NC}"
echo -e "${GREEN}Test: https://redstring-test-${PROJECT_NUMBER}.a.run.app${NC}"