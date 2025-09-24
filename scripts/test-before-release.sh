#!/bin/bash
set -e

echo "🧪 Running pre-release tests..."

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Run standard tests
echo -e "${YELLOW}Running unit tests...${NC}"
pnpm run test

# Build and pack
echo -e "${YELLOW}Building and packing...${NC}"
./scripts/build.sh

# Clean up old tarballs
rm -f dev3000-*.tgz

# Create fresh tarball
pnpm pack

# Get the tarball name
TARBALL=$(ls -1t dev3000-*.tgz | head -1)

# Test 1: Clean npm global install (most common scenario)
echo -e "${YELLOW}Testing clean npm global install...${NC}"
TEST_HOME=$(mktemp -d)
export npm_config_prefix="$TEST_HOME/npm-global"
mkdir -p "$npm_config_prefix"
export PATH="$npm_config_prefix/bin:$PATH"

# Install dev3000 globally with npm
if npm install -g "./$TARBALL" > /dev/null 2>&1; then
    # Test that it runs
    if d3k --version | grep -q "dev3000"; then
        echo -e "${GREEN}✅ Clean npm install test passed${NC}"
    else
        echo -e "${RED}❌ d3k command failed to run${NC}"
        exit 1
    fi
else
    echo -e "${RED}❌ Failed to install with npm${NC}"
    exit 1
fi

# Cleanup
rm -rf "$TEST_HOME"

# Test 2: MCP server startup with minimal environment
echo -e "${YELLOW}Testing MCP server startup...${NC}"
TEST_DIR=$(mktemp -d)
cd "$TEST_DIR"

# Create minimal test app
cat > package.json << EOF
{
  "name": "test-app",
  "scripts": {
    "dev": "node -e 'console.log(\"Test server running\"); setInterval(() => {}, 1000)'"
  }
}
EOF

# Run d3k with timeout and capture output
OUTPUT_FILE=$(mktemp)
timeout 20s d3k --debug --servers-only > "$OUTPUT_FILE" 2>&1 || EXIT_CODE=$?

# Check if MCP server started
if grep -q "MCP Server:" "$OUTPUT_FILE" || grep -q "Development environment ready" "$OUTPUT_FILE"; then
    echo -e "${GREEN}✅ MCP server startup test passed${NC}"
else
    echo -e "${RED}❌ MCP server failed to start${NC}"
    echo "Debug output:"
    cat "$OUTPUT_FILE"
    exit 1
fi

# Cleanup
cd - > /dev/null
rm -rf "$TEST_DIR"
rm -f "$OUTPUT_FILE"

# Test 3: Run the TypeScript clean install test
echo -e "${YELLOW}Running comprehensive clean install tests...${NC}"
if pnpm exec tsx scripts/test-clean-install.ts; then
    echo -e "${GREEN}✅ All clean install tests passed${NC}"
else
    echo -e "${RED}❌ Clean install tests failed${NC}"
    exit 1
fi

# Cleanup tarball
rm -f "$TARBALL"

echo -e "${GREEN}✨ All pre-release tests passed!${NC}"
echo "Safe to proceed with release."