#!/bin/bash
set -e

echo "🧪 Starting canary test process..."

# Build main package
echo "📦 Building main package..."
pnpm run build

# Build and typecheck mcp-server
echo "🏗️ Building and typechecking mcp-server..."
cd mcp-server
pnpm run build
cd ..

# Pack and install
echo "📦 Packing and installing globally..."
pnpm pack
PACKAGE_FILE="dev3000-$(node -p "require('./package.json').version").tgz"
pnpm install -g "file:$(pwd)/$PACKAGE_FILE"

echo "✅ Canary test completed successfully!"