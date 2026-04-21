#!/bin/bash
set -euo pipefail

# Usage:
#   scripts/publish-release.sh [patch|minor|major|x.y.z] [--dry-run] [--allow-branch <name>]
#
# Releases the current package.json version, or (if a bump spec is given) bumps
# first. Guarantees the pushed tag points to a commit whose package.json
# version matches the tag name.

BUMP_SPEC=""
DRY_RUN=false
ALLOWED_BRANCH="main"

while [ $# -gt 0 ]; do
    case "$1" in
        --dry-run)
            DRY_RUN=true
            shift
            ;;
        --allow-branch)
            if [ $# -lt 2 ]; then
                echo "ERROR: --allow-branch requires a value" >&2
                exit 1
            fi
            ALLOWED_BRANCH="$2"
            shift 2
            ;;
        patch|minor|major)
            BUMP_SPEC="$1"
            shift
            ;;
        [0-9]*.[0-9]*.[0-9]*|v[0-9]*.[0-9]*.[0-9]*)
            BUMP_SPEC="$1"
            shift
            ;;
        *)
            echo "ERROR: unknown argument '$1'" >&2
            echo "Usage: $0 [patch|minor|major|x.y.z] [--dry-run] [--allow-branch <name>]" >&2
            exit 1
            ;;
    esac
done

read_pkg_version() {
    node -p "require('./package.json').version"
}

read_committed_version() {
    # $1 = git ref (e.g. HEAD or v0.3.8)
    git show "$1:package.json" | node -e \
        "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.parse(s).version))"
}

# --- Preflight ---

echo "=== Preflight ==="

CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)
if [ "$CURRENT_BRANCH" != "$ALLOWED_BRANCH" ]; then
    echo "ERROR: on branch '$CURRENT_BRANCH', expected '$ALLOWED_BRANCH'" >&2
    echo "       Use --allow-branch '$CURRENT_BRANCH' to override." >&2
    exit 1
fi
echo "✓ on branch $CURRENT_BRANCH"

if [ -n "$(git status --porcelain)" ]; then
    echo "ERROR: working tree is dirty. Commit or stash changes before releasing." >&2
    git status --short >&2
    exit 1
fi
echo "✓ working tree clean"

echo "Fetching origin..."
git fetch origin "$CURRENT_BRANCH" --quiet
BEHIND=$(git rev-list --count "HEAD..origin/$CURRENT_BRANCH")
if [ "$BEHIND" -gt 0 ]; then
    echo "ERROR: HEAD is $BEHIND commit(s) behind origin/$CURRENT_BRANCH. Pull first." >&2
    exit 1
fi
echo "✓ up to date with origin/$CURRENT_BRANCH"

# --- Bump (optional) ---

if [ -n "$BUMP_SPEC" ]; then
    echo ""
    echo "=== Bumping version ($BUMP_SPEC) ==="
    node scripts/bump-version.js "$BUMP_SPEC"
fi

# --- Re-read version (do not trust anything cached before this line) ---

VERSION=$(read_pkg_version)
TAG="v$VERSION"
echo ""
echo "Target version: $VERSION"
echo "Target tag:     $TAG"

# --- Sync (idempotent safety net) ---

echo ""
echo "=== Syncing version strings ==="
node scripts/bump-version.js

# --- Tag-collision check ---

TAG_EXISTS=false
if git rev-parse "$TAG" >/dev/null 2>&1; then
    TAG_EXISTS=true
fi
if git ls-remote --exit-code origin "refs/tags/$TAG" >/dev/null 2>&1; then
    TAG_EXISTS=true
fi

if [ "$TAG_EXISTS" = true ]; then
    echo ""
    echo "⚠️  Tag $TAG already exists (locally and/or on origin)."
    read -p "Delete existing tag and re-release? (y/N) " -n 1 -r REPLY
    echo ""
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        echo "Cancelled."
        exit 1
    fi
    git tag -d "$TAG" 2>/dev/null || true
    git push origin ":refs/tags/$TAG" 2>/dev/null || true
    echo "✓ old tag removed"
fi

# --- Commit (only if needed) ---

COMMIT_MADE=false
if [ -n "$(git status --porcelain)" ]; then
    echo ""
    echo "=== Committing version-bump files ==="
    git add package.json package-lock.json README.md
    # Check that nothing else snuck in (defensive)
    UNEXPECTED=$(git status --porcelain | grep -v '^M  package\.json$' | grep -v '^M  package-lock\.json$' | grep -v '^M  README\.md$' || true)
    if [ -n "$UNEXPECTED" ]; then
        echo "ERROR: unexpected changes outside version files — aborting." >&2
        echo "$UNEXPECTED" >&2
        git reset HEAD package.json package-lock.json README.md
        exit 1
    fi
    git commit -m "chore: bump version to $TAG"
    COMMIT_MADE=true
    echo "✓ commit created"
else
    echo ""
    echo "✓ nothing to commit (files already at $VERSION)"
fi

# --- Pre-tag verification (the core fix) ---

echo ""
echo "=== Verifying HEAD matches target version ==="
HEAD_VERSION=$(read_committed_version HEAD)
if [ "$HEAD_VERSION" != "$VERSION" ]; then
    echo "ERROR: HEAD's package.json says '$HEAD_VERSION' but we're trying to tag '$VERSION'" >&2
    exit 1
fi
echo "✓ HEAD package.json version == $VERSION"

# --- Tag locally ---

git tag "$TAG"
echo "✓ tagged $TAG locally"

# --- Post-tag verification ---

TAG_VERSION=$(read_committed_version "$TAG")
if [ "$TAG_VERSION" != "$VERSION" ]; then
    echo "ERROR: tag $TAG points to a commit with version '$TAG_VERSION' (expected '$VERSION')" >&2
    git tag -d "$TAG"
    exit 1
fi
echo "✓ tag $TAG points to commit with version $VERSION"

# --- Dry run: roll back and exit ---

if [ "$DRY_RUN" = true ]; then
    echo ""
    echo "=== Dry run — rolling back local changes ==="
    git tag -d "$TAG" >/dev/null
    echo "✓ removed local tag $TAG"
    if [ "$COMMIT_MADE" = true ]; then
        git reset --soft HEAD~1
        echo "✓ rolled back commit (files left staged for inspection)"
    fi
    echo ""
    echo "Dry run complete. Would have pushed:"
    echo "  - commit containing package.json@$VERSION"
    echo "  - tag $TAG"
    exit 0
fi

# --- Final confirmation ---

COMMIT_SHA=$(git rev-parse HEAD)
echo ""
echo "About to push:"
echo "  - $CURRENT_BRANCH (commit $COMMIT_SHA)"
echo "  - tag $TAG → same commit"
echo "  - tagged commit's package.json version: $VERSION"
echo ""
read -p "Proceed? (y/N) " -n 1 -r REPLY
echo ""
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "Cancelled. Local state preserved (commit + tag)."
    echo "To undo: git tag -d $TAG && git reset --hard HEAD~1"
    exit 1
fi

# --- Push ---

echo ""
echo "Pushing branch..."
git push origin "$CURRENT_BRANCH"
echo "Pushing tag..."
git push origin "$TAG"

echo ""
echo "✅ Release triggered!"
echo "   Tag:     $TAG"
echo "   Commit:  $COMMIT_SHA"
echo "   Monitor: https://github.com/theredstring/redstring/actions"
