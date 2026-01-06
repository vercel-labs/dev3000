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

    # Kill any next-server processes running on our test MCP port (4685)
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
    pkill -9 -f "pnpm run start.*test-app" 2>/dev/null || true

    # Give processes time to die
    sleep 1
}

# Set trap to cleanup on exit (success or failure)
trap cleanup_test_processes EXIT

# Run standard tests
echo -e "${YELLOW}Running unit tests...${NC}"
pnpm run test

# Build and pack
echo -e "${YELLOW}Building and packing...${NC}"
./scripts/build.sh

# Clean up old tarballs
rm -f dev3000-*.tgz

# Create fresh tarball
TARBALL=$(pnpm pack 2>&1 | tail -n 1)

# Test 1: Clean npm global install (requires bun and platform package on npm)
echo -e "${YELLOW}Testing clean npm global install...${NC}"

# Check if bun is available (required for d3k)
if ! command -v bun &> /dev/null; then
    echo -e "${YELLOW}⚠️  Skipping npm install test - bun is required but not installed${NC}"
    echo -e "${YELLOW}   d3k requires bun runtime. Install with: curl -fsSL https://bun.sh/install | bash${NC}"
else
    # Check if platform package exists on npm (needed for new compiled binary architecture)
    if ! npm view dev3000-darwin-arm64 version &> /dev/null; then
        echo -e "${YELLOW}⚠️  Skipping npm install test - platform package not yet published to npm${NC}"
        echo -e "${YELLOW}   This is expected for the first release with compiled binary architecture${NC}"
        echo -e "${YELLOW}   Using canary-installed version for subsequent tests${NC}"
    else
        TEST_HOME=$(mktemp -d)
        export npm_config_prefix="$TEST_HOME/npm-global"
        mkdir -p "$npm_config_prefix"
        export PATH="$npm_config_prefix/bin:$PATH"

        # Install dev3000 globally with npm
        if npm install -g "./$TARBALL"; then
            # Test that it runs
            if d3k --version | grep -q -E "^[0-9]+\.[0-9]+\.[0-9]+"; then
                echo -e "${GREEN}✅ Clean npm install test passed${NC}"
            else
                echo -e "${RED}❌ d3k command failed to run${NC}"
                exit 1
            fi
        else
            echo -e "${RED}❌ Failed to install with npm${NC}"
            exit 1
        fi
    fi
fi

# Don't cleanup yet - we need the installed d3k for the next test
# If npm install was skipped, make sure canary-installed d3k is available
if ! command -v d3k &> /dev/null; then
    echo -e "${YELLOW}Using globally installed d3k (from canary build)...${NC}"
fi

# Test 2: MCP server startup with minimal environment
echo -e "${YELLOW}Testing MCP server startup...${NC}"
TEST_DIR=$(mktemp -d)
cd "$TEST_DIR"

# Use high ports (>4000) to avoid conflicts with user's running d3k on port 3000
TEST_APP_PORT=4100
TEST_MCP_PORT=4685

# Create minimal test app
cat > package.json << EOF
{
  "name": "test-app",
  "scripts": {
    "dev": "node -e 'console.log(\"Test server running on port $TEST_APP_PORT\"); setInterval(() => {}, 1000)'"
  }
}
EOF

# Run d3k in background and capture output
OUTPUT_FILE=$(mktemp)
# d3k should be available in PATH from the npm install
d3k --debug --servers-only --no-tui --port $TEST_APP_PORT --port-mcp $TEST_MCP_PORT > "$OUTPUT_FILE" 2>&1 &
D3K_PID=$!

# Wait for MCP server to start (max 20 seconds)
COUNTER=0
while [ $COUNTER -lt 20 ]; do
    if grep -q "MCP server process spawned as singleton background service" "$OUTPUT_FILE" || grep -q "Starting MCP server using bundled Next.js" "$OUTPUT_FILE" || grep -q "MCP server logs:" "$OUTPUT_FILE"; then
        echo -e "${GREEN}✅ MCP server startup test passed${NC}"
        # Send two SIGINTs for graceful shutdown (like Ctrl-C twice)
        kill -INT $D3K_PID 2>/dev/null || true
        sleep 1
        kill -INT $D3K_PID 2>/dev/null || true
        sleep 2
        # If it's still running after graceful shutdown attempt, force kill
        kill $D3K_PID 2>/dev/null || true
        break
    fi
    sleep 1
    COUNTER=$((COUNTER + 1))
done

if [ $COUNTER -eq 20 ]; then
    echo -e "${RED}❌ MCP server failed to start within 20 seconds${NC}"
    echo "Debug output:"
    head -50 "$OUTPUT_FILE"
    # Send two SIGINTs for graceful shutdown, then force kill if needed
    kill -INT $D3K_PID 2>/dev/null || true
    sleep 1
    kill -INT $D3K_PID 2>/dev/null || true
    sleep 2
    kill $D3K_PID 2>/dev/null || true
    # Force kill any stray next-server processes before exiting
    cleanup_test_processes
    exit 1
fi

# Force kill any lingering next-server processes from this test
# The d3k process may have exited but the MCP server (next-server) can linger
echo -e "${YELLOW}Ensuring all test server processes are stopped...${NC}"
cleanup_test_processes

# Cleanup
cd - > /dev/null
rm -rf "$TEST_DIR"
rm -f "$OUTPUT_FILE"

# Test 3: Test MCP Server logs API
echo -e "${YELLOW}Testing MCP Server logs functionality...${NC}"
if pnpm exec tsx scripts/test-logs-api.ts; then
    echo -e "${GREEN}✅ MCP Server logs tests passed${NC}"
else
    echo -e "${RED}❌ MCP Server logs tests failed${NC}"
    exit 1
fi

# Test 4: Run the TypeScript clean install test
echo -e "${YELLOW}Running comprehensive clean install tests...${NC}"
if pnpm exec tsx scripts/test-clean-install.ts; then
    echo -e "${GREEN}✅ All clean install tests passed${NC}"
else
    echo -e "${RED}❌ Clean install tests failed${NC}"
    exit 1
fi

# Cleanup tarball
rm -f "$TARBALL"

# Cleanup test home
rm -rf "$TEST_HOME"

echo -e "${GREEN}✨ All release tests passed!${NC}"
echo "Package is ready for release."