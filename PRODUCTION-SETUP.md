# Real GitHub OAuth Setup (Optional)

## 🚀 **Quick Start - Zero Configuration Required!**

The app works **immediately** with no setup required:

```bash
npm run dev:full
```

Then click "Connect with GitHub" - it works instantly with demo data!

**You only need this guide if you want to connect to real GitHub accounts.**

## 🔧 **For Real GitHub OAuth (Optional)**

Only needed if you want to connect to real GitHub accounts in production.

### 1. Create GitHub OAuth App (2 minutes)
1. Go to https://github.com/settings/developers
2. Click "New OAuth App"
3. Fill in:
   - **Application name**: `Redstring UI React`
   - **Homepage URL**: `http://localhost:4000` (or your domain)
   - **Authorization callback URL**: `http://localhost:4000/oauth/callback` (or your domain)
4. Copy the **Client ID** and **Client Secret**

### 2. Update .env file
Replace the placeholder values in your `.env` file:

```bash
# Replace these:
GITHUB_CLIENT_ID=your-github-client-id-here
GITHUB_CLIENT_SECRET=your-github-client-secret-here
VITE_GITHUB_CLIENT_ID=your-github-client-id-here

# With your real values:
GITHUB_CLIENT_ID=abc123def456ghi789
GITHUB_CLIENT_SECRET=jkl012mno345pqr678
VITE_GITHUB_CLIENT_ID=abc123def456ghi789
```

### 3. Restart the app
```bash
npm run dev:full
```

That's it! Now OAuth will connect to real GitHub accounts.

## 🎯 **Development vs Production**

- **Development**: Works immediately with mock data
- **Production**: Add real GitHub OAuth credentials for live accounts

## 💡 **Why This Approach?**

- **Zero friction** for getting started
- **No setup required** for development
- **Optional production setup** when needed
- **Best of both worlds** - easy dev, powerful production 