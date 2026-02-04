#!/bin/bash
set -e

echo "🏗️ Starting build process..."

# Build main package
echo "📦 Building main package..."
echo "🧹 Cleaning old build artifacts..."
rm -rf dist
bun run build

echo "✅ Build completed successfully!"
