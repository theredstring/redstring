# GitHub App Setup Guide for Redstring

## Overview
This guide walks through creating and configuring a GitHub App for Redstring that provides persistent authentication without token expiration issues.

## Step 1: Create GitHub App

### 1.1 Navigate to GitHub Developer Settings
1. Go to GitHub.com → Settings → Developer settings → GitHub Apps
2. Click **"New GitHub App"**

### 1.2 Basic Information
- **GitHub App name**: `Redstring Semantic Sync`
- **Description**: `Sync Redstring cognitive graphs with GitHub repositories for persistent knowledge management`
- **Homepage URL**: `https://redstring.io`
- **User authorization callback URL**: `https://redstring.io/github-app/callback`

### 1.3 Webhook Configuration
- **Webhook URL**: `https://redstring.io/api/github/app/webhook`
- **Webhook secret**: Generate a random secret and save it
- **SSL verification**: ✅ Enable

### 1.4 Repository Permissions
Set these permissions for the app:

- **Contents**: Read & Write *(for semantic files)*
- **Metadata**: Read *(for repository info)*  
- **Pull requests**: Read *(optional, for future features)*

### 1.5 Account Permissions
- **Email addresses**: No access *(not needed)*
- **Plan**: No access *(not needed)*

### 1.6 User Permissions
- No user permissions needed *(we only access repositories)*

### 1.7 Subscribe to Events
- ✅ Installation
- ✅ Installation repositories
- ✅ Push *(optional, for future auto-sync)*

## Step 2: Configure App Settings

