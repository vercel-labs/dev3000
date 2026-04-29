#!/bin/bash
set -e

echo "🚀 Starting release process..."

# Run comprehensive pre-release tests
echo "🧪 Running pre-release checks..."
bun run test-release

# Get current version and check if it's a canary version
CURRENT_VERSION=$(node -p "require('./package.json').version")
echo "📋 Current version: $CURRENT_VERSION"

# Check if we have any uncommitted changes (excluding package.json, dist/, and bun.lock)
if git diff --quiet HEAD -- . ':!package.json' ':!dist/' ':!bun.lock' && git diff --staged --quiet; then
    echo "✅ Working directory is clean"
else
    echo "❌ You have uncommitted changes (excluding package.json, dist/, and bun.lock). Please commit or stash them first."
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

# Update version in package.json BEFORE building binaries (so version is embedded correctly)
echo "⬆️ Bumping version to $NEXT_VERSION..."
node -e "
    const fs = require('fs');
    const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
    pkg.version = '$NEXT_VERSION';
    // Also update optionalDependencies to match
    pkg.optionalDependencies = pkg.optionalDependencies || {};
    pkg.optionalDependencies['@d3k/darwin-arm64'] = '$NEXT_VERSION';
    pkg.optionalDependencies['@d3k/linux-x64'] = '$NEXT_VERSION';
    pkg.optionalDependencies['@d3k/windows-x64'] = '$NEXT_VERSION';
    fs.writeFileSync('package.json', JSON.stringify(pkg, null, 2) + '\n');
"

# Update platform package versions
echo "⬆️ Updating platform package versions to $NEXT_VERSION..."
node -e "
    const fs = require('fs');
    ['packages/d3k-darwin-arm64/package.json', 'packages/d3k-linux-x64/package.json', 'packages/d3k-windows-x64/package.json'].forEach(pkgPath => {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
        pkg.version = '$NEXT_VERSION';
        fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
    });
"

# Update bun.lock for the optional dependencies
# (bun doesn't add entries for packages that don't exist on npm yet)
echo "🔒 Updating bun.lock for platform packages@$NEXT_VERSION..."
node -e "
    const fs = require('fs');
    let lockfile = fs.readFileSync('bun.lock', 'utf8');

    // Update darwin-arm64
    lockfile = lockfile.replace(
        /('@d3k\/darwin-arm64':\n\s+specifier: )[^\n]+(\n\s+version: )[^\n]+/,
        \"\\\$1$NEXT_VERSION\\\$2$NEXT_VERSION\"
    );
    lockfile = lockfile.replace(
        /'@d3k\/darwin-arm64@[^']+'/g,
        \"'@d3k/darwin-arm64@$NEXT_VERSION'\"
    );

    // Update linux-x64
    lockfile = lockfile.replace(
        /('@d3k\/linux-x64':\n\s+specifier: )[^\n]+(\n\s+version: )[^\n]+/,
        \"\\\$1$NEXT_VERSION\\\$2$NEXT_VERSION\"
    );
    lockfile = lockfile.replace(
        /'@d3k\/linux-x64@[^']+'/g,
        \"'@d3k/linux-x64@$NEXT_VERSION'\"
    );

    // Update windows-x64
    lockfile = lockfile.replace(
        /('@d3k\/windows-x64':\n\s+specifier: )[^\n]+(\n\s+version: )[^\n]+/,
        \"\\\$1$NEXT_VERSION\\\$2$NEXT_VERSION\"
    );
    lockfile = lockfile.replace(
        /'@d3k\/windows-x64@[^']+'/g,
        \"'@d3k/windows-x64@$NEXT_VERSION'\"
    );

    fs.writeFileSync('bun.lock', lockfile);
    console.log('✅ Updated bun.lock');
"

# Build compiled binaries for all platforms (AFTER version bump so version is correct)
./scripts/prepare-platform-packages.sh

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

# Update changelog
echo "📝 Updating changelog..."
bun scripts/update-changelog.ts "v$NEXT_VERSION"

# Generate CHANGELOG.md from changelog.ts
echo "📝 Generating CHANGELOG.md..."
bun scripts/generate-changelog-md.ts

# Commit version change and changelog
echo "📝 Committing version change and changelog..."
git add package.json packages/d3k-darwin-arm64/package.json packages/d3k-linux-x64/package.json packages/d3k-windows-x64/package.json www/package.json www/lib/changelog.ts CHANGELOG.md bun.lock
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

# Final check: commit any remaining uncommitted changes (e.g., from pre-commit hooks)
if ! git diff --quiet || ! git diff --staged --quiet; then
    echo "📝 Committing any remaining changes from pre-commit hooks..."
    git add -A
    git commit -m "Fix remaining formatting after release

🤖 Generated with [Claude Code](https://claude.ai/code)

Co-Authored-By: Claude <noreply@anthropic.com>"
    echo "✅ Remaining changes committed"
fi

# Create and push tag manually for better control
echo "🏷️ Creating git tag $TAG_NAME..."
git tag -a "$TAG_NAME" -m "Release v$NEXT_VERSION"
echo "⬆️ Pushing all commits to main..."
git push origin main
echo "⬆️ Pushing tag to origin..."
git push origin "$TAG_NAME"

echo "🎉 Release v$NEXT_VERSION completed successfully!"
echo "📦 Release commit and tag pushed."
echo "🤖 The GitHub release workflow will publish to npm, create the GitHub release, and bump main back to the next canary version."
