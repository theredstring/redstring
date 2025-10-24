# Deployment Quick Start

## Two Environments, Two Commands

### 🚀 Production Deployment
```bash
./scripts/fast-deploy-prod.sh
```
- Deploys to: `https://redstring.io`
- GitHub App: `redstring-semantic-sync`
- Environment: Production
- Logging: Minimal (warnings only)

### 🧪 Test Deployment
```bash
./scripts/fast-deploy-test.sh
```
- Deploys to: `https://redstring-test-umk552kp4q-uc.a.run.app`
- GitHub App: `redstring-semantic-sync-test`
- Environment: Test/Development
- Logging: Verbose (all info)

## What's Different?

| Feature | Production | Test |
|---------|-----------|------|
| **URL** | redstring.io | redstring-test-*.run.app |
| **GitHub App** | redstring-semantic-sync | redstring-semantic-sync-test |
| **OAuth Client** | Ov23liYygPgJ9Tzcbvg6 | Ov23li1dnhS3KhBcHnup |
| **Secrets Suffix** | (none) | `-test` |
| **NODE_ENV** | production | development |
| **LOG_LEVEL** | warn | info |
| **Use Case** | Live users | Development & testing |

## Automatic Environment Detection

The OAuth server automatically detects which environment it's in based on the request hostname:

```javascript
// Test environment if URL contains:
- localhost
- 127.0.0.1
- redstring-test

// Production otherwise
```

This means:
- ✅ No manual configuration needed
- ✅ Test and prod can't accidentally cross-contaminate
- ✅ Same codebase works for both environments
- ✅ Credentials are automatically selected

## Quick Health Checks

```bash
# Production
curl https://redstring.io/health
curl https://redstring.io/api/github/app/info

# Test
curl https://redstring-test-umk552kp4q-uc.a.run.app/health
curl https://redstring-test-umk552kp4q-uc.a.run.app/api/github/app/info
```

## When to Use Which?

### Use Production (`fast-deploy-prod.sh`) when:
- ✅ Deploying to live users
- ✅ All testing is complete
- ✅ You're confident in the changes
- ⚠️ **Double-check before running!**

### Use Test (`fast-deploy-test.sh`) when:
- ✅ Testing new features
- ✅ Validating GitHub integration changes
- ✅ Experimenting with configurations
- ✅ You need verbose logging for debugging
- ✅ You want to test without affecting production

## Deployment Checklist

### Before Production Deployment:
- [ ] Test in test environment first
- [ ] Verify health checks pass
- [ ] Check GitHub OAuth flow works
- [ ] Verify GitHub App installation works
- [ ] Review recent changes
- [ ] Confirm with team if needed

### Before Test Deployment:
- [ ] Commit your changes
- [ ] Build passes locally (`npm run build`)
- [ ] You understand what you're testing

## Troubleshooting

**Problem:** Wrong GitHub App appears in test
**Solution:** Check `/api/github/app/info` - should return `redstring-semantic-sync-test` for test

**Problem:** OAuth callback fails
**Solution:** Verify callback URL in GitHub matches environment URL

**Problem:** Deployment succeeds but app doesn't work
**Solution:** Check logs: `gcloud logging read 'resource.labels.service_name=redstring-test'`

## Security Notes

- 🔒 **All secrets are stored in GCP Secret Manager**
- 🔒 **Private keys are NEVER committed to git**
- 🔒 **Test and prod use separate credentials**
- 🔒 **Each deployment gets fresh secrets from GCP**

## Need More Details?

See [DEPLOYMENT.md](./DEPLOYMENT.md) for comprehensive documentation.
