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

# Check if we have any uncommitted changes (excluding package.json and dist/ files)
if git diff --quiet HEAD -- . ':!package.json' ':!dist/' && git diff --staged --quiet; then
    echo "✅ Working directory is clean"
else
    echo "❌ You have uncommitted changes (excluding package.json and dist/). Please commit or stash them first."
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
pnpm publish --no-git-checks --otp=$(op item get npm --otp)

# Calculate canary version (next patch + canary suffix)
CANARY_VERSION=$(node -e "
    const semver = require('./package.json').version.split('.');
    semver[2] = parseInt(semver[2]) + 1;
    console.log(semver.join('.') + '-canary');
")

# Update package.json to canary version for local development
echo "🧪 Bumping to canary version $CANARY_VERSION for local development..."
node -e "
    const fs = require('fs');
    const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
    pkg.version = '$CANARY_VERSION';
    fs.writeFileSync('package.json', JSON.stringify(pkg, null, 2) + '\n');
"

# Commit the canary version bump
git add package.json
git commit -m "Bump to v$CANARY_VERSION for local development

🤖 Generated with [Claude Code](https://claude.ai/code)

Co-Authored-By: Claude <noreply@anthropic.com>"

# Push the canary version commit
git push origin main

echo "🎉 Release v$NEXT_VERSION completed successfully!"
echo "🧪 Local development now on v$CANARY_VERSION"