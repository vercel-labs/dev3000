#!/bin/bash
set -e

echo "🚀 Starting release process..."

# Build and test first
echo "📦 Building..."
pnpm run build

echo "🧪 Running tests..."
pnpm run test

# Get current version
CURRENT_VERSION=$(node -p "require('./package.json').version")
echo "📋 Current version: $CURRENT_VERSION"

# Check if we have any uncommitted changes (excluding package.json version changes)
if git diff --quiet HEAD -- . ':!package.json' && git diff --staged --quiet; then
    echo "✅ Working directory is clean"
else
    echo "❌ You have uncommitted changes (excluding package.json). Please commit or stash them first."
    exit 1
fi

# Calculate what the next version will be
NEXT_VERSION=$(node -e "
    const semver = require('./package.json').version.split('.');
    semver[2] = parseInt(semver[2]) + 1;
    console.log(semver.join('.'));
")

# Check if tag already exists locally or remotely
TAG_NAME="v$NEXT_VERSION"
if git tag -l "$TAG_NAME" | grep -q "$TAG_NAME" || git ls-remote --tags origin | grep -q "refs/tags/$TAG_NAME"; then
    echo "⚠️ Tag $TAG_NAME already exists. Cleaning up..."
    
    # Delete local tag if it exists
    if git tag -l "$TAG_NAME" | grep -q "$TAG_NAME"; then
        git tag -d "$TAG_NAME"
        echo "🗑️ Deleted local tag $TAG_NAME"
    fi
    
    # Delete remote tag if it exists
    if git ls-remote --tags origin | grep -q "refs/tags/$TAG_NAME"; then
        git push --delete origin "$TAG_NAME" || echo "⚠️ Could not delete remote tag (might not exist)"
        echo "🗑️ Deleted remote tag $TAG_NAME"
    fi
fi

# Now do the version bump (this will create a local tag)
echo "⬆️ Bumping version to $NEXT_VERSION..."
pnpm version patch

# Push everything (commit and tags)
echo "📤 Pushing changes and tags..."
git push origin main --tags

# Publish to npm
echo "📦 Publishing to npm..."
pnpm publish --otp=$(op item get npm --otp)

echo "🎉 Release v$NEXT_VERSION completed successfully!"