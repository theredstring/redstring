# Local Docker Build Setup

Fast local testing with Docker instead of Cloud Build delays.

## Quick Setup

### 1. Configure Docker for GCR
```bash
# Configure Docker to use gcloud credentials
gcloud auth configure-docker
```

### 2. Create Dev GitHub Apps

**Dev OAuth App:**
- Authorization callback URL: `https://redstring-test-umk552kp4q-uc.a.run.app/oauth/callback`
- Save Client ID/Secret as: `GITHUB_CLIENT_ID_DEV`, `GITHUB_CLIENT_SECRET_DEV`

**Dev GitHub App:**
- Homepage URL: `https://redstring-test-umk552kp4q-uc.a.run.app/`
- User authorization callback URL: `https://redstring-test-umk552kp4q-uc.a.run.app/oauth/callback`
- Webhook URL: `https://redstring-test-umk552kp4q-uc.a.run.app/api/github/app/webhook`
- Save as: `GITHUB_APP_ID_DEV`, `GITHUB_APP_PRIVATE_KEY_DEV`, `GITHUB_APP_SLUG_DEV`

### 3. Store Dev Secrets in Google Secret Manager
```bash
# OAuth App secrets
echo "your-dev-oauth-client-id" | gcloud secrets create github-client-id-dev --data-file=-
echo "your-dev-oauth-client-secret" | gcloud secrets create github-client-secret-dev --data-file=-

# GitHub App secrets  
echo "your-dev-app-id" | gcloud secrets create github-app-id-dev --data-file=-
gcloud secrets create github-app-private-key-dev --data-file=path/to/dev-app-private-key.pem
echo "redstring-semantic-sync-dev" | gcloud secrets create github-app-slug-dev --data-file=-
```

### 4. Update Deployment Script
Add dev secrets to `scripts/local-build.sh`:
```bash
--set-secrets "GITHUB_CLIENT_ID_DEV=github-client-id-dev:latest,GITHUB_CLIENT_SECRET_DEV=github-client-secret-dev:latest,GITHUB_APP_ID_DEV=github-app-id-dev:latest,GITHUB_APP_PRIVATE_KEY_DEV=github-app-private-key-dev:latest,GITHUB_APP_SLUG_DEV=github-app-slug-dev:latest,GITHUB_CLIENT_ID=github-client-id:latest,GITHUB_CLIENT_SECRET=github-client-secret:latest,GITHUB_APP_ID=github-app-id:latest,GITHUB_APP_PRIVATE_KEY=github-app-private-key:latest"
```

### 5. Local Build & Deploy
```bash
# Fast local build and deploy (30 seconds vs 5+ minutes)
./scripts/local-build.sh
```

## Benefits

✅ **Speed**: 30 seconds vs 5+ minutes with Cloud Build  
✅ **M4 MacBook**: Native ARM64 builds  
✅ **Dev/Prod Separation**: Different GitHub Apps for testing  
✅ **Same Infrastructure**: Uses Cloud Run, just faster builds  

## Workflow

1. Make code changes
2. Run `./scripts/local-build.sh` 
3. Test at `https://redstring-test-umk552kp4q-uc.a.run.app`
4. Deploy to prod when ready

## Auto-Selection Logic

The OAuth server automatically detects the environment:
- **Production**: Uses `GITHUB_CLIENT_ID`, `GITHUB_APP_ID` etc.
- **Test/Dev**: Uses `GITHUB_CLIENT_ID_DEV`, `GITHUB_APP_ID_DEV` etc.

This happens based on the request host/origin, so your test deployment automatically uses dev credentials while prod uses prod credentials.
