# Artifact Registry Permission Fix

## Problem

Error: `Permission "artifactregistry.repositories.uploadArtifacts" denied on resource "projects/redstring-470201/locations/us/repositories/gcr.io"`

This occurs because Google is migrating from Google Container Registry (GCR) to Artifact Registry, and either:
1. The Artifact Registry repository doesn't exist
2. The Cloud Build service account lacks the necessary permissions

## Solution

### Option 1: Create Artifact Registry Repository (Recommended)

If the repository doesn't exist, create it:

```bash
PROJECT_ID="redstring-470201"
REGION="us"

# Create the Artifact Registry repository for Docker images
gcloud artifacts repositories create gcr.io \
    --repository-format=docker \
    --location=${REGION} \
    --project=${PROJECT_ID} \
    --description="Docker images for Redstring"
```

### Option 2: Grant Permissions to Cloud Build Service Account

If the repository exists but permissions are missing:

```bash
PROJECT_ID="redstring-470201"
REGION="us"

# Get the Cloud Build service account email
CLOUD_BUILD_SA="${PROJECT_ID}@cloudbuild.gserviceaccount.com"

# Grant Artifact Registry Writer role
gcloud projects add-iam-policy-binding ${PROJECT_ID} \
    --member="serviceAccount:${CLOUD_BUILD_SA}" \
    --role="roles/artifactregistry.writer"

# Alternatively, grant the specific permission
gcloud artifacts repositories add-iam-policy-binding gcr.io \
    --location=${REGION} \
    --member="serviceAccount:${CLOUD_BUILD_SA}" \
    --role="roles/artifactregistry.writer" \
    --project=${PROJECT_ID}
```

### Option 3: Complete Setup (Repository + Permissions)

Run this complete setup script:

```bash
#!/bin/bash
set -e

PROJECT_ID="redstring-470201"
REGION="us"
REPO_NAME="gcr.io"

echo "🔧 Setting up Artifact Registry for ${PROJECT_ID}..."

# Check if repository exists
if gcloud artifacts repositories describe ${REPO_NAME} \
    --location=${REGION} \
    --project=${PROJECT_ID} &>/dev/null; then
    echo "✅ Repository ${REPO_NAME} already exists"
else
    echo "📦 Creating Artifact Registry repository..."
    gcloud artifacts repositories create ${REPO_NAME} \
        --repository-format=docker \
        --location=${REGION} \
        --project=${PROJECT_ID} \
        --description="Docker images for Redstring"
    echo "✅ Repository created"
fi

# Grant permissions to Cloud Build service account
CLOUD_BUILD_SA="${PROJECT_ID}@cloudbuild.gserviceaccount.com"
echo "🔐 Granting permissions to ${CLOUD_BUILD_SA}..."

gcloud artifacts repositories add-iam-policy-binding ${REPO_NAME} \
    --location=${REGION} \
    --member="serviceAccount:${CLOUD_BUILD_SA}" \
    --role="roles/artifactregistry.writer" \
    --project=${PROJECT_ID}

echo "✅ Permissions granted"
echo "🎉 Artifact Registry setup complete!"
```

### Option 4: Use Artifact Registry Explicitly (Migration)

If you want to migrate fully to Artifact Registry format, update your `cloudbuild.yaml`:

```yaml
# Change from:
- 'gcr.io/$PROJECT_ID/redstring-app:$BUILD_ID'

# To:
- '${REGION}-docker.pkg.dev/$PROJECT_ID/gcr.io/redstring-app:$BUILD_ID'
```

And update deployment scripts to use:
```bash
# Instead of: gcr.io/${PROJECT_ID}/${SERVICE_NAME}:latest
# Use: ${REGION}-docker.pkg.dev/${PROJECT_ID}/gcr.io/${SERVICE_NAME}:latest
```

## Verify Setup

After fixing, verify the setup:

```bash
PROJECT_ID="redstring-470201"
REGION="us"

# List repositories
gcloud artifacts repositories list --location=${REGION} --project=${PROJECT_ID}

# Check IAM policy
gcloud artifacts repositories get-iam-policy gcr.io \
    --location=${REGION} \
    --project=${PROJECT_ID}
```

## Quick Fix Command

Run this one-liner to fix the issue:

```bash
PROJECT_ID="redstring-470201" && \
gcloud artifacts repositories create gcr.io --repository-format=docker --location=us --project=${PROJECT_ID} 2>/dev/null || true && \
gcloud artifacts repositories add-iam-policy-binding gcr.io --location=us --member="serviceAccount:${PROJECT_ID}@cloudbuild.gserviceaccount.com" --role="roles/artifactregistry.writer" --project=${PROJECT_ID}
```