### 2.1 Generate Private Key
1. After creating the app, scroll to **"Private keys"**
2. Click **"Generate a private key"**
3. Download the `.pem` file
4. Store it securely (you'll need it for deployment)

### 2.2 Note App Credentials
Save these values for environment configuration:
- **App ID** (shown at top of app page)
- **Client ID** (in "About" section)  
- **Client Secret** (generate if not shown)
- **Private Key** (the `.pem` file contents)

## Step 3: Environment Configuration

### 3.1 Add Environment Variables
Add these to your deployment environment:

```bash
# GitHub App Configuration
GITHUB_APP_ID="123456"
GITHUB_APP_CLIENT_ID="Iv1.abc123def456"
GITHUB_APP_CLIENT_SECRET="your_client_secret_here"
GITHUB_APP_PRIVATE_KEY="-----BEGIN RSA PRIVATE KEY-----
...your private key content...
-----END RSA PRIVATE KEY-----"
```

### 3.2 Google Cloud Secret Manager
For production deployment, store sensitive values in Secret Manager:

```bash
# Store GitHub App secrets
echo "Iv1.abc123def456" | gcloud secrets create github-app-client-id --data-file=-
echo "your_client_secret_here" | gcloud secrets create github-app-client-secret --data-file=-
echo "your_webhook_secret_here" | gcloud secrets create github-app-webhook-secret --data-file=-

# Store private key (multi-line)
gcloud secrets create github-app-private-key --data-file=path/to/your-app.2024-01-01.private-key.pem
```

## Step 4: Update Deployment Scripts

### 4.1 Update `deploy_oauth_prod.sh`
Add GitHub App secret mounting:

```bash
# Deploy to Cloud Run with GitHub App secrets
gcloud run deploy $SERVICE_NAME \
    --image gcr.io/$PROJECT_ID/redstring-oauth:latest \
    --region $REGION \
    --platform managed \
    --allow-unauthenticated \
    --port 3002 \
    --memory 512Mi \
    --cpu 0.5 \
    --concurrency 50 \
    --max-instances 5 \
    --set-env-vars "NODE_ENV=production,OAUTH_PORT=3002" \
    --set-secrets "GITHUB_CLIENT_ID=github-client-id:latest,GITHUB_CLIENT_SECRET=github-client-secret:latest,GITHUB_APP_ID=github-app-id:latest,GITHUB_APP_CLIENT_ID=github-app-client-id:latest,GITHUB_APP_CLIENT_SECRET=github-app-client-secret:latest,GITHUB_APP_PRIVATE_KEY=github-app-private-key:latest"
```

### 4.2 Update Dockerfile Dependencies
Add JWT dependency for GitHub App authentication:

```dockerfile
# Add to package.json dependencies or install in Dockerfile
RUN npm install jsonwebtoken @octokit/rest
```

## Step 5: Frontend Integration

### 5.1 Add Environment Variables to Frontend
Update your Vite config to expose GitHub App settings:

```javascript
// vite.config.js
export default defineConfig({
  // ... other config
  define: {
    'import.meta.env.VITE_GITHUB_APP_ID': JSON.stringify(process.env.VITE_GITHUB_APP_ID),
    'VITE_GITHUB_APP_CLIENT_ID': JSON.stringify(process.env.VITE_GITHUB_APP_CLIENT_ID)
  }
});
```

### 5.2 Update GitNativeFederation Component
The component is already set up to handle GitHub App authentication through the new service.

## Step 6: Testing the GitHub App

### 6.1 Local Testing
1. Set environment variables locally
2. Start the OAuth server: `node oauth-server.js`
3. Test app installation flow
4. Verify webhook delivery

### 6.2 Production Testing
1. Deploy with GitHub App configuration
2. Test installation on a test repository
3. Verify persistent authentication works
4. Check webhook logs for proper event handling

## Step 7: User Installation Flow

### 7.1 App Installation URL
Users will visit: `https://github.com/apps/redstring-semantic-sync/installations/new`

### 7.2 Installation Process
1. User selects organization/account
2. Selects repositories to connect  
3. Grants permissions
4. Redirects to Redstring with installation ID
5. Redstring stores installation and shows repository selector
6. User selects specific repository for sync
7. Connection established with persistent authentication

## Step 8: Monitoring & Maintenance

### 8.1 Installation Tracking
Monitor installations through:
- GitHub App dashboard
- Webhook logs in Cloud Run
- Application metrics

### 8.2 Token Management
- Installation tokens auto-refresh (1 hour expiry)
- No user re-authentication required
- Monitor API rate limits (5000/hour per installation)

### 8.3 Error Handling
- Handle suspended installations
- Manage permission changes
- Deal with uninstalled apps gracefully

## Benefits of GitHub App vs OAuth

| Feature | OAuth Token | GitHub App |
|---------|-------------|------------|
| **Expiration** | Can expire | Never expires |
| **Rate Limit** | 1000/hour | 5000/hour |
| **Permissions** | User-wide | Repository-specific |
| **Re-auth Required** | Yes | No |
| **User Password Change** | Breaks auth | Unaffected |
| **Revocation** | User can revoke | User can uninstall |
| **API Access** | As user | As app installation |

## Security Considerations

1. **Private Key Security**: Store private key securely in Secret Manager
2. **Webhook Verification**: Implement webhook signature verification  
3. **Token Caching**: Cache installation tokens securely with expiry
4. **Audit Logging**: Log all GitHub App operations for security
5. **Minimal Permissions**: Only request needed repository permissions

## Troubleshooting

### Common Issues
1. **JWT Generation Errors**: Check private key format and App ID
2. **Installation Not Found**: Verify installation ID and app permissions
3. **API Rate Limits**: Monitor usage and implement proper caching
4. **Webhook Delivery**: Check URL accessibility and SSL certificates

### Debugging
- Check Cloud Run logs for detailed error messages
- Use GitHub App dashboard to see installation status
- Test webhook delivery manually in GitHub settings
- Verify environment variables are properly set

---

## Next Steps

1. **Create the GitHub App** following steps above
2. **Deploy with new configuration** including all environment variables
3. **Test installation flow** with a test repository
4. **Monitor for issues** and iterate as needed
5. **Migrate existing users** from OAuth to GitHub App authentication

This GitHub App approach will provide the reliable, persistent authentication that Redstring needs for seamless semantic web integration! 🚀