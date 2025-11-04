# Reference Files for dev3000 Integration

This directory contains reference configuration files for integrating dev3000 into your own Next.js project.

## Files in this directory

### 📄 docker-compose.yml
Docker Compose configuration for dev3000 + Next.js development environment.

**Copy to:** `your-project-root/docker-compose.yml`

**Purpose:** Defines the dev3000 container with proper ports, environment variables, and build configuration.

### 📄 .env.example
Environment variables template for docker-compose.yml configuration.

**Copy to:** `your-project-root/.env`

**Purpose:**
- CDP (Chrome DevTools Protocol) configuration
- Enables socat proxy for localhost CDP forwarding
- Provides sensible defaults for all environments

**Key settings:**
- `DEV3000_CDP=1` - Enable CDP monitoring
- `DEV3000_CDP_URL=http://host.docker.internal:9222` - Chrome CDP URL
- `DEV3000_CDP_PROXY=socat` - Enable socat proxy (recommended)

**How socat proxy works:**
```
1. Chrome on host: localhost:9222
2. Docker maps: host.docker.internal:9222 → host's localhost:9222
3. socat in container: localhost:9222 → host.docker.internal:9222
4. dev3000 connects to: http://localhost:9222 (via socat)
5. Chrome sees "localhost" → Host header check passes ✅
```

### 📄 Makefile
Convenient make commands for Docker development workflow.

**Copy to:** `your-project-root/Makefile`

**Commands:**
- `make dev-up` - Start dev3000 with Chrome CDP
- `make dev-down` - Stop all services
- `make dev-rebuild` - Rebuild Docker image
- `make dev-logs` - View container logs

### 📄 Dockerfile.dev
Multi-stage Dockerfile that builds dev3000 and your Next.js application.

**Copy to:** `your-project/frontend/Dockerfile.dev`

**Features:**
- Builds dev3000 from .dev3000 submodule
- Copies all necessary dependencies
- Includes user application files
- Optimized for development with hot reload

### 📂 scripts/docker-entrypoint.sh
Container entrypoint script that handles dependency installation and starts dev3000.

**Copy to:** `your-project/frontend/scripts/docker-entrypoint.sh`

**Purpose:** Automatically installs dependencies on first run and starts dev3000 with your application.

### 📄 .npmrc
pnpm configuration file that enforces package manager usage.

**Copy to:** `your-project/frontend/.npmrc`

**Purpose:**
- Enforces pnpm as the only allowed package manager
- Prevents accidental generation of package-lock.json or yarn.lock
- Maintains workspace isolation for example projects
- Optimizes dependency installation in Docker

**What it does:**
- Blocks `npm install` and `yarn install` commands
- Only allows `pnpm install`
- Prevents wrong lock files from being committed

## How to use these files

See the [INTEGRATION_GUIDE.md](../INTEGRATION_GUIDE.md) for step-by-step instructions.

### Quick integration steps:

```bash
# From your project's frontend directory
cd /path/to/your-project/frontend

# 1. Add dev3000 as submodule
git submodule add https://github.com/automationjp/dev3000 .dev3000

# 2. Copy reference files
mkdir -p scripts
cp .dev3000/example/nextjs16/reference/scripts/docker-entrypoint.sh scripts/
cp .dev3000/example/nextjs16/reference/Dockerfile.dev ./
cp .dev3000/example/nextjs16/reference/docker-compose.yml ../
cp .dev3000/example/nextjs16/reference/Makefile ../

# 3. Build and start
cd ..
make dev-rebuild
make dev-up
```

## Customization

After copying these files, you can customize them for your project:

### docker-compose.yml
- Change ports if needed
- Add environment variables for your app
- Adjust resource limits

### Dockerfile.dev
- Add additional dependencies
- Modify build steps for your framework
- Add custom build arguments

### Makefile
- Add project-specific commands
- Modify default ports or paths

## Support

For detailed documentation, see:
- [Docker Setup Guide](../../docs/user-guide/docker-setup.md)
- [Integration Guide](../INTEGRATION_GUIDE.md)
- [Main README](../README.md)
