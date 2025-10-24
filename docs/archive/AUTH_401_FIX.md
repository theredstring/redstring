# 401 Authentication Error Fix

## Problem

Users encountering **401 "Bad credentials"** error when saving to GitHub:

```
GitHub OVERWRITER failed: 401 {
  "message": "Bad credentials",
  "documentation_url": "https://docs.github.com/rest",
  "status": "401"
}
```

This happens when:
- OAuth token has been revoked
- GitHub App installation token expired (1 hour expiry)
- Token refresh failed due to network/server issues
- Stored token is invalid or corrupted

---

## Immediate Fix (For Users)

### Option 1: Quick Console Command

Open browser console and run:

```javascript
// Clear expired GitHub authentication
localStorage.removeItem('github_access_token');
localStorage.removeItem('github_token_expiry');
localStorage.removeItem('github_user_data');
localStorage.removeItem('github_app_access_token');
localStorage.removeItem('github_app_installation_id');

// Reload to trigger re-auth
location.reload();
```

### Option 2: Manual Re-Authentication

1. Open **Git Federation** panel
2. Look for the red error banner: "GitHub authentication expired"
3. Click **"Connect GitHub OAuth"** or **"Connect GitHub App"**
4. Complete the authentication flow
5. Your saves will work again

---

## Long-Term Fix (Code Changes)

### 1. Automatic 401 Detection & Token Cleanup

**File:** `src/services/gitNativeProvider.js`

Added 401 error handling in `writeFileRaw()`:

```javascript
if (response.status === 401) {
  console.error('[GitHubSemanticProvider] 401 Authentication failed');
  
  // Emit event to UI
  window.dispatchEvent(new CustomEvent('redstring:auth-expired', {
    detail: { 
      error: '401 Bad credentials',
      authMethod: this.authMethod,
      message: 'GitHub authentication expired. Please re-connect.'
    }
  }));
  
  // Clear invalid token
  const { persistentAuth } = await import('./persistentAuth.js');
  if (this.authMethod === 'github-app') {
    persistentAuth.clearAppInstallation?.();
  } else {
    persistentAuth.clearTokens?.();
  }
  
  throw new Error(`GitHub authentication failed (401). Please reconnect in the Git Federation panel.`);
}
```

**Benefits:**
- ✅ Automatically detects 401 errors
- ✅ Clears invalid tokens immediately
- ✅ Emits event for UI to handle
- ✅ Provides clear error message

### 2. UI Error Display

**File:** `src/GitNativeFederation.jsx`

Added event listener to show prominent error message:

```javascript
const handleAuthExpired = async (event) => {
  const detail = event.detail || {};
  console.warn('[GitNativeFederation] Authentication expired:', detail);
  
  // Clear any stale state
  await refreshAuth();
  
  // Show prominent error message
  setError(detail.message || 'GitHub authentication expired. Please reconnect below.');
  
  // Clear any success status
  setSyncStatus(null);
};

window.addEventListener('redstring:auth-expired', handleAuthExpired);
```

**Result:**
- Red error banner appears at top of Git Federation panel
- Clear message: "GitHub authentication expired. Please reconnect below."
- User can see auth buttons and reconnect immediately

---

## How Token Refresh Works

### GitHub App Tokens (Preferred)

**Expiry:** 1 hour  
**Refresh Logic:** Automatic refresh when token is >45 minutes old

```javascript
// In createProviderForUniverse()
const needsRefresh = !app.accessToken || tokenExpiresAt < (now + 5 minutes);

if (needsRefresh) {
  const tokenResp = await oauthFetch('/api/github/app/installation-token', {
    method: 'POST',
    body: JSON.stringify({ installation_id: app.installationId })
  });
  
  const tokenData = await tokenResp.json();
  token = tokenData.token;
  
  // Update stored installation with fresh token
  persistentAuth.storeAppInstallation({ ...app, accessToken: token, tokenExpiresAt });
}
```

**Issues:**
- If backend is down, refresh fails
- If network is poor, request times out
- If installation was revoked, 404 error

### OAuth Tokens (Fallback)

**Expiry:** Technically don't expire (can be revoked)  
**Refresh Logic:** Validation on startup

```javascript
// In persistentAuth.performTokenValidation()
const isValid = await this.testTokenValidity();

if (isValid) {
  // Extend expiry by 1 year
  const newExpiryTime = Date.now() + (365 * 24 * 60 * 60 * 1000);
  storageWrapper.setItem(STORAGE_KEYS.TOKEN_EXPIRY, newExpiryTime.toString());
} else {
  // Clear invalid tokens
  this.clearTokens();
  throw new Error('Token validation failed');
}
```

---

## Prevention Strategies

### 1. Token Health Monitoring

Already implemented in `persistentAuth.js`:

```javascript
// Check health every 5 minutes
const HEALTH_CHECK_INTERVAL = 5 * 60 * 1000;

startHealthMonitoring() {
  this.healthCheckInterval = setInterval(async () => {
    try {
      await this.performTokenValidation();
    } catch (error) {
      console.warn('[PersistentAuth] Health check failed:', error);
      this.emit('authExpired', error);
    }
  }, HEALTH_CHECK_INTERVAL);
}
```

### 2. Preemptive Token Refresh

Tokens are refreshed **before** they expire:

- **GitHub App**: 15 minutes before expiry
- **OAuth**: On startup validation

### 3. Fallback Chain

```
GitHub App Token → OAuth Token → Error
     (1 hour)       (long-lived)   (re-auth)
```

If GitHub App token fails, system falls back to OAuth automatically.

---

## Testing

### Simulate 401 Error

```javascript
// Corrupt the token to trigger 401
localStorage.setItem('github_access_token', 'invalid_token_12345');

// Try to save - should see:
// 1. Console error: "401 Authentication failed"
// 2. Token automatically cleared
// 3. Red error banner in UI
// 4. Event dispatched: 'redstring:auth-expired'
```

### Test Auto-Recovery

```javascript
// After 401 error triggers:
// 1. Error banner should appear
// 2. Click "Connect GitHub OAuth"
// 3. Complete auth flow
// 4. Save should work immediately
```

---

## Related Files

- ✅ `src/services/gitNativeProvider.js` - Added 401 detection & token clearing
- ✅ `src/GitNativeFederation.jsx` - Added UI error handling
- `src/services/persistentAuth.js` - Token storage & validation
- `src/services/universeBackend.js` - Token refresh logic
- `src/services/bridgeConfig.js` - OAuth server communication

---

## Known Issues

1. **Backend restart** - If oauth-server.js restarts, app installation tokens need re-fetch
2. **Network interruption** - Token refresh may fail silently during poor connectivity
3. **Multiple tabs** - Token cleared in one tab doesn't immediately affect other tabs
4. **Installation revocation** - If user uninstalls GitHub App, system needs manual re-auth

---

## Future Improvements

1. **Retry logic** - Attempt token refresh 2-3 times before showing error
2. **User notification** - Toast/banner warning when token is about to expire
3. **Cross-tab sync** - BroadcastChannel to sync auth state across tabs
4. **Offline detection** - Don't show auth error if network is offline

---

## Summary

**Problem:** 401 errors caused stuck/failed saves  
**Root Cause:** Expired tokens not being detected or cleared  
**Solution:** Automatic 401 detection → clear invalid tokens → show clear error message → user re-authenticates  
**Result:** User sees helpful error and can reconnect in 2 clicks instead of being stuck

✅ **Changes are live and ready to test!**
