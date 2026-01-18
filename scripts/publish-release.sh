#!/bin/bash

# Exit on error
set -e

# Read version from package.json using node
VERSION=$(node -p "require('./package.json').version")
TAG="v$VERSION"

echo "Detected package version: $VERSION"
echo "Target tag: $TAG"

# Check if tag already exists (locally or remote)
TAG_EXISTS=false
if git rev-parse "$TAG" >/dev/null 2>&1 || git ls-remote origin "refs/tags/$TAG" | grep -q "$TAG"; then
    TAG_EXISTS=true
fi

if [ "$TAG_EXISTS" = true ]; then
    echo "⚠️  Tag $TAG already exists."
    echo "To re-release this version, we need to delete the existing tag."
    read -p "Do you want to delete the existing tag and re-release? (y/N) " -n 1 -r
    echo ""
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        echo "Cancelled."
        exit 1
    fi
    
    echo "Deleting local tag..."
    git tag -d "$TAG" || true
    
    echo "Deleting remote tag..."
    git push origin :refs/tags/$TAG || true
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
