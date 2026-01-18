#!/bin/bash

# Exit on error
set -e

# Read version from package.json using node
VERSION=$(node -p "require('./package.json').version")
TAG="v$VERSION"

echo "Detected package version: $VERSION"
echo "Target tag: $TAG"

# Check if tag already exists locally
if git rev-parse "$TAG" >/dev/null 2>&1; then
    echo "Error: Tag $TAG already exists locally."
    echo "Please bump the version in package.json before releasing."
    exit 1
fi

# Check if tag already exists on remote
if git ls-remote origin "refs/tags/$TAG" | grep -q "$TAG"; then
    echo "Error: Tag $TAG already exists on remote origin."
    echo "Please bump the version in package.json before releasing."
    exit 1
fi

echo ""
echo "This will:"
echo "1. Create git tag '$TAG'"
echo "2. Push '$TAG' to origin (Triggering GitHub Action Build)"
echo ""
read -p "Are you sure you want to proceed? (y/N) " -n 1 -r
echo ""

if [[ $REPLY =~ ^[Yy]$ ]]; then
    echo "Creating tag..."
    git tag "$TAG"
    
    echo "Pushing tag..."
    git push origin "$TAG"
    
    echo ""
    echo "✅ Release triggered!"
    echo "Monitor the build here: https://github.com/theredstring/redstring/actions"
else
    echo "Cancelled."
    exit 1
fi
