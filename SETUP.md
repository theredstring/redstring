# Local Development Setup

This guide helps you set up the repository for local development after cloning.

## Prerequisites

- Node.js (v18 or higher)
- npm or yarn
- Git
- (Optional) Google Cloud SDK for GCP deployments
- (Optional) GitHub App credentials for GitHub integration

## Quick Start

### 1. Install Dependencies

```bash
npm install
```

### 2. Configure Environment Variables

The repository uses sanitized placeholder values for security. To develop locally, you need to create local environment files with your actual credentials.

#### For GitHub App Integration:

Copy the example file and add your credentials:

```bash
cp github.env github.env.local
```

Then edit `github.env.local` with your actual GitHub App credentials:

```bash
# GitHub App Credentials
GITHUB_APP_ID="your-app-id"
GITHUB_APP_CLIENT_ID="your-client-id"
GITHUB_APP_CLIENT_SECRET="your-client-secret"
GITHUB_APP_WEBHOOK_SECRET="your-webhook-secret"

# Path to your downloaded private key .pem file
PRIVATE_KEY_PATH="/path/to/your/private-key.pem"

# Google Cloud Project ID
GCP_PROJECT_ID="your-gcp-project-id"
```

**Note:** The `.local` files are gitignored and will NOT be committed to the repository.

### 3. Start Development Server

```bash
# Start the main dev server
npm run dev

# Or start all services (OAuth + server + dev)
npm run dev:full
```

The application will be available at:
- Main app: http://localhost:5173 (Vite dev server)
- API server: http://localhost:4000
- OAuth server: http://localhost:3002

## Environment File Priority

Scripts will load environment variables in this order:
1. `github.env.local` (your local credentials, gitignored)
2. `github.env` (sanitized placeholders, committed to repo)

## Available Scripts

- `npm run dev` - Start Vite development server
- `npm run dev:full` - Start OAuth, API server, and Vite concurrently
- `npm run build` - Build for production
- `npm run preview` - Preview production build
- `npm run test` - Run tests
- `npm run oauth` - Start OAuth server only
- `npm run server` - Start API server only

## GitHub App Setup (Optional)

If you want to use GitHub integration features:

1. Create a GitHub App at https://github.com/settings/apps
2. Configure OAuth callback URL: `http://localhost:3002/oauth/callback`
3. Generate a private key and download the `.pem` file
4. Copy credentials to `github.env.local` as shown above

## Google Cloud Deployment (Optional)

For Google Cloud deployments:

1. Install Google Cloud SDK
2. Authenticate: `gcloud auth login`
3. Set project: `gcloud config set project YOUR_PROJECT_ID`
4. Run deployment script: `./deployment/gcp/deploy_prod.sh YOUR_PROJECT_ID`

See `deployment/gcp/README.md` for detailed deployment instructions.

## Troubleshooting

### "Missing GitHub credentials" error
- Make sure you've created `github.env.local` with your actual credentials
- Check that the file is in the root directory
- Verify the environment variables are set correctly

### OAuth callback not working
- Ensure OAuth server is running on port 3002
- Check that your GitHub App callback URL matches `http://localhost:3002/oauth/callback`
- Verify the client ID and secret are correct

### Port already in use
- Kill existing processes: `npm run bridge:kill`
- Check for other services using ports 3002, 4000, or 5173

## Security Notes

- **NEVER** commit files containing real credentials
- The `.gitignore` is configured to exclude all `.local` files
- The `github.env` file in the repository contains only placeholders
- Private keys (`.pem` files) are automatically excluded from git

## Getting Help

For more detailed documentation, see:
- [AI Integration Guide](./AI_INTEGRATION_GUIDE.md)
- [Deployment Guide](./DEPLOYMENT.md)
- [Troubleshooting](./TROUBLESHOOTING.md)

