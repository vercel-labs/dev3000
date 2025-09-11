#!/bin/bash

set -e

echo "📦 Starting npm publish process..."

# Get the current version from package.json 
CURRENT_VERSION=$(node -p "require('./package.json').version")

# Check if this is a canary version
if [[ $CURRENT_VERSION == *"-canary" ]]; then
  echo "❌ Current version is canary ($CURRENT_VERSION). Cannot publish canary version."
  echo "💡 Run ./scripts/release.sh first to prepare a release version."
  exit 1
fi

echo "📋 Current version: $CURRENT_VERSION"

# Check if we're on main branch
CURRENT_BRANCH=$(git branch --show-current)
if [ "$CURRENT_BRANCH" != "main" ]; then
  echo "❌ Not on main branch. Currently on: $CURRENT_BRANCH"
  exit 1
fi

# Check if working directory is clean
if [ -n "$(git status --porcelain)" ]; then
  echo "❌ Working directory is not clean. Please commit or stash changes."
  git status --short
  exit 1
fi

# Check if the release tag exists
TAG_NAME="v$CURRENT_VERSION"
if ! git tag -l | grep -q "^$TAG_NAME$"; then
  echo "❌ Release tag $TAG_NAME does not exist."
  echo "💡 Run ./scripts/release.sh first to create the release tag."
  exit 1
fi

# Confirm publication
echo "🚀 Ready to publish dev3000@$CURRENT_VERSION to npm"
read -p "Continue? (y/N): " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
  echo "❌ Publication cancelled"
  exit 1
fi

# Publish to npm
echo "📦 Publishing to npm..."
npm publish --access public

echo "✅ Successfully published dev3000@$CURRENT_VERSION to npm!"

# Increment to next canary version for development
NEXT_VERSION=$(echo $CURRENT_VERSION | awk -F. '{$NF = $NF + 1; print}' OFS=.)
NEXT_CANARY_VERSION="$NEXT_VERSION-canary"

echo "🧪 Bumping to next canary version: $NEXT_CANARY_VERSION"

# Update package.json
npm version $NEXT_CANARY_VERSION --no-git-tag-version

# Run tests to make sure everything still works
echo "🧪 Testing canary version..."
pnpm test

# Commit and push canary version
git add package.json
git commit -m "Bump to v$NEXT_CANARY_VERSION for local development"
git push origin main

echo "🎉 Publication completed successfully!"
echo "📦 Published: dev3000@$CURRENT_VERSION"
echo "🧪 Local development now on: v$NEXT_CANARY_VERSION"