#!/bin/sh

# Startup script for Redstring application
# Starts OAuth server, Bridge daemon, and Main server

echo "🚀 Starting Redstring application..."

# Start OAuth server in background on fixed port 3002
echo "🔐 Starting OAuth server on port 3002..."
OAUTH_PORT=3002 node oauth-server.js &
OAUTH_PID=$!

# Wait a moment for OAuth server to start
sleep 2

# Check if OAuth server is running
if ! kill -0 $OAUTH_PID 2>/dev/null; then
    echo "❌ OAuth server failed to start"
    exit 1
fi

echo "✅ OAuth server started successfully (PID: $OAUTH_PID)"

# Start Bridge daemon in background on port 3001
echo "🤖 Starting AI Bridge daemon on port 3001..."
BRIDGE_PORT=3001 node bridge-daemon.js &
BRIDGE_PID=$!

# Wait a moment for bridge to start
sleep 2

# Check if bridge is running
if ! kill -0 $BRIDGE_PID 2>/dev/null; then
    echo "❌ Bridge daemon failed to start"
    exit 1
fi

echo "✅ AI Bridge daemon started successfully (PID: $BRIDGE_PID)"

# Start main server on Cloud Run port (or 4000 locally)
# This includes basic bridge endpoints but delegates AI agent to bridge-daemon
MAIN_PORT=${PORT:-4000}
echo "🌐 Starting main server (UI + Semantic Web + Basic Bridge) on port $MAIN_PORT..."
# Explicit cloud entrypoint: the main server must accept traffic from the Cloud
# Run front end, so it binds all interfaces here (it defaults to loopback).
HOST=${HOST:-0.0.0.0} PORT=$MAIN_PORT node deployment/app-semantic-server.js
