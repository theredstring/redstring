#!/bin/bash

# Quick deployment script for Redstring UI React
# Usage: ./deploy.sh [prod|test] [project-id]

set -e

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# Configuration
ENVIRONMENT=${1:-"prod"}
PROJECT_ID=${2:-$(gcloud config get-value project 2>/dev/null)}
REGION=${3:-"us-central1"}

if [ -z "$PROJECT_ID" ]; then
    echo "❌ No project ID specified and no default project set"
    echo "Usage: $0 [prod|test] [project-id] [region]"
    exit 1
fi

echo -e "${BLUE}🚀 Deploying Redstring UI React${NC}"
echo -e "${BLUE}Environment: ${ENVIRONMENT}${NC}"
echo -e "${BLUE}Project: ${PROJECT_ID}${NC}"
echo -e "${BLUE}Region: ${REGION}${NC}"
echo ""

# Set project
gcloud config set project $PROJECT_ID

if [ "$ENVIRONMENT" = "prod" ]; then
    echo -e "${YELLOW}🏭 Deploying to PRODUCTION${NC}"
    
    # Submit build for production
    gcloud builds submit \
        --config cloudbuild.yaml \
        --substitutions _REGION=$REGION,_GITHUB_CLIENT_ID=placeholder \
        .
    
    echo -e "${GREEN}✅ Production deployment initiated!${NC}"
    echo -e "${GREEN}Check status: gcloud builds list --limit=5${NC}"
    echo -e "${GREEN}Deployment initiated at: $(date)${NC}"
    
elif [ "$ENVIRONMENT" = "test" ]; then
    echo -e "${YELLOW}🧪 Deploying to TEST${NC}"
    
    # Submit build for test
    gcloud builds submit \
        --config cloudbuild-test.yaml \
        --substitutions _REGION=$REGION,_TEST_GITHUB_CLIENT_ID=placeholder \
        .
    
    echo -e "${GREEN}✅ Test deployment initiated!${NC}"
    echo -e "${GREEN}Check status: gcloud builds list --limit=5${NC}"
    echo -e "${GREEN}Deployment initiated at: $(date)${NC}"
    
else
    echo "❌ Invalid environment. Use 'prod' or 'test'"
    exit 1
fi

echo ""
echo -e "${BLUE}📊 Monitor deployment:${NC}"
echo "gcloud builds log \$(gcloud builds list --limit=1 --format='value(id)')"
echo ""
echo -e "${BLUE}🌐 Once deployed, access your app at:${NC}"
if [ "$ENVIRONMENT" = "prod" ]; then
    echo -e "${GREEN}https://your-service-name-\$(gcloud projects describe $PROJECT_ID --format='value(projectNumber)').a.run.app${NC}"
else
    echo -e "${GREEN}https://redstring-test-\$(gcloud projects describe $PROJECT_ID --format='value(projectNumber)').a.run.app${NC}"
fi