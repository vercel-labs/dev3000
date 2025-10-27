# Frontend Example - Next.js 16 with dev3000

This is a sample Next.js 16 application demonstrating dev3000 integration for AI-powered development monitoring and debugging.

## Two Use Cases

dev3000 is designed for two different workflows:

### Use Case 1: Try dev3000 (This Repository)

Test dev3000 with this example application:

```
/dev3000/                       # This repository
├── frontend/                   # Deployed example app
│   ├── .dev3000/              # Git submodule (dev3000 source)
│   ├── app/                    # Next.js application
│   ├── Dockerfile.dev          # Docker build configuration
│   └── package.json
├── docker-compose.yml          # Docker Compose configuration
├── Makefile                    # Build and deployment commands
└── example/                    # Example applications
    └── nextjs16/               # This example (source)
```

**Quick Start:**
```bash
# From dev3000 repository root
make deploy-frontend APP=nextjs16   # Deploy example to frontend/
make dev-rebuild                     # Build Docker image
make dev-up                          # Start environment
```

**How it works:**
1. `make deploy-frontend` copies example app to `frontend/` directory
2. Creates `frontend/.dev3000/` as a git submodule pointing to dev3000 source
3. Dockerfile.dev builds dev3000 from the submodule and copies user app files
4. Container runs dev3000 with your application

### Use Case 2: Integrate into Your Project (Production Use)

Use dev3000 as a submodule in your own project:

```
/my-project/                    # Your project root
├── frontend/                   # Your Next.js application
│   ├── .dev3000/              # dev3000 as git submodule
│   ├── app/                    # Your Next.js code
│   ├── Dockerfile.dev          # Copied from dev3000
│   ├── scripts/
│   │   └── docker-entrypoint.sh
│   └── package.json
├── docker-compose.yml          # Copied from dev3000
└── Makefile                    # Copied from dev3000
```

**Setup Steps:**
```bash
# 1. Add dev3000 as a git submodule in your frontend directory
cd /path/to/your-project/frontend
git submodule add https://github.com/automationjp/dev3000 .dev3000

# 2. For WSL2: Disable symlinks to work around path length limits
cd .dev3000
git config core.symlinks false
git checkout -f
cd ..

# 3. Copy reference files to your project
mkdir -p scripts
cp .dev3000/example/nextjs16/reference/scripts/docker-entrypoint.sh scripts/
cp .dev3000/example/nextjs16/reference/Dockerfile.dev ./
cp .dev3000/example/nextjs16/reference/docker-compose.yml ../
cp .dev3000/example/nextjs16/reference/Makefile ../

# 4. Build and start from project root
cd ..
make dev-rebuild
make dev-up
```

**Key Benefits:**
- **Automatic Updates**: Pull latest dev3000 features with `git submodule update`
- **Consistent Environment**: Same Docker setup as development
- **No Manual Installation**: dev3000 built automatically from submodule
- **Version Control**: Pin specific dev3000 versions via submodule commit

**Production Dockerfile Structure:**
```dockerfile
# Your frontend/Dockerfile.dev
FROM node:20-alpine AS base

# Build dev3000 from submodule
FROM base AS dev3000-builder
WORKDIR /build
COPY .dev3000/package.json .dev3000/pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY .dev3000/src ./src
COPY .dev3000/mcp-server ./mcp-server
RUN pnpm run build

# Development stage with your app + dev3000
FROM base AS development
WORKDIR /app/frontend
# Copy built dev3000
COPY --from=dev3000-builder /build/dist /usr/local/lib/dev3000/dist
COPY --from=dev3000-builder /build/mcp-server/.next /usr/local/lib/dev3000/mcp-server/.next
COPY --from=dev3000-builder /build/mcp-server/node_modules /usr/local/lib/dev3000/mcp-server/node_modules
# Copy your application files
COPY package.json ./
COPY app ./app
# ... (rest of your app files)
```

📖 **Full integration guide**: See [INTEGRATION_GUIDE.md](./INTEGRATION_GUIDE.md)

---

## Setup Instructions (Use Case 1: This Repository)

**Prerequisites:**
- `make dev-up` automatically starts Chrome with CDP enabled
- **CDP browser is required** for dev3000 MCP tools to function
  - CDP URL: http://localhost:9222/json/version
  - Without CDP browser, MCP tools (`execute_browser_action`, `fix_my_app`, etc.) will not work

Access your application:
- **Next.js App**: http://localhost:3000
- **dev3000 Logs**: http://localhost:3684/logs
- **MCP Server**: http://localhost:3684
- **Chrome CDP**: http://localhost:9222/json/version

## Quick Update Workflow

To update the example with the latest dev3000 and sample app changes:

```bash
# 1. Update dev3000 submodule to latest version
make dev3000-sync

# 2. Copy Next.js 16 sample app (excluding build outputs)
rsync -av --exclude='node_modules' --exclude='.next' \
  frontend/.dev3000/example/nextjs16/ frontend/

# 3. Rebuild Docker image with updated code
make dev-rebuild-frontend

# 4. Start the development environment
make dev-up
```

**What each step does:**
1. `dev3000-sync` - Pulls latest dev3000 changes from GitHub
2. `rsync` - Copies example app files while preserving .dev3000 directory
3. `dev-rebuild-frontend` - Rebuilds Docker image with updated dependencies
4. `dev-up` - Starts containers and launches Chrome with CDP

## What This Example Demonstrates

This sample application showcases Next.js 16 features that work seamlessly with dev3000 monitoring:

