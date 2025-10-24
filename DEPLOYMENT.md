# Redstring Deployment Guide

This guide explains how to deploy Redstring to both **production** and **test** environments on Google Cloud Run.

## Overview

Redstring has two separate deployment environments:

- **Production** (`your-service-name`): Live production environment at `https://redstring.io`
- **Test** (`redstring-test`): Testing/development environment at `https://redstring-test-umk552kp4q-uc.a.run.app`

Each environment uses its own GitHub App and OAuth credentials to ensure complete isolation.

## Quick Deploy

### Production Deployment

```bash
./scripts/fast-deploy-prod.sh
```

**What it does:**
- Builds with production URLs (`https://redstring.io`)
- Uses production GitHub App (`redstring-semantic-sync`)
- Uses production OAuth credentials
- Deploys to `your-service-name` Cloud Run service
- Sets `NODE_ENV=production` and `LOG_LEVEL=warn`

### Test Deployment

```bash
./scripts/fast-deploy-test.sh
```

**What it does:**
- Builds with test URLs (`https://redstring-test-umk552kp4q-uc.a.run.app`)
- Uses test GitHub App (`redstring-semantic-sync-test`)
- Uses test OAuth credentials
- Deploys to `redstring-test` Cloud Run service
- Sets `NODE_ENV=development` and `LOG_LEVEL=info`

## Environment Credentials

### Production (your-service-name)

**GitHub App:**
- App ID: `YOUR_APP_ID`
- App Slug: `redstring-semantic-sync`
- Client ID: `YOUR_CLIENT_ID`

**OAuth:**
- Client ID: `Ov23liYygPgJ9Tzcbvg6`
- Callback: `https://redstring.io/oauth/callback`

**GCP Secrets Used:**
- `github-app-id:latest`
- `github-app-client-id:latest`
- `github-app-client-secret:latest`
- `github-app-private-key:latest`
- `github-app-slug:latest`
- `github-client-id:latest`
- `github-client-secret:latest`

### Test (redstring-test)

**GitHub App:**
- App ID: `YOUR_APP_ID` (same as prod, but different installation)
- App Slug: `redstring-semantic-sync-test`
- Client ID: `YOUR_CLIENT_ID` (same as prod)

**OAuth:**
- Client ID: `Ov23li1dnhS3KhBcHnup`
- Callback: `https://redstring-test-umk552kp4q-uc.a.run.app/oauth/callback`

**GCP Secrets Used:**
- `github-app-id-test:latest`
- `github-app-client-id-test:latest`
- `github-app-client-secret-test:latest`
- `github-app-private-key-test:latest`
- `github-app-slug-test:latest`
- `github-client-id-test:latest`
- `github-client-secret-test:latest`

## How Environment Detection Works

The OAuth server automatically detects which environment it's running in:

```javascript
function isLocalRequest(req) {
  const host = (req.headers['x-forwarded-host'] || req.headers.host || '').toString().toLowerCase();
  // Treat localhost AND redstring-test deployment as dev/test
  return host.includes('localhost') ||
         host.includes('127.0.0.1') ||
         host.includes('redstring-test');
}
```

Based on this detection:
- **Test environment** uses `*-test` secrets and `redstring-semantic-sync-test` app slug
- **Production** uses production secrets and `redstring-semantic-sync` app slug

## Deployment Architecture

### Build Process

1. **Dockerfile Selection:**
   - Production: `deployment/docker/Dockerfile`
   - Test: `deployment/docker/Dockerfile.test`

2. **Build Arguments:**
   - `VITE_BRIDGE_URL`: Base URL for API calls
   - `VITE_OAUTH_URL`: OAuth server URL

3. **Secret Injection:**
   - Secrets are mounted at runtime via Cloud Run
   - No secrets are baked into the Docker image

### Deployment Flow

```
┌─────────────────┐
│  npm run build  │  ← Vite build with environment URLs
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  Docker Build   │  ← Package app + server code
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│   Push to GCR   │  ← Google Container Registry
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  Deploy to Run  │  ← Cloud Run with environment secrets
└─────────────────┘
```

