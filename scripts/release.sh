#!/bin/bash
set -e

echo "🚀 Starting release process..."

# Run comprehensive pre-release tests
echo "🧪 Running pre-release tests (including clean install tests)..."
./scripts/test-before-release.sh

# Get current version and check if it's a canary version
CURRENT_VERSION=$(node -p "require('./package.json').version")
echo "📋 Current version: $CURRENT_VERSION"

# Check if we have any uncommitted changes (excluding package.json and dist/ files)
if git diff --quiet HEAD -- . ':!package.json' ':!dist/' && git diff --staged --quiet; then
    echo "✅ Working directory is clean"
else
    echo "❌ You have uncommitted changes (excluding package.json and dist/). Please commit or stash them first."
    exit 1
fi

# Calculate what the next version will be based on current version
if [[ $CURRENT_VERSION == *"-canary" ]]; then
    # If current version is canary, use the base version
    NEXT_VERSION=$(node -e "
        const version = require('./package.json').version;
        const baseVersion = version.replace('-canary', '');
        console.log(baseVersion);
    ")
else
    # If current version is stable, increment patch
    NEXT_VERSION=$(node -e "
        const semver = require('./package.json').version.split('.');
        semver[2] = parseInt(semver[2]) + 1;
        console.log(semver.join('.'));
    ")
fi

echo "📋 Next version will be: $NEXT_VERSION"
TAG_NAME="v$NEXT_VERSION"

# Function to cleanup existing tags
cleanup_existing_tag() {
    echo "⚠️ Tag $TAG_NAME already exists. Cleaning up..."
    
    # Delete local tag if it exists
    if git tag -l "$TAG_NAME" | grep -q "^$TAG_NAME$"; then
        git tag -d "$TAG_NAME"
        echo "🗑️ Deleted local tag $TAG_NAME"
    fi
    
    # Delete remote tag if it exists
    if git ls-remote --tags origin | grep -q "refs/tags/$TAG_NAME$"; then
        git push --delete origin "$TAG_NAME" 2>/dev/null || echo "⚠️ Could not delete remote tag (might not exist)"
        echo "🗑️ Deleted remote tag $TAG_NAME"
    fi
    
    # Wait a moment for changes to propagate
    sleep 1
}

# Check if tag already exists and clean up if needed
if git tag -l "$TAG_NAME" | grep -q "^$TAG_NAME$" || git ls-remote --tags origin 2>/dev/null | grep -q "refs/tags/$TAG_NAME$"; then
    cleanup_existing_tag
fi

# Update version in package.json manually to avoid pnpm version creating tags automatically
echo "⬆️ Bumping version to $NEXT_VERSION..."
node -e "
    const fs = require('fs');
    const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
    pkg.version = '$NEXT_VERSION';
    fs.writeFileSync('package.json', JSON.stringify(pkg, null, 2) + '\n');
"

# Update changelog
echo "📝 Updating changelog..."
npx tsx scripts/update-changelog.ts "v$NEXT_VERSION"

# Commit version change and changelog
echo "📝 Committing version change and changelog..."
git add package.json www/lib/changelog.ts
git commit -m "Release v$NEXT_VERSION

🤖 Generated with [Claude Code](https://claude.ai/code)

Co-Authored-By: Claude <noreply@anthropic.com>"
echo "✅ Version change committed"

# Check for any formatting changes made by pre-commit hooks and commit them
if ! git diff --quiet; then
    echo "📝 Committing formatting changes from pre-commit hooks..."
    git add -A
    git commit -m "Fix formatting after release version bump

🤖 Generated with [Claude Code](https://claude.ai/code)

Co-Authored-By: Claude <noreply@anthropic.com>"
    echo "✅ Formatting changes committed"
fi

# Ensure we're on main branch and up to date
CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)
echo "📍 Current branch: $CURRENT_BRANCH"

if [ "$CURRENT_BRANCH" != "main" ]; then
    echo "🔀 Switching to main branch..."
    git checkout main
fi

echo "⬇️ Pulling latest changes from origin/main..."
git pull origin main

# Create and push tag manually for better control
echo "🏷️ Creating git tag $TAG_NAME..."
git tag -a "$TAG_NAME" -m "Release v$NEXT_VERSION"
echo "⬆️ Pushing version commit to main..."
git push origin main
echo "⬆️ Pushing tag to origin..."
git push origin "$TAG_NAME"

echo "🎉 Release v$NEXT_VERSION completed successfully!"
echo "📦 Ready for publishing!"
echo "🔄 To publish to npm and bump to next canary version, run: ./scripts/publish.sh"