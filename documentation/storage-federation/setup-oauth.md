# OAuth Setup Guide

## Quick Setup

1. **Create GitHub OAuth App**:
   - Go to https://github.com/settings/developers
   - Click "New OAuth App"
   - Application name: `Redstring UI React`
   - Homepage URL: `http://localhost:4000`
   - Authorization callback URL: `http://localhost:4000/oauth/callback`
   - Copy Client ID and Client Secret

2. **Create .env file**:
   ```bash
   # Copy this to .env file
   GITHUB_CLIENT_ID=your-github-client-id-here
   GITHUB_CLIENT_SECRET=your-github-client-secret-here
   VITE_GITHUB_CLIENT_ID=your-github-client-id-here
   PORT=4000
   ```

3. **Start the application**:
   ```bash
   npm run dev:full
   ```

4. **Test OAuth**:
   - Go to http://localhost:4000
   - Select GitHub provider
   - Choose OAuth method
   - Click "Connect with GitHub"

## How It Works

1. **Frontend** redirects to GitHub OAuth with Client ID
2. **GitHub** redirects back with authorization code
3. **Backend** exchanges code for access token using Client Secret
4. **Frontend** receives access token and connects to GitHub API

## Security

- Client Secret stays on server (never in frontend)
- CSRF protection with state parameter
- Secure token exchange via backend API 