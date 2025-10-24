# Shared OAuth App Setup

## 🚀 **The Problem**
GitHub OAuth requires a pre-registered OAuth app, but users don't want to create their own.

## 💡 **The Solution**
Create **one shared OAuth app** that everyone can use for development/testing.

## 🔧 **How to Set Up the Shared OAuth App**

### 1. Create the OAuth App (One Time)
1. Go to https://github.com/settings/developers
2. Click "New OAuth App"
3. Fill in:
   - **Application name**: `Redstring UI React (Shared)`
   - **Homepage URL**: `http://localhost:4000`
   - **Authorization callback URL**: `http://localhost:4000/oauth/callback`
4. Click "Register application"
5. Copy the **Client ID** and **Client Secret**

### 2. Update the .env file
```bash
# Replace with the shared OAuth app credentials
GITHUB_CLIENT_ID=shared-client-id-here
GITHUB_CLIENT_SECRET=shared-client-secret-here
VITE_GITHUB_CLIENT_ID=shared-client-id-here
```

### 3. Everyone Can Use It
- **All users** can use the same Client ID
- **No individual setup** required
- **Works immediately** for anyone trying the app

## 🎯 **Benefits**
- ✅ **Zero setup for users**
- ✅ **Real GitHub OAuth**
- ✅ **Works immediately**
- ✅ **No individual OAuth apps needed**

## 🔒 **Security Considerations**
- **Shared app** means shared rate limits
- **All users** redirect through the same callback
- **Suitable for development/testing**
- **For production**, users should create their own OAuth apps

## 🚀 **For Production**
When deploying to production:
1. **Each user** creates their own OAuth app
2. **Set callback URL** to your production domain
3. **Use individual Client IDs**
4. **Better security and rate limits** 