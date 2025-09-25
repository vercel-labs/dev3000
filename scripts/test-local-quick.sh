#!/bin/bash
set -e

echo "🧪 Quick local test of d3k installation..."

# Build and pack
echo "📦 Building..."
./scripts/build.sh
rm -f dev3000-*.tgz
TARBALL=$(pnpm pack 2>&1 | tail -n 1)

# Test in isolated environment
echo "🧪 Testing installation..."
TEST_DIR=$(mktemp -d)
cd $TEST_DIR

# Create minimal package.json
echo '{"name":"test-d3k","private":true}' > package.json

# Install locally
npm install "../$TARBALL"

# Test that d3k works
if npx d3k --version; then
    echo "✅ d3k works!"
else
    echo "❌ d3k failed"
    exit 1
fi

# Cleanup
cd ..
rm -rf $TEST_DIR

echo "✅ Local test passed!"