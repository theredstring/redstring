#!/bin/sh

# Startup script for Redstring application
# Starts OAuth server in background, then main server

echo "🚀 Starting Redstring application..."

# Start OAuth server in background on fixed port 3002
echo "🔐 Starting OAuth server on port 3002..."
OAUTH_PORT=3002 node oauth-server.js &
OAUTH_PID=$!

# Wait a moment for OAuth server to start
sleep 3

# Check if OAuth server is running
if ! kill -0 $OAUTH_PID 2>/dev/null; then
    echo "❌ OAuth server failed to start"
    exit 1
fi

echo "✅ OAuth server started successfully (PID: $OAUTH_PID)"

# Start main server on Cloud Run port (or 4000 locally)
MAIN_PORT=${PORT:-4000}
echo "🌐 Starting app + semantic server on port $MAIN_PORT..."
PORT=$MAIN_PORT node deployment/app-semantic-server.js