### Core Features
- **App Router** - Next.js 16's file-based routing with Server and Client Components
- **TypeScript** - Full type safety across the application
- **Tailwind CSS** - Utility-first CSS framework for modern styling
- **React 19** - Latest React with new hooks and features

### Demo Pages
1. **Counter Demo** (`/demos/counter`) - Client-side state management
2. **Server Actions** (`/demos/server-actions`) - Form handling and mutations
3. **Context7** (`/demos/context7`) - Library documentation search example
4. **Next.js MCP** (`/demos/nextjs-mcp`) - Builtin MCP features in Next.js 16
5. **Browser Automation** (`/demos/browser-automation`) - CDP integration demo
6. **fix_my_app** (`/demos/fix-my-app`) - AI-powered debugging demonstration
7. **Parallel Routes** (`/demos/parallel-routes`) - Advanced routing patterns

## Development Workflow

### 1. Start Monitoring
```bash
# From project root
make dev-up
```

### 2. Develop Your App
- Edit files in `app/`
- Changes hot-reload via Turbopack
- All activity logged by dev3000

### 3. Debug with AI
```bash
# In Claude Code
"fix my app"
```

### 4. View Logs
- Open http://localhost:3684/logs
- See timeline of all events
- Screenshots linked to errors

### 5. Stop Monitoring
```bash
make dev-down
```

## How dev3000 Helps

When running with dev3000:

1. **Automatic Monitoring**
   - Server logs captured
   - Browser console recorded
   - Network requests tracked
   - Screenshots on errors

2. **AI-Powered Debugging**
   - "fix my app" for analysis
   - Prioritized error reports
   - Exact fix suggestions
   - Interaction replay

3. **MCP Integration**
   - Next.js builtin MCP at `/_next/mcp`
   - dev3000 MCP at http://localhost:3684
   - Context7 for docs
   - CDP browser access

## Configuration

### next.config.js

```javascript
module.exports = {
  experimental: {
    turbo: { /* Turbopack config */ },
    serverActions: { bodySizeLimit: '2mb' },
  },
  logging: {
    fetches: { fullUrl: true }
  },
}
```

### package.json

**Key dependencies:**
- `next: ^16.0.0` - Next.js 16 with builtin MCP
- `react: ^19.0.0` - React 19 with new hooks
- `react-dom: ^19.0.0` - React DOM 19

**Dev dependencies:**
- `@biomejs/biome: ^1.9.4` - Ultra-fast Rust-based linter and formatter
- `typescript: ^5` - TypeScript compiler
- `tailwindcss: ^3` - Utility-first CSS framework
- `@types/*` - TypeScript type definitions

## Best Practices

1. **Server Components First** - Add "use client" only when needed
2. **Server Actions for Mutations** - No API routes required
3. **Code Quality** - Run `npm run check` before committing (format + lint + typecheck)
4. **Error Boundaries** - Better debugging context for dev3000
5. **Logging** - Use console.log/error; dev3000 captures all output

### Why Biome?

Biome is the modern replacement for ESLint and Prettier, written in Rust for maximum speed:
- **10-100x faster** than ESLint/Prettier
- **All-in-one** tool for linting and formatting
- **Next.js optimized** with React hooks and TypeScript support
- **Zero config** needed - works out of the box
- **Fast feedback** during development

## Troubleshooting

### Port Conflicts
- Ports 3000, 3684, 9222 must be available
- Modify `docker-compose.yml` if needed

### Chrome CDP Issues

**Important**: dev3000 MCP tools require a CDP-enabled browser to be running.

1. **Check if CDP browser is running:**
   ```bash
   curl http://localhost:9222/json/version
   ```

2. **If not running, start CDP browser:**
   ```bash
   make start-chrome-cdp
   ```

   Or manually:

   **WSL2/Windows:**
   ```powershell
   chrome.exe --remote-debugging-port=9222 --remote-debugging-address=0.0.0.0 --user-data-dir=C:\temp\chrome-dev-profile http://localhost:3000
   ```

   **macOS:**
   ```bash
   open -a "Google Chrome" --args --remote-debugging-port=9222 --user-data-dir=/tmp/chrome-dev-profile http://localhost:3000
   ```

   **Linux:**
   ```bash
   google-chrome --remote-debugging-port=9222 --user-data-dir=/tmp/chrome-dev-profile http://localhost:3000
   ```

3. **Other CDP troubleshooting:**
   - Ensure Chrome runs on host (not inside Docker)
   - Check `DEV3000_CDP_URL` environment variable
   - Verify `host.docker.internal` works (WSL2/Docker Desktop)

4. **Symptoms of missing CDP browser:**
   - MCP tools (`execute_browser_action`, `fix_my_app`) fail
   - Screenshots cannot be captured
   - Browser errors not detected

### Code Quality

**Formatting** (Biome - Ultra-fast Rust-based formatter):
```bash
npm run format        # Format all files
npm run format:check  # Check formatting without changes
```

**Linting** (Biome - 10-100x faster than ESLint):
```bash
npm run lint       # Check for linting issues
npm run lint:fix   # Auto-fix linting issues
```

**Type Checking** (TypeScript):
```bash
npm run typecheck  # Check for type errors
```

**All Checks** (Format + Lint + TypeCheck):
```bash
npm run check      # Run all quality checks
```

## Learn More

- [Next.js 16 Documentation](https://nextjs.org/docs)
- [dev3000 Repository](https://github.com/automationjp/dev3000)
- [Model Context Protocol](https://modelcontextprotocol.io/)
- [React 19 Documentation](https://react.dev/)
