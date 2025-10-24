#!/bin/bash

# Local Docker Build Script for Redstring
# Fast local testing without Cloud Build delays

set -e

PROJECT_ID="your-project-id"
SERVICE_NAME="redstring-test"
REGION="us-central1"
PORT="8080"

echo "🐳 Starting local Docker build for Redstring..."

# Build the Docker image locally for Cloud Run (amd64)
echo "📦 Building Docker image for Cloud Run (amd64)..."
docker build --platform linux/amd64 -t gcr.io/${PROJECT_ID}/${SERVICE_NAME}:local -f deployment/docker/Dockerfile .

echo "✅ Docker image built successfully"

# Push to Google Container Registry
echo "📤 Pushing to GCR..."
docker push gcr.io/${PROJECT_ID}/${SERVICE_NAME}:local

echo "🚀 Deploying to Cloud Run..."

# Deploy to Cloud Run using the locally built image
gcloud run deploy ${SERVICE_NAME} \
    --image gcr.io/${PROJECT_ID}/${SERVICE_NAME}:local \
    --region ${REGION} \
    --platform managed \
    --allow-unauthenticated \
    --port ${PORT} \
    --memory 4Gi \
    --cpu 2 \
    --concurrency 200 \
    --max-instances 5 \
    --set-env-vars "NODE_ENV=production,VITE_BRIDGE_URL=https://redstring-test-umk552kp4q-uc.a.run.app,VITE_OAUTH_URL=https://redstring-test-umk552kp4q-uc.a.run.app" \
    --set-secrets "GITHUB_CLIENT_ID=github-client-id:latest,GITHUB_CLIENT_SECRET=github-client-secret:latest,GITHUB_APP_ID=github-app-id:latest,GITHUB_APP_PRIVATE_KEY=github-app-private-key:latest,GITHUB_CLIENT_ID_DEV=github-client-id-dev:latest,GITHUB_CLIENT_SECRET_DEV=github-client-secret-dev:latest,GITHUB_APP_ID_DEV=github-app-id-dev:latest,GITHUB_APP_PRIVATE_KEY_DEV=github-app-private-key-dev:latest,GITHUB_APP_SLUG_DEV=github-app-slug-dev:latest" \
    --quiet

echo "✅ Local build and deployment complete!"

# Get the service URL
SERVICE_URL=$(gcloud run services describe ${SERVICE_NAME} --region=${REGION} --format='value(status.url)')
echo "🌐 Service URL: ${SERVICE_URL}"

echo ""
echo "📝 For your dev GitHub App, use these URLs:"
echo "   Homepage URL: ${SERVICE_URL}/"
echo "   OAuth callback: ${SERVICE_URL}/oauth/callback"
echo "   Webhook URL: ${SERVICE_URL}/api/github/app/webhook"
echo ""
echo "⚡ This approach is much faster than Cloud Build!"
