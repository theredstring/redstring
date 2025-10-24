#!/bin/bash

# Redstring UI React - Local Docker Deployment Script
# Builds and runs the application locally using Docker

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
PURPLE='\033[0;35m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m' # No Color

# Configuration
IMAGE_NAME="redstring-local"
CONTAINER_NAME="redstring-app"
MAIN_PORT=${1:-4001}
OAUTH_PORT=${2:-3003}
BUILD_CACHE=${3:-"true"}

# Header
echo -e "${BOLD}${BLUE}🐳 Redstring UI React - Local Docker Deployment${NC}"
echo -e "${BLUE}===================================================${NC}"
echo ""

# Validation
if ! command -v docker &> /dev/null; then
    echo -e "${RED}❌ Docker is not installed or not in PATH${NC}"
    echo -e "${YELLOW}Please install Docker: https://docs.docker.com/get-docker/${NC}"
    exit 1
fi

if ! docker info &> /dev/null; then
    echo -e "${RED}❌ Docker daemon is not running${NC}"
    echo -e "${YELLOW}Please start Docker Desktop or Docker daemon${NC}"
    exit 1
fi

echo -e "${BLUE}📋 Deployment Configuration:${NC}"
echo -e "   Image: ${BOLD}${IMAGE_NAME}${NC}"
echo -e "   Container: ${BOLD}${CONTAINER_NAME}${NC}"
echo -e "   Main App Port: ${BOLD}${MAIN_PORT}${NC}"
echo -e "   OAuth Port: ${BOLD}${OAUTH_PORT}${NC}"
echo -e "   Build Cache: ${BOLD}${BUILD_CACHE}${NC}"
echo ""

# Check if container is already running
if docker ps -q -f name=${CONTAINER_NAME} | grep -q .; then
    echo -e "${YELLOW}⚠️  Container '${CONTAINER_NAME}' is already running${NC}"
    read -p "Stop and remove existing container? [y/N]: " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        echo -e "${YELLOW}🛑 Stopping existing container...${NC}"
        docker stop ${CONTAINER_NAME} || true
        docker rm ${CONTAINER_NAME} || true
        echo -e "${GREEN}✅ Existing container removed${NC}"
    else
        echo -e "${YELLOW}⏹️  Deployment cancelled${NC}"
        exit 0
    fi
fi

# Check if image exists and ask about rebuilding
if docker images -q ${IMAGE_NAME} | grep -q .; then
    echo -e "${YELLOW}📦 Image '${IMAGE_NAME}' already exists${NC}"
    read -p "Rebuild image? [y/N]: " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        REBUILD_IMAGE="true"
    else
        REBUILD_IMAGE="false"
    fi
else
    REBUILD_IMAGE="true"
fi

# Build Docker image
if [ "$REBUILD_IMAGE" = "true" ]; then
    echo -e "${YELLOW}🏗️  Building Docker image...${NC}"
    
    # Build with or without cache
    if [ "$BUILD_CACHE" = "false" ]; then
        echo -e "   Building without cache..."
        docker build --no-cache -f deployment/docker/Dockerfile -t ${IMAGE_NAME} .
    else
        echo -e "   Building with cache..."
        docker build -f deployment/docker/Dockerfile -t ${IMAGE_NAME} .
    fi
    
    if [ $? -eq 0 ]; then
        echo -e "${GREEN}✅ Docker image built successfully${NC}"
    else
        echo -e "${RED}❌ Docker build failed${NC}"
        exit 1
    fi
else
    echo -e "${GREEN}✅ Using existing Docker image${NC}"
fi

# Check if ports are available
check_port() {
    local port=$1
    local service=$2
    
    if lsof -Pi :${port} -sTCP:LISTEN -t >/dev/null 2>&1; then
        echo -e "${RED}❌ Port ${port} is already in use (${service})${NC}"
        echo -e "${YELLOW}Please stop the service using port ${port} or use different ports${NC}"
        echo -e "${YELLOW}Usage: $0 [main-port] [oauth-port] [rebuild]${NC}"
        echo -e "${YELLOW}Example: $0 4001 3003 true${NC}"
        exit 1
    fi
}

echo -e "${YELLOW}🔍 Checking port availability...${NC}"
check_port ${MAIN_PORT} "Main App"
check_port ${OAUTH_PORT} "OAuth Server"
echo -e "${GREEN}✅ Ports ${MAIN_PORT} and ${OAUTH_PORT} are available${NC}"

# Create .env file if it doesn't exist
if [ ! -f ".env" ]; then
    echo -e "${YELLOW}📝 Creating .env file template...${NC}"
    cat > .env << EOF
# GitHub OAuth Configuration
GITHUB_CLIENT_ID=your-github-client-id-here
GITHUB_CLIENT_SECRET=your-github-client-secret-here
VITE_GITHUB_CLIENT_ID=your-github-client-id-here

# Server Configuration
PORT=${MAIN_PORT}
OAUTH_PORT=${OAUTH_PORT}
NODE_ENV=production

# Optional: Universe Configuration
UNIVERSE_SLUG=default
SEMANTIC_BASE_URI=http://localhost:${MAIN_PORT}/semantic/
EOF
    echo -e "${YELLOW}⚠️  Please update .env file with your GitHub OAuth credentials${NC}"
    echo -e "${YELLOW}   Get them from: https://github.com/settings/developers${NC}"
    echo ""
fi

