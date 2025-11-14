/**
 * Redstring App + Semantic Web Server
 * - Serves static UI
 * - Proxies OAuth to the OAuth server
 * - Exposes local semantic web endpoints (JSON-LD, N-Quads, Turtle)
 */

import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import fetch from 'node-fetch';
import cors from 'cors';
import fs from 'fs/promises';
import jsonld from 'jsonld';
import * as $rdf from 'rdflib';
import userAnalytics from '../src/services/UserAnalytics.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Environment-based logging control
const isProduction = process.env.NODE_ENV === 'production';
const LOG_LEVEL = process.env.LOG_LEVEL || (isProduction ? 'warn' : 'info');

// Create a logger that respects environment settings
const logger = {
  info: (...args) => {
    if (LOG_LEVEL === 'info' || LOG_LEVEL === 'debug') {
      console.log(...args);
    }
  },
  warn: (...args) => {
    if (LOG_LEVEL === 'warn' || LOG_LEVEL === 'info' || LOG_LEVEL === 'debug') {
      console.warn(...args);
    }
  },
  error: (...args) => {
    // Always log errors
    console.error(...args);
  },
  debug: (...args) => {
    if (LOG_LEVEL === 'debug') {
      console.log('[DEBUG]', ...args);
    }
  }
};

const app = express();
const PORT = process.env.PORT || 4000;
const OAUTH_PORT = process.env.OAUTH_PORT || 3002;
const OAUTH_HOST = process.env.OAUTH_HOST || 'localhost';
const DEFAULT_UNIVERSE_SLUG = process.env.UNIVERSE_SLUG || 'default';

// Build OAuth server URL
const oauthBaseUrl = OAUTH_HOST === 'localhost' 
  ? `http://localhost:${OAUTH_PORT}`
  : OAUTH_HOST.startsWith('http') 
    ? OAUTH_HOST 
    : `https://${OAUTH_HOST}`;

// In Docker, we're in /app and dist is at /app/dist 
const distPath = path.join(process.cwd(), 'dist');

// Enable JSON parsing for OAuth requests and general API
app.use(express.json({ limit: '5mb' }));
// Enable CORS for semantic web routes (safe for read-only endpoints)
app.use(cors());

// User analytics tracking middleware
app.use((req, res, next) => {
  // Skip tracking for static assets and health checks
  if (req.path.startsWith('/assets/') || 
      req.path === '/health' ||
      req.path.startsWith('/api/analytics')) {
    return next();
  }

  // Extract user info from request (if available)
  // This will be populated by OAuth endpoints
  const userId = req.headers['x-user-id'] || null;
  const userLogin = req.headers['x-user-login'] || null;
  const ip = req.ip || req.headers['x-forwarded-for'] || req.connection.remoteAddress;
  const userAgent = req.headers['user-agent'] || null;

  // Track the request
  try {
    userAnalytics.trackActivity({
      userId,
      userLogin,
      action: 'http_request',
      metadata: {
        method: req.method,
        path: req.path,
        statusCode: res.statusCode
      },
      ip,
      userAgent,
      path: req.path
    });
  } catch (error) {
    // Don't break requests if analytics fails
    logger.debug('[Analytics] Tracking error:', error.message);
  }

  // Track response status
  const originalSend = res.send;
  res.send = function(data) {
    try {
      userAnalytics.trackActivity({
        userId,
        userLogin,
        action: 'http_response',
        metadata: {
          method: req.method,
          path: req.path,
          statusCode: res.statusCode,
          responseSize: data ? String(data).length : 0
        },
        ip,
        userAgent,
        path: req.path
      });
    } catch (error) {
      // Ignore analytics errors
    }
    return originalSend.call(this, data);
  };

  next();
});

