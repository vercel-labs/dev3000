#!/bin/bash
set -e

echo "🧪 Running comprehensive release tests..."

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Cleanup function to kill any stray next-server processes from our test
cleanup_test_processes() {
    echo -e "${YELLOW}Cleaning up any stray test processes...${NC}"

# Kill any next-server processes running on our test tools port (4685)
    # Use lsof to find processes on the port, then kill them
    if command -v lsof &> /dev/null; then
        local pids=$(lsof -ti:4685 2>/dev/null || true)
        if [ -n "$pids" ]; then
            echo "Killing processes on port 4685: $pids"
            echo "$pids" | xargs kill -9 2>/dev/null || true
        fi

        pids=$(lsof -ti:4100 2>/dev/null || true)
        if [ -n "$pids" ]; then
            echo "Killing processes on port 4100: $pids"
            echo "$pids" | xargs kill -9 2>/dev/null || true
        fi
    fi

    # Also kill any orphaned next-server processes from test-app
    # These would have been started by our test and may still be running
    pkill -9 -f "next-server.*test-app" 2>/dev/null || true
    pkill -9 -f "bun run start.*test-app" 2>/dev/null || true

    # Give processes time to die
    sleep 1
}

# Set trap to cleanup on exit (success or failure)
trap cleanup_test_processes EXIT

# Run standard tests
echo -e "${YELLOW}Running unit tests...${NC}"
bun run test

# Build and pack
echo -e "${YELLOW}Building and packing...${NC}"
./scripts/build.sh

# Clean up old tarballs
rm -f dev3000-*.tgz

# Create fresh tarball
TARBALL=$(bun pm pack --quiet)

# Test 1: Clean npm global install (requires bun and platform package on npm)
echo -e "${YELLOW}Testing clean npm global install...${NC}"

# Check if bun is available (required for d3k)
if ! command -v bun &> /dev/null; then
    echo -e "${YELLOW}⚠️  Skipping npm install test - bun is required but not installed${NC}"
    echo -e "${YELLOW}   d3k requires bun runtime. Install with: curl -fsSL https://bun.sh/install | bash${NC}"
else
    # Check if platform package with exact version exists on npm (needed for new compiled binary architecture)
    # Get the required version from package.json
    REQUIRED_VERSION=$(node -p "require('./package.json').optionalDependencies?.['@d3k/darwin-arm64'] || ''")
    PUBLISHED_VERSION=""
    if [ -n "$REQUIRED_VERSION" ]; then
        PUBLISHED_VERSION=$(npm view "@d3k/darwin-arm64@$REQUIRED_VERSION" version 2>/dev/null || true)
    fi

    if [ -z "$REQUIRED_VERSION" ] || [ -z "$PUBLISHED_VERSION" ] || [ "$PUBLISHED_VERSION" != "$REQUIRED_VERSION" ]; then
        echo -e "${YELLOW}⚠️  Skipping npm install test - platform package not yet published to npm${NC}"
        echo -e "${YELLOW}   This is expected for the first release with compiled binary architecture${NC}"
        echo -e "${YELLOW}   Using canary-installed version for subsequent tests${NC}"
    else
        PLATFORM_PUBLISHED="true"
        TEST_HOME=$(mktemp -d)
        export npm_config_prefix="$TEST_HOME/npm-global"
        mkdir -p "$npm_config_prefix"
        export PATH="$npm_config_prefix/bin:$PATH"

        # Install dev3000 globally with npm
        if npm install -g "./$TARBALL"; then
            # Test that it runs
            if d3k --version | grep -q -E "^[0-9]+\.[0-9]+\.[0-9]+"; then
                echo -e "${GREEN}✅ d3k command runs${NC}"
            else
                echo -e "${RED}❌ d3k command failed to run${NC}"
                exit 1
            fi

            if d3k agent-browser --help >/dev/null 2>&1; then
                echo -e "${GREEN}✅ agent-browser resolved and runs${NC}"
            else
                echo -e "${RED}❌ agent-browser failed to run${NC}"
                exit 1
            fi
        else
            echo -e "${RED}❌ Failed to install with npm${NC}"
            exit 1
        fi
    fi
fi

# Test 2: Clean pnpm global install (requires pnpm and platform package on npm)
echo -e "${YELLOW}Testing clean pnpm global install...${NC}"
if [ -z "${PLATFORM_PUBLISHED:-}" ]; then
    echo -e "${YELLOW}⚠️  Skipping pnpm install test - platform package not yet published to npm${NC}"
    echo -e "${YELLOW}   This is expected for the first release with compiled binary architecture${NC}"
else
    if ! command -v pnpm &> /dev/null; then
        echo -e "${YELLOW}⚠️  Skipping pnpm install test - pnpm not installed${NC}"
    else
        TEST_HOME_PNPM=$(mktemp -d)
        export PNPM_HOME="$TEST_HOME_PNPM/pnpm-global"
        mkdir -p "$PNPM_HOME"
        export PATH="$PNPM_HOME:$PATH"

        if pnpm add -g "./$TARBALL"; then
            if d3k --version | grep -q -E "^[0-9]+\.[0-9]+\.[0-9]+"; then
                echo -e "${GREEN}✅ pnpm global install runs d3k${NC}"
            else
                echo -e "${RED}❌ d3k command failed to run (pnpm)${NC}"
                exit 1
            fi

            if d3k agent-browser --help >/dev/null 2>&1; then
                echo -e "${GREEN}✅ agent-browser resolved and runs (pnpm)${NC}"
            else
                echo -e "${RED}❌ agent-browser failed to run (pnpm)${NC}"
                exit 1
            fi
        else
            echo -e "${RED}❌ Failed to install with pnpm${NC}"
            exit 1
        fi
    fi
fi

# Run the TypeScript clean install test
echo -e "${YELLOW}Running comprehensive clean install tests...${NC}"
if bun scripts/test-clean-install.ts; then
    echo -e "${GREEN}✅ All clean install tests passed${NC}"
else
    echo -e "${RED}❌ Clean install tests failed${NC}"
    exit 1
fi

# Cleanup tarball
rm -f "$TARBALL"

# Cleanup test home
rm -rf "$TEST_HOME"
rm -rf "$TEST_HOME_PNPM"

echo -e "${GREEN}✨ All release tests passed!${NC}"
echo "Package is ready for release."
