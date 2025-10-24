# 🚀 Google Cloud Platform Deployment

Deploy Redstring UI React to Google Cloud using Cloud Build and Cloud Run.

## Quick Start

### 1. Prerequisites
- Google Cloud account with billing enabled
- `gcloud` CLI installed and authenticated
- GitHub repository connected to Cloud Build

### 2. One-Command Setup
```bash
# Run the setup script (replace with your project ID)
./deployment/gcp/setup.sh your-project-id us-central1
```

### 3. Manual Setup (Alternative)

#### Create GCP Project
```bash
# Create project
gcloud projects create your-project-id
gcloud config set project your-project-id

# Enable billing (do this in console)
# https://console.cloud.google.com/billing
```

#### Enable APIs
```bash
gcloud services enable \
    cloudbuild.googleapis.com \
    run.googleapis.com \
    containerregistry.googleapis.com \
    secretmanager.googleapis.com
```

#### Create Secrets
```bash
# Production secrets
echo 'your-github-client-id' | gcloud secrets create github-client-id --data-file=-
echo 'your-github-client-secret' | gcloud secrets create github-client-secret --data-file=-

# Test secrets
echo 'your-test-client-id' | gcloud secrets create github-client-id-test --data-file=-
echo 'your-test-client-secret' | gcloud secrets create github-client-secret-test --data-file=-
```

#### Create Build Triggers
```bash
# Production trigger (main branch)
gcloud builds triggers create github \
    --repo-name="redstringuireact" \
    --repo-owner="yourusername" \
    --branch-pattern="^main$" \
    --build-config="cloudbuild.yaml" \
    --name="your-service-name-deploy"

# Test trigger (develop branch)  
gcloud builds triggers create github \
    --repo-name="redstringuireact" \
    --repo-owner="yourusername" \
    --branch-pattern="^develop$" \
    --build-config="cloudbuild-test.yaml" \
    --name="redstring-test-deploy"
```

## Deployment Environments

### Production
- **Branch**: `main`
- **Service**: `your-service-name`
- **URL**: `https://your-service-name-PROJECT_NUMBER.a.run.app`
- **Resources**: 1 CPU, 1Gi RAM, max 10 instances
- **Secrets**: `github-client-id`, `github-client-secret`

### Test
- **Branch**: `develop`
- **Service**: `redstring-test` 
- **URL**: `https://redstring-test-PROJECT_NUMBER.a.run.app`
- **Resources**: 0.5 CPU, 512Mi RAM, max 3 instances
- **Secrets**: `github-client-id-test`, `github-client-secret-test`

## GitHub OAuth App Setup

### Production App
1. Go to https://github.com/settings/developers
2. Create "Redstring UI React - Production"
3. Set callback URL: `https://your-service-name-PROJECT_NUMBER.a.run.app/oauth/callback`
4. Update secret: `echo 'real-client-id' | gcloud secrets versions add github-client-id --data-file=-`

### Test App
1. Create "Redstring UI React - Test"
2. Set callback URL: `https://redstring-test-PROJECT_NUMBER.a.run.app/oauth/callback`  
3. Update secret: `echo 'test-client-id' | gcloud secrets versions add github-client-id-test --data-file=-`

## Deployment Process

### Automatic Deployment
1. Push to `main` branch → triggers production deployment
2. Push to `develop` branch → triggers test deployment
3. Cloud Build runs, builds Docker image, deploys to Cloud Run

### Manual Deployment
```bash
# Submit build manually
gcloud builds submit --config cloudbuild.yaml

# Deploy specific image
gcloud run deploy your-service-name \
    --image gcr.io/PROJECT_ID/redstring-app:latest \
    --region us-central1
```

## Monitoring & Management

### View Services
```bash
# List Cloud Run services
gcloud run services list

# Get service details
gcloud run services describe your-service-name --region us-central1

# View logs
gcloud logs tail --follow --filter="resource.type=cloud_run_revision"
```

### Update Environment Variables
```bash
# Update environment variable
gcloud run services update your-service-name \
    --set-env-vars "NEW_VAR=value" \
    --region us-central1

# Update secrets
echo 'new-secret-value' | gcloud secrets versions add github-client-secret --data-file=-
```

### Scaling
```bash
# Update scaling settings
gcloud run services update your-service-name \
    --max-instances 20 \
    --min-instances 1 \
    --region us-central1
```

## Cost Management

### Estimated Costs (per month)
- **Test Environment**: ~$5-15/month (minimal traffic)
- **Production Environment**: ~$20-50/month (moderate traffic)
- **Build costs**: ~$1-5/month (based on frequency)

### Cost Optimization
- Use minimum instances = 0 for test environment
- Set appropriate max instances based on expected traffic
- Monitor usage in Cloud Console

## Security

### IAM & Permissions
- Cloud Build service account has minimal required permissions
- Secrets stored in Secret Manager, not environment variables
- HTTPS termination handled by Cloud Run

### Network Security
- All traffic encrypted in transit
- Private container registry
- VPC connectors available for database connections

## Troubleshooting

### Build Failures
```bash
# View build logs
gcloud builds log BUILD_ID

# List recent builds
gcloud builds list --limit=10

# Debug build locally
cloud-build-local --config=cloudbuild.yaml .
```

### Service Issues
```bash
# Check service health
curl https://your-service-name-PROJECT_NUMBER.a.run.app/health

# View service logs
gcloud logs read --filter="resource.type=cloud_run_revision AND resource.labels.service_name=your-service-name" --limit=50

# Check service status
gcloud run services describe your-service-name --region us-central1
```

### Common Issues
1. **Build timeout**: Increase timeout in cloudbuild.yaml
2. **Memory issues**: Increase memory allocation
3. **Secret access**: Check IAM permissions for Cloud Build SA
4. **OAuth callback**: Verify callback URL in GitHub app settings

## Files in this folder

- `setup.sh` - One-command setup script  
- `deploy_prod.sh` - Production deployment script
- `deploy_test.sh` - Test deployment script
- `deploy.sh` - Generic deployment script (legacy)
- `cloud-run.yaml` - Cloud Run service configuration
- `curl-format.txt` - Performance testing format
- `README.md` - This documentation
- `../cloudbuild.yaml` - Production build configuration
- `../cloudbuild-test.yaml` - Test build configuration

## Next Steps

1. Run setup script
2. Connect GitHub repository to Cloud Build
3. Update OAuth app callback URLs
4. Push to main branch
5. Visit your deployed app! 🎉