#!/bin/bash

# Fix Artifact Registry permissions for Redstring deployment
# This script creates the repository if needed and grants necessary permissions

set -e

PROJECT_ID="redstring-470201"
REGION="us"
REPO_NAME="gcr.io"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
BOLD='\033[1m'
NC='\033[0m' # No Color

echo -e "${BOLD}${BLUE}🔧 Artifact Registry Setup${NC}"
echo -e "${BLUE}============================${NC}"
echo ""

# Check if repository exists
echo -e "${BLUE}📦 Checking Artifact Registry repository...${NC}"
if gcloud artifacts repositories describe ${REPO_NAME} \
    --location=${REGION} \
    --project=${PROJECT_ID} &>/dev/null; then
    echo -e "${GREEN}✅ Repository ${REPO_NAME} already exists${NC}"
else
    echo -e "${YELLOW}📦 Creating Artifact Registry repository...${NC}"
    gcloud artifacts repositories create ${REPO_NAME} \
        --repository-format=docker \
        --location=${REGION} \
        --project=${PROJECT_ID} \
        --description="Docker images for Redstring" || {
        echo -e "${RED}❌ Failed to create repository${NC}"
        exit 1
    }
    echo -e "${GREEN}✅ Repository created${NC}"
fi

# Grant permissions to Cloud Build service account
CLOUD_BUILD_SA="${PROJECT_ID}@cloudbuild.gserviceaccount.com"
echo ""
echo -e "${BLUE}🔐 Granting permissions to Cloud Build service account...${NC}"
echo -e "${BLUE}   Service Account: ${CLOUD_BUILD_SA}${NC}"

gcloud artifacts repositories add-iam-policy-binding ${REPO_NAME} \
    --location=${REGION} \
    --member="serviceAccount:${CLOUD_BUILD_SA}" \
    --role="roles/artifactregistry.writer" \
    --project=${PROJECT_ID} || {
    echo -e "${RED}❌ Failed to grant permissions${NC}"
    exit 1
}

echo -e "${GREEN}✅ Permissions granted${NC}"

# Verify setup
echo ""
echo -e "${BLUE}🔍 Verifying setup...${NC}"
echo ""
echo -e "${BLUE}Repository details:${NC}"
gcloud artifacts repositories describe ${REPO_NAME} \
    --location=${REGION} \
    --project=${PROJECT_ID} \
    --format="table(name,format,location,createTime)"

echo ""
echo -e "${BOLD}${GREEN}🎉 Artifact Registry setup complete!${NC}"
echo ""
echo -e "${BLUE}You can now run your deployment scripts.${NC}"