// Analytics API endpoints
app.get('/api/analytics/stats', (req, res) => {
  try {
    const timeRange = req.query.range || 'all';
    const stats = userAnalytics.getStats(timeRange);
    res.json(stats);
  } catch (error) {
    logger.error('[Analytics] Stats error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/analytics/active-users', (req, res) => {
  try {
    const minutes = parseInt(req.query.minutes || '30', 10);
    const activeUsers = userAnalytics.getActiveUsers(minutes);
    res.json({
      count: activeUsers.length,
      users: activeUsers,
      minutes
    });
  } catch (error) {
    logger.error('[Analytics] Active users error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/analytics/user/:userId', (req, res) => {
  try {
    const user = userAnalytics.getUser(req.params.userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    res.json(user);
  } catch (error) {
    logger.error('[Analytics] User error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/analytics/activity', (req, res) => {
  try {
    const startTime = req.query.start ? parseInt(req.query.start, 10) : Date.now() - (24 * 60 * 60 * 1000);
    const endTime = req.query.end ? parseInt(req.query.end, 10) : Date.now();
    const limit = req.query.limit ? parseInt(req.query.limit, 10) : 1000;
    
    const activities = userAnalytics.getActivity(startTime, endTime);
    const limited = activities.slice(-limit);
    
    res.json({
      count: limited.length,
      total: activities.length,
      activities: limited,
      startTime,
      endTime
    });
  } catch (error) {
    logger.error('[Analytics] Activity error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Client-side tracking endpoint
app.post('/api/analytics/track', (req, res) => {
  try {
    const { action, metadata = {}, userId, userLogin, path, url } = req.body;
    const ip = req.ip || req.headers['x-forwarded-for'] || req.connection.remoteAddress;
    const userAgent = req.headers['user-agent'] || null;

    userAnalytics.trackActivity({
      userId: userId || null,
      userLogin: userLogin || null,
      action: action || 'unknown',
      metadata: {
        ...metadata,
        source: 'client',
        url: url || null
      },
      ip,
      userAgent,
      path: path || req.path
    });

    res.json({ success: true });
  } catch (error) {
    logger.error('[Analytics] Track error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Proxy OAuth requests to internal OAuth server
app.get('/api/github/oauth/client-id', async (req, res) => {
  try {
    const response = await fetch(`${oauthBaseUrl}/api/github/oauth/client-id`);
    const data = await response.json();
    res.json(data);
  } catch (error) {
    logger.error('OAuth proxy error (client-id):', error);
    res.status(500).json({ error: 'OAuth service unavailable' });
  }
});

app.get('/api/github/oauth/health', async (req, res) => {
  try {
    const response = await fetch(`${oauthBaseUrl}/health`);
    const data = await response.json();
    res.json(data);
  } catch (error) {
    logger.error('OAuth proxy error (health):', error);
    res.status(500).json({ error: 'OAuth service unavailable' });
  }
});

app.post('/api/github/oauth/token', async (req, res) => {
  try {
    const response = await fetch(`${oauthBaseUrl}/api/github/oauth/token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(req.body)
    });
    const data = await response.json();
    res.status(response.status).json(data);
  } catch (error) {
    logger.error('OAuth proxy error (token):', error);
    res.status(500).json({ error: 'OAuth service unavailable' });
  }
});

// Secure auth state proxies
app.get('/api/github/auth/state', async (req, res) => {
  try {
    const response = await fetch(`${oauthBaseUrl}${req.originalUrl}`);
    const data = await response.json();
    res.status(response.status).json(data);
  } catch (error) {
    logger.error('OAuth proxy error (auth state):', error);
    res.status(500).json({ error: 'OAuth service unavailable' });
  }
});

app.get('/api/github/auth/oauth/token', async (req, res) => {
  try {
    const response = await fetch(`${oauthBaseUrl}${req.originalUrl}`);
    const data = await response.json();
    res.status(response.status).json(data);
  } catch (error) {
    logger.error('OAuth proxy error (oauth token get):', error);
    res.status(500).json({ error: 'OAuth service unavailable' });
  }
});

app.post('/api/github/auth/oauth', async (req, res) => {
  try {
    const response = await fetch(`${oauthBaseUrl}${req.originalUrl}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(req.body)
    });
    const data = await response.json();
    res.status(response.status).json(data);
  } catch (error) {
    logger.error('OAuth proxy error (oauth token store):', error);
    res.status(500).json({ error: 'OAuth service unavailable' });
  }
});

app.delete('/api/github/auth/oauth', async (req, res) => {
  try {
    const response = await fetch(`${oauthBaseUrl}${req.originalUrl}`, {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
      }
    });
    const data = await response.json();
    res.status(response.status).json(data);
  } catch (error) {
    logger.error('OAuth proxy error (oauth token clear):', error);
    res.status(500).json({ error: 'OAuth service unavailable' });
  }
});

app.get('/api/github/auth/github-app', async (req, res) => {
  try {
    const response = await fetch(`${oauthBaseUrl}${req.originalUrl}`);
    const data = await response.json();
    res.status(response.status).json(data);
  } catch (error) {
    logger.error('OAuth proxy error (github app get):', error);
    res.status(500).json({ error: 'OAuth service unavailable' });
  }
});

app.post('/api/github/auth/github-app', async (req, res) => {
  try {
    const response = await fetch(`${oauthBaseUrl}${req.originalUrl}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(req.body)
    });
    const data = await response.json();
    res.status(response.status).json(data);
  } catch (error) {
    logger.error('OAuth proxy error (github app store):', error);
    res.status(500).json({ error: 'OAuth service unavailable' });
  }
});

app.delete('/api/github/auth/github-app', async (req, res) => {
  try {
    const response = await fetch(`${oauthBaseUrl}${req.originalUrl}`, {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
      }
    });
    const data = await response.json();
    res.status(response.status).json(data);
  } catch (error) {
    logger.error('OAuth proxy error (github app clear):', error);
    res.status(500).json({ error: 'OAuth service unavailable' });
  }
});

// =============================================================================
// GitHub Integration Callbacks - Explicit, Purpose-Specific Routes
// =============================================================================

/**
 * Helper function to generate callback HTML
 * This HTML page processes OAuth and GitHub App callbacks in the browser
 */
function generateCallbackHtml(callbackType) {
  return `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Redstring - GitHub ${callbackType}</title>
    <style>
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: #1a1a1a;
            color: #e0e0e0;
            margin: 0;
            padding: 40px 20px;
            display: flex;
            justify-content: center;
            align-items: center;
            min-height: 100vh;
        }
        .container {
            text-align: center;
            max-width: 400px;
        }
        .spinner {
            width: 40px;
            height: 40px;
            margin: 0 auto 20px;
            border: 4px solid #333;
            border-top: 4px solid #4CAF50;
            border-radius: 50%;
            animation: spin 1s linear infinite;
        }
        @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
        }
        .error {
            color: #f44336;
            margin-top: 20px;
        }
        .success {
            color: #4CAF50;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="spinner"></div>
        <h2 id="status">Processing GitHub authorization...</h2>
        <p id="message">Please wait while we complete the OAuth flow.</p>
        <div id="error-details" class="error" style="display: none;"></div>
    </div>
    
    <script>
        const urlParams = new URLSearchParams(window.location.search);
        const code = urlParams.get('code');
        const state = urlParams.get('state');
        const installationId = urlParams.get('installation_id');
        const setupAction = urlParams.get('setup_action');
        const error = urlParams.get('error');
        const errorDescription = urlParams.get('error_description');
        
        const statusEl = document.getElementById('status');
        const messageEl = document.getElementById('message');
        const errorEl = document.getElementById('error-details');
        
        // Determine callback type
        const isOAuthCallback = !!(code && state);
        const isGitHubAppCallback = !!(installationId);
        
        console.log('[Callback] Type detected:', {
            isOAuth: isOAuthCallback,
            isGitHubApp: isGitHubAppCallback,
            hasCode: !!code,
            hasState: !!state,
            hasInstallationId: !!installationId,
            setupAction: setupAction
        });
        
        if (error) {
            statusEl.textContent = 'Authorization Failed';
            statusEl.className = 'error';
            messageEl.textContent = 'GitHub authorization was not completed.';
            errorEl.textContent = error + (errorDescription ? ': ' + errorDescription : '');
            errorEl.style.display = 'block';
            document.querySelector('.spinner').style.display = 'none';
            
            // Close window after showing error
            setTimeout(() => {
                if (window.opener) {
                    window.close();
                } else {
                    window.location.href = '/';
                }
            }, 3000);
        } else if (isOAuthCallback) {
            // Handle OAuth callback
            try {
                const oauthResult = { code, state };
                
                // Always store in sessionStorage for reliability
                sessionStorage.setItem('github_oauth_result', JSON.stringify(oauthResult));
                console.log('[OAuth Callback] Stored OAuth result in sessionStorage:', oauthResult);
                
                // Try to notify parent window (for popup flow)
                if (window.opener && !window.opener.closed) {
                    window.opener.postMessage({
                        type: 'GITHUB_OAUTH_SUCCESS',
                        data: oauthResult
                    }, window.location.origin);
                    
                    statusEl.textContent = 'Authorization Successful!';
                    statusEl.className = 'success';
                    messageEl.textContent = 'You can close this window.';
                    document.querySelector('.spinner').style.display = 'none';
                    
                    // Close the popup window
                    setTimeout(() => window.close(), 1500);
                } else {
                    // Same-window flow: store in sessionStorage and redirect
                    statusEl.textContent = 'Authorization Successful!';
                    statusEl.className = 'success';
                    messageEl.textContent = 'Redirecting back to app...';
                    document.querySelector('.spinner').style.display = 'none';
                    
                    // Redirect back to main app
                    setTimeout(() => {
                        window.location.href = '/';
                    }, 1000);
                }
            } catch (err) {
                console.error('OAuth callback processing error:', err);
                statusEl.textContent = 'Processing Error';
                statusEl.className = 'error';
                messageEl.textContent = 'Failed to process authorization. Please try again.';
                document.querySelector('.spinner').style.display = 'none';
            }
        } else if (isGitHubAppCallback) {
            // Handle GitHub App installation callback
            try {
                const appResult = { installation_id: installationId, setup_action: setupAction, state: state };
                
                // Store GitHub App result in sessionStorage
                sessionStorage.setItem('github_app_result', JSON.stringify(appResult));
                console.log('[GitHub App Callback] Stored app result in sessionStorage:', appResult);
                
                // Try to notify parent window (for popup flow)
                if (window.opener && !window.opener.closed) {
                    window.opener.postMessage({
                        type: 'GITHUB_APP_SUCCESS',
                        data: appResult
                    }, window.location.origin);
                    
                    statusEl.textContent = 'App Installation Successful!';
                    statusEl.className = 'success';
                    messageEl.textContent = 'You can close this window.';
                    document.querySelector('.spinner').style.display = 'none';
                    
                    // Close the popup window
                    setTimeout(() => window.close(), 1500);
                } else {
                    // Same-window flow: store in sessionStorage and redirect
                    statusEl.textContent = 'App Installation Successful!';
                    statusEl.className = 'success';
                    messageEl.textContent = 'Redirecting back to app...';
                    document.querySelector('.spinner').style.display = 'none';
                    
                    // Redirect back to main app
                    setTimeout(() => {
                        window.location.href = '/';
                    }, 1000);
                }
            } catch (err) {
                console.error('GitHub App callback processing error:', err);
                statusEl.textContent = 'Processing Error';
                statusEl.className = 'error';
                messageEl.textContent = 'Failed to process app installation. Please try again.';
                document.querySelector('.spinner').style.display = 'none';
            }
        } else {
            statusEl.textContent = 'Invalid Request';
            statusEl.className = 'error';
            messageEl.textContent = 'Missing required parameters for OAuth or App installation.';
            document.querySelector('.spinner').style.display = 'none';
        }
    </script>
</body>
</html>`;
}

// Route 1: GitHub App Setup (Post-Installation)
// Called after user installs the GitHub App
app.get('/api/github/app/setup', (req, res) => {
  const { installation_id, setup_action, state, error, error_description } = req.query;
  
  logger.info('[GitHub App Setup] Installation callback received:', {
    hasInstallationId: !!installation_id,
    setupAction: setup_action,
    hasState: !!state,
    hasError: !!error,
    state: state ? state.substring(0, 8) + '...' : null
  });
  
  if (error) {
    logger.error('[GitHub App Setup] Setup error:', error, error_description);
  }
  
  res.send(generateCallbackHtml('App Setup'));
});

// Route 2: GitHub App OAuth Callback
// Called after user authorizes the app to act on their behalf
app.get('/api/github/app/callback', (req, res) => {
  const { code, state, error, error_description, installation_id, setup_action } = req.query;
  
  // This can be either OAuth authorization or app installation
  const isOAuth = !!(code && state);
  const isAppInstall = !!installation_id;
  
  logger.info('[GitHub App Callback] Authorization callback received:', {
    type: isOAuth ? 'OAuth' : isAppInstall ? 'Installation' : 'Unknown',
    hasCode: !!code,
    hasState: !!state,
    hasInstallationId: !!installation_id,
    hasError: !!error,
    state: state ? state.substring(0, 8) + '...' : null
  });
  
  if (error) {
    logger.error('[GitHub App Callback] Callback error:', error, error_description);
  }
  
  res.send(generateCallbackHtml('App Authorization'));
});

// Legacy route: Keep for backward compatibility
// This was the old "magic" route that auto-detected callback type
app.get('/oauth/callback', (req, res) => {
  const { code, state, error, error_description, installation_id, setup_action } = req.query;
  
  // Determine callback type
  const isOAuthCallback = !!(code && state);
  const isGitHubAppCallback = !!(installation_id);
  
  logger.info('[Legacy Callback] Received (consider updating to specific routes):', {
    type: isOAuthCallback ? 'OAuth' : isGitHubAppCallback ? 'GitHub App' : 'Unknown',
    hasCode: !!code,
    hasState: !!state,
    hasError: !!error,
    hasInstallationId: !!installation_id,
    setupAction: setup_action,
    state: state ? state.substring(0, 8) + '...' : null
  });
  
  if (error) {
    logger.error('[Legacy Callback] error:', error, error_description);
  }
  
  res.send(generateCallbackHtml('OAuth'));
});

// GitHub App client-id proxy to OAuth server
app.get('/api/github/app/client-id', async (req, res) => {
  try {
    const response = await fetch(`${oauthBaseUrl}/api/github/app/client-id`);
    const data = await response.json();
    res.json(data);
  } catch (error) {
    logger.error('OAuth proxy error (app client-id):', error);
    res.status(500).json({ error: 'OAuth service unavailable' });
  }
});

app.get('/api/github/app/info', async (req, res) => {
  try {
    const response = await fetch(`${oauthBaseUrl}/api/github/app/info`);
    const data = await response.json();
    res.json(data);
  } catch (error) {
    logger.error('OAuth proxy error (app info):', error);
    res.status(500).json({ error: 'OAuth service unavailable' });
  }
});

// GitHub App proxies to OAuth server
app.post('/api/github/app/installation-token', async (req, res) => {
  try {
    const response = await fetch(`${oauthBaseUrl}/api/github/app/installation-token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(req.body)
    });
    const data = await response.json();
    res.status(response.status).json(data);
  } catch (error) {
    logger.error('OAuth proxy error (installation-token):', error);
    res.status(500).json({ error: 'OAuth service unavailable' });
  }
});

app.get('/api/github/app/installation/:installation_id', async (req, res) => {
  try {
    const { installation_id } = req.params;
    const response = await fetch(`${oauthBaseUrl}/api/github/app/installation/${encodeURIComponent(installation_id)}`);
    const data = await response.json();
    res.status(response.status).json(data);
  } catch (error) {
    console.error('OAuth proxy error (installation details):', error);
    res.status(500).json({ error: 'OAuth service unavailable' });
  }
});

// List GitHub App installations (fallback endpoint)
app.get('/api/github/app/installations', async (req, res) => {
  try {
    const response = await fetch(`http://localhost:${OAUTH_PORT}/api/github/app/installations`);
    const data = await response.json();
    res.status(response.status).json(data);
  } catch (error) {
    console.error('OAuth proxy error (installations list):', error);
    res.status(500).json({ error: 'OAuth service unavailable' });
  }
});

// Create repository via GitHub App installation
app.post('/api/github/app/create-repository', async (req, res) => {
  try {
    const response = await fetch(`${oauthBaseUrl}/api/github/app/create-repository`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(req.body)
    });
    const data = await response.json();
    res.status(response.status).json(data);
  } catch (error) {
    console.error('OAuth proxy error (create repository):', error);
    res.status(500).json({ error: 'OAuth service unavailable' });
  }
});

// Create repository via OAuth user authentication (recommended)
app.post('/api/github/oauth/create-repository', async (req, res) => {
  try {
    const response = await fetch(`${oauthBaseUrl}/api/github/oauth/create-repository`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(req.body)
    });
    const data = await response.json();
    res.status(response.status).json(data);
  } catch (error) {
    console.error('OAuth proxy error (OAuth create repository):', error);
    res.status(500).json({ error: 'OAuth service unavailable' });
  }
});

// Validate OAuth token
app.post('/api/github/oauth/validate', async (req, res) => {
  try {
    const response = await fetch(`${oauthBaseUrl}/api/github/oauth/validate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(req.body)
    });
    const data = await response.json();
    res.status(response.status).json(data);
  } catch (error) {
    logger.error('OAuth proxy error (validate):', error);
    res.status(500).json({ error: 'OAuth service unavailable' });
  }
});

// Refresh OAuth token
app.post('/api/github/oauth/refresh', async (req, res) => {
  try {
    const response = await fetch(`${oauthBaseUrl}/api/github/oauth/refresh`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(req.body)
    });
    const data = await response.json();
    res.status(response.status).json(data);
  } catch (error) {
    logger.error('OAuth proxy error (refresh):', error);
    res.status(500).json({ error: 'OAuth service unavailable' });
  }
});

// Route 3: GitHub App Webhook (proxy to OAuth server)
// GitHub sends events here about installations, pushes, etc.
app.post('/api/github/app/webhook', async (req, res) => {
  try {
    const event = req.headers['x-github-event'];
    logger.info('[GitHub App Webhook] Proxying webhook event:', event);
    
    const response = await fetch(`${oauthBaseUrl}/api/github/app/webhook`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-github-event': req.headers['x-github-event'] || '',
        'x-hub-signature-256': req.headers['x-hub-signature-256'] || '',
        'x-github-delivery': req.headers['x-github-delivery'] || ''
      },
      body: JSON.stringify(req.body)
    });
    const data = await response.json();
    res.status(response.status).json(data);
  } catch (error) {
    logger.error('[GitHub App Webhook] Proxy error:', error);
    res.status(500).json({ error: 'Webhook service unavailable' });
  }
});

// Revoke OAuth token
app.delete('/api/github/oauth/revoke', async (req, res) => {
  try {
    const response = await fetch(`${oauthBaseUrl}/api/github/oauth/revoke`, {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(req.body)
    });
    const data = await response.json();
    res.status(response.status).json(data);
  } catch (error) {
    logger.error('OAuth proxy error (revoke):', error);
    res.status(500).json({ error: 'OAuth service unavailable' });
  }
});

// Serve static files from the dist directory with proper MIME types
app.use(express.static(distPath, {
  setHeaders: (res, filePath) => {
    // Ensure JavaScript modules have correct MIME type
    if (filePath.endsWith('.js') || filePath.endsWith('.mjs')) {
      res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
    }
  }
}));

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'healthy', service: 'redstring-server' });
});

// --- Local Semantic Web Hosting ---

// Resolve universe file path by slug
const getUniverseFilePath = (slug) => {
  const safeSlug = (slug || DEFAULT_UNIVERSE_SLUG).replace(/[^a-z0-9-_]/gi, '').toLowerCase() || DEFAULT_UNIVERSE_SLUG;
  return path.join(process.cwd(), 'universes', safeSlug, 'universe.redstring');
};

// Load JSON-LD (.redstring) safely
const loadUniverseJson = async (slug) => {
  const filePath = getUniverseFilePath(slug);
  const content = await fs.readFile(filePath, 'utf8');
  return JSON.parse(content);
};

// Convert JSON-LD to Turtle using rdflib
const jsonldToTurtle = async (json, baseUri) => {
  return new Promise((resolve, reject) => {
    try {
      const store = $rdf.graph();
      const jsonString = typeof json === 'string' ? json : JSON.stringify(json);
      // Parse JSON-LD directly into the rdflib store
      $rdf.parse(jsonString, store, baseUri, 'application/ld+json');
      $rdf.serialize(undefined, store, baseUri, 'text/turtle', (err, result) => {
        if (err) return reject(err);
        resolve(result || '');
      });
    } catch (e) {
      reject(e);
    }
  });
};

// Serve JSON-LD
app.get(['/semantic/universe.jsonld', '/semantic/:slug/universe.jsonld'], async (req, res) => {
  try {
    const slug = req.params.slug || DEFAULT_UNIVERSE_SLUG;
    const data = await loadUniverseJson(slug);
    res.setHeader('Content-Type', 'application/ld+json; charset=utf-8');
    res.status(200).send(JSON.stringify(data, null, 2));
  } catch (err) {
    if (err.code === 'ENOENT') {
      return res.status(404).json({ error: 'Universe not found' });
    }
    console.error('Semantic JSON-LD error:', err);
    res.status(500).json({ error: 'Failed to load universe' });
  }
});

// Serve N-Quads (RDF)
app.get(['/semantic/universe.nq', '/semantic/:slug/universe.nq'], async (req, res) => {
  try {
    const slug = req.params.slug || DEFAULT_UNIVERSE_SLUG;
    const data = await loadUniverseJson(slug);
    const nquads = await jsonld.toRDF(data, { format: 'application/n-quads' });
    res.setHeader('Content-Type', 'application/n-quads; charset=utf-8');
    res.status(200).send(nquads);
  } catch (err) {
    if (err.code === 'ENOENT') {
      return res.status(404).json({ error: 'Universe not found' });
    }
    logger.error('Semantic N-Quads error:', err);
    res.status(500).json({ error: 'Failed to convert universe to N-Quads' });
  }
});

// Serve Turtle (best-effort)
app.get(['/semantic/universe.ttl', '/semantic/:slug/universe.ttl'], async (req, res) => {
  try {
    const slug = req.params.slug || DEFAULT_UNIVERSE_SLUG;
    const data = await loadUniverseJson(slug);
    const baseUri = process.env.SEMANTIC_BASE_URI || `http://localhost:${PORT}/semantic/${slug}/`;
    const turtle = await jsonldToTurtle(data, baseUri);
    res.setHeader('Content-Type', 'text/turtle; charset=utf-8');
    res.status(200).send(turtle);
  } catch (err) {
    if (err.code === 'ENOENT') {
      return res.status(404).json({ error: 'Universe not found' });
    }
    logger.error('Semantic Turtle error:', err);
    res.status(500).json({ error: 'Failed to convert universe to Turtle' });
  }
});

// Update universe via JSON-LD (bidirectional sync entry point)
app.post(['/semantic/universe.jsonld', '/semantic/:slug/universe.jsonld'], async (req, res) => {
  try {
    const slug = req.params.slug || DEFAULT_UNIVERSE_SLUG;
    const body = req.body;
    if (!body || typeof body !== 'object') {
      return res.status(400).json({ error: 'Expected JSON-LD body' });
    }
    // Basic validation: must include @context
    if (!body['@context']) {
      return res.status(422).json({ error: 'Missing @context in JSON-LD' });
    }
    const filePath = getUniverseFilePath(slug);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, JSON.stringify(body, null, 2), 'utf8');
    res.status(200).json({ status: 'ok', slug, path: filePath });
  } catch (err) {
    logger.error('Semantic JSON-LD write error:', err);
    res.status(500).json({ error: 'Failed to write universe' });
  }
});

// Minimal SPARQL endpoint placeholder (future enhancement)
app.post(['/sparql', '/semantic/:slug/sparql'], (req, res) => {
  res.status(501).json({ error: 'SPARQL endpoint not implemented yet. Use /semantic/* JSON-LD or N-Quads for now.' });
});

// GitHub App callback route - log and redirect to frontend with params
app.get('/github/app/callback', (req, res) => {
  const { installation_id, setup_action, state } = req.query;
  
  logger.debug('[GitHub App Callback] ===== CALLBACK RECEIVED =====');
  logger.debug('[GitHub App Callback] Query params:', req.query);
  logger.debug('[GitHub App Callback] Headers:', {
    'user-agent': req.headers['user-agent'],
    'referer': req.headers.referer,
    'x-forwarded-for': req.headers['x-forwarded-for'],
    'x-real-ip': req.headers['x-real-ip']
  });
  logger.debug('[GitHub App Callback] Full URL:', req.url);
  logger.debug('[GitHub App Callback] =====================================');
  
  // Redirect to the frontend with the parameters preserved
  const params = new URLSearchParams();
  if (installation_id) params.set('installation_id', installation_id);
  if (setup_action) params.set('setup_action', setup_action);
  if (state) params.set('state', state);
  
  const redirectUrl = `/?${params.toString()}`;
  logger.info('[GitHub App Callback] Redirecting to:', redirectUrl);
  
  res.redirect(redirectUrl);
});

// Handle client-side routing - serve index.html ONLY for non-asset, non-API routes
app.get('*', (req, res, next) => {
  // Don't serve index.html for static assets (they should be handled by express.static above)
  const isAssetRequest = req.path.startsWith('/assets/') || 
                         req.path.endsWith('.js') || 
                         req.path.endsWith('.css') || 
                         req.path.endsWith('.map') ||
                         req.path.endsWith('.svg') ||
                         req.path.endsWith('.png') ||
                         req.path.endsWith('.jpg') ||
                         req.path.endsWith('.ico');
  
  if (isAssetRequest) {
    // If we get here, the file doesn't exist - return 404
    logger.warn(`Asset not found: ${req.path}`);
    return res.status(404).send('Asset not found');
  }
  
  // Serve index.html for client-side routing
  res.sendFile(path.join(distPath, 'index.html'));
});

app.listen(PORT, () => {
  logger.info(`🚀 Redstring server running on port ${PORT}`);
  logger.info(`📋 Health check: http://localhost:${PORT}/health`);
});

export default app;