## Testing After Deployment

### Health Check

```bash
# Production
curl https://redstring.io/health

# Test
curl https://redstring-test-umk552kp4q-uc.a.run.app/health
```

### OAuth Configuration

```bash
# Production
curl https://redstring.io/api/github/oauth/client-id

# Test
curl https://redstring-test-umk552kp4q-uc.a.run.app/api/github/oauth/client-id
```

### GitHub App Info

```bash
# Production (should return redstring-semantic-sync)
curl https://redstring.io/api/github/app/info

# Test (should return redstring-semantic-sync-test)
curl https://redstring-test-umk552kp4q-uc.a.run.app/api/github/app/info
```

## Managing Secrets

### View All Secrets

```bash
gcloud secrets list --project=your-project-id | grep github
```

### Update a Secret

```bash
# Example: Update production OAuth client secret
echo -n "NEW_SECRET_VALUE" | gcloud secrets versions add github-client-secret \
  --data-file=- \
  --project=your-project-id
```

### View Secret Value

```bash
# Example: View production GitHub App ID
gcloud secrets versions access latest \
  --secret="github-app-id" \
  --project=your-project-id
```

## Common Issues

### Issue: Wrong GitHub App in Test Environment

**Symptom:** Test deployment redirects to production GitHub App

**Solution:** Verify the test deployment is using the correct secrets:

```bash
gcloud run services describe redstring-test \
  --region=us-central1 \
  --project=your-project-id \
  --format="value(spec.template.spec.containers[0].env)"
```

### Issue: OAuth Callback Not Working

**Symptom:** After GitHub authentication, redirect fails

**Solution:** Verify the callback URLs are correctly configured in GitHub:

- Production: `https://redstring.io/oauth/callback`
- Test: `https://redstring-test-umk552kp4q-uc.a.run.app/oauth/callback`

### Issue: Secrets Not Updated

**Symptom:** Deployment uses old credentials

**Solution:** Cloud Run caches secret versions. Force a new deployment:

```bash
# For production
./scripts/fast-deploy-prod.sh

# For test
./scripts/fast-deploy-test.sh
```

## Monitoring

### View Logs

```bash
# Production logs
gcloud logging read 'resource.type=cloud_run_revision AND resource.labels.service_name=your-service-name' \
  --limit=50 \
  --project=your-project-id

# Test logs
gcloud logging read 'resource.type=cloud_run_revision AND resource.labels.service_name=redstring-test' \
  --limit=50 \
  --project=your-project-id
```

### Service Details

```bash
# Production
gcloud run services describe your-service-name \
  --region=us-central1 \
  --project=your-project-id

# Test
gcloud run services describe redstring-test \
  --region=us-central1 \
  --project=your-project-id
```

## Security Best Practices

1. **Never commit private keys** to the repository
2. **Always use GCP Secret Manager** for sensitive data
3. **Rotate secrets regularly** using versioned secrets
4. **Use test environment** for development and testing
5. **Review logs** for unauthorized access attempts

## Rollback

If a deployment fails, you can rollback to a previous revision:

```bash
# List revisions
gcloud run revisions list --service=your-service-name --region=us-central1

# Rollback to specific revision
gcloud run services update-traffic your-service-name \
  --to-revisions=REVISION_NAME=100 \
  --region=us-central1
```

## CI/CD Integration

These scripts can be integrated into CI/CD pipelines:

```yaml
# Example GitHub Actions workflow
deploy-test:
  runs-on: ubuntu-latest
  steps:
    - uses: actions/checkout@v3
    - uses: google-github-actions/setup-gcloud@v1
    - run: ./scripts/fast-deploy-test.sh

deploy-prod:
  needs: deploy-test
  runs-on: ubuntu-latest
  steps:
    - uses: actions/checkout@v3
    - uses: google-github-actions/setup-gcloud@v1
    - run: ./scripts/fast-deploy-prod.sh
```