# Run Docker container
echo -e "${YELLOW}🚀 Starting Docker container...${NC}"
docker run -d \
    --name ${CONTAINER_NAME} \
    -p ${MAIN_PORT}:4000 \
    -p ${OAUTH_PORT}:3002 \
    --env-file .env \
    --restart unless-stopped \
    ${IMAGE_NAME}

if [ $? -eq 0 ]; then
    echo -e "${GREEN}✅ Container started successfully${NC}"
else
    echo -e "${RED}❌ Failed to start container${NC}"
    exit 1
fi

# Wait for services to start
echo -e "${YELLOW}⏳ Waiting for services to start...${NC}"
sleep 5

# Health checks
echo -e "${YELLOW}🔍 Running health checks...${NC}"

# Check main app health
MAIN_HEALTH_URL="http://localhost:${MAIN_PORT}/health"
if curl -s --max-time 10 "${MAIN_HEALTH_URL}" | grep -q "healthy"; then
    echo -e "   ✅ Main app health check passed"
else
    echo -e "${YELLOW}   ⚠️  Main app health check failed or timed out${NC}"
fi

# Check OAuth server health
OAUTH_HEALTH_URL="http://localhost:${OAUTH_PORT}/health"
if curl -s --max-time 10 "${OAUTH_HEALTH_URL}" | grep -q "oauth-server"; then
    echo -e "   ✅ OAuth server health check passed"
else
    echo -e "${YELLOW}   ⚠️  OAuth server health check failed or timed out${NC}"
fi

# Check OAuth client ID endpoint
OAUTH_CLIENT_URL="http://localhost:${MAIN_PORT}/api/github/oauth/client-id"
if curl -s --max-time 10 "${OAUTH_CLIENT_URL}" | grep -q "clientId\|configured"; then
    echo -e "   ✅ OAuth client ID endpoint responding"
else
    echo -e "${YELLOW}   ⚠️  OAuth client ID endpoint test inconclusive${NC}"
fi

# Show container status
echo -e "${YELLOW}📊 Container Status:${NC}"
docker ps -f name=${CONTAINER_NAME} --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"

# Success message
echo ""
echo -e "${BOLD}${GREEN}🎉 LOCAL DEPLOYMENT COMPLETE!${NC}"
echo -e "${GREEN}===============================${NC}"
echo ""
echo -e "${BLUE}📊 Deployment Summary:${NC}"
echo -e "   Container: ${BOLD}${CONTAINER_NAME}${NC}"
echo -e "   Image: ${BOLD}${IMAGE_NAME}${NC}"
echo -e "   Main App: ${BOLD}http://localhost:${MAIN_PORT}${NC}"
echo -e "   OAuth Server: ${BOLD}http://localhost:${OAUTH_PORT}${NC}"
echo ""
echo -e "${BLUE}🔗 Useful URLs:${NC}"
echo -e "   🌐 Application: ${BOLD}http://localhost:${MAIN_PORT}${NC}"
echo -e "   💚 Health Check: ${BOLD}http://localhost:${MAIN_PORT}/health${NC}"
echo -e "   🔐 OAuth Health: ${BOLD}http://localhost:${OAUTH_PORT}/health${NC}"
echo -e "   🆔 OAuth Client ID: ${BOLD}http://localhost:${MAIN_PORT}/api/github/oauth/client-id${NC}"
echo -e "   📊 Semantic Universe: ${BOLD}http://localhost:${MAIN_PORT}/semantic/universe.jsonld${NC}"
echo ""
echo -e "${BLUE}📋 Management Commands:${NC}"
echo -e "   View logs: ${BOLD}docker logs -f ${CONTAINER_NAME}${NC}"
echo -e "   Stop container: ${BOLD}docker stop ${CONTAINER_NAME}${NC}"
echo -e "   Start container: ${BOLD}docker start ${CONTAINER_NAME}${NC}"
echo -e "   Remove container: ${BOLD}docker rm -f ${CONTAINER_NAME}${NC}"
echo -e "   Shell access: ${BOLD}docker exec -it ${CONTAINER_NAME} sh${NC}"
echo ""
echo -e "${BLUE}🔧 Development Commands:${NC}"
echo -e "   Rebuild and restart: ${BOLD}$0 ${MAIN_PORT} ${OAUTH_PORT} true${NC}"
echo -e "   Different ports: ${BOLD}$0 4001 3003${NC}"
echo -e "   No cache rebuild: ${BOLD}$0 ${MAIN_PORT} ${OAUTH_PORT} false${NC}"
echo ""

# Check if .env needs OAuth credentials
if grep -q "your-github-client-id-here" .env; then
    echo -e "${YELLOW}⚠️  IMPORTANT: Update your .env file with GitHub OAuth credentials${NC}"
    echo -e "${YELLOW}   1. Go to https://github.com/settings/developers${NC}"
    echo -e "${YELLOW}   2. Create a new OAuth App${NC}"
    echo -e "${YELLOW}   3. Set callback URL to: http://localhost:${MAIN_PORT}/oauth/callback${NC}"
    echo -e "${YELLOW}   4. Update .env file with your Client ID and Secret${NC}"
    echo -e "${YELLOW}   5. Restart container: docker restart ${CONTAINER_NAME}${NC}"
    echo ""
fi

echo -e "${GREEN}✨ Your Redstring app is now running locally! ✨${NC}"
echo -e "${CYAN}💡 Open http://localhost:${MAIN_PORT} in your browser to get started${NC}"
