# Dev3000 Development Makefile
# Simplified development workflow for Docker-based dev3000

.PHONY: help dev-up dev-down dev-logs dev-rebuild clean

# Default target
.DEFAULT_GOAL := help

# Detect environment and set CDP URL
IS_WSL2 := $(shell grep -qi microsoft /proc/version 2>/dev/null && echo 1 || echo 0)
ifeq ($(IS_WSL2),1)
    HOST_IP := $(shell ip route | grep default | awk '{print $$3}' || echo "127.0.0.1")
    CDP_URL := http://$(HOST_IP):9222
    CDP_CHECK_URL := http://$(HOST_IP):9222/json/version
else
    CDP_URL := http://localhost:9222
    CDP_CHECK_URL := http://localhost:9222/json/version
endif

## ========== Quick Start ==========

help: ## Show this help message
	@echo "Dev3000 Development Commands"
	@echo ""
	@echo "Quick Start:"
	@echo "  make dev-up        - Start development environment"
	@echo "  make dev-down      - Stop development environment"
	@echo "  make dev-logs      - Follow container logs"
	@echo ""
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | \
		awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-15s\033[0m %s\n", $$1, $$2}'

## ========== Docker Development ==========

dev-up: ## Start dev3000 in Docker (launches Chrome automatically)
	@echo "Starting dev3000 development environment..."
	@echo ""
	@echo "Step 1: Starting Docker containers..."
	@docker compose up -d
	@echo ""
	@echo "Step 2: Waiting for Next.js to be ready..."
	@i=1; while [ $$i -le 60 ]; do \
		if curl -s http://localhost:3000 > /dev/null 2>&1; then \
			echo "✅ Next.js is ready!"; \
			break; \
		fi; \
		if [ $$i -eq 60 ]; then \
			echo "⚠️  Timeout waiting for Next.js (60s)"; \
			echo "Services may still be starting. Check logs with: make dev-logs"; \
		fi; \
		echo -n "."; \
		sleep 1; \
		i=$$((i + 1)); \
	done
	@echo ""
	@if [ "$$NEXT_READY" = "1" ]; then \
		echo "Step 2.5: Warming common routes (compile ahead of time)..."; \
		for route in "/" "/demos/counter" "/demos/server-actions" "/demos/parallel-routes"; do \
			START_RT=$$(date +%s); \
			echo "  → warming http://localhost:3000$$route"; \
			code=$$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:3000$$route" || echo 000); \
			END_RT=$$(date +%s); EL=$$((END_RT-START_RT)); \
			if [ "$$code" -ge 200 ] && [ "$$code" -lt 300 ]; then \
				echo "    warmed ($$code) in $${EL}s ✅"; \
			else \
				echo "    warmed ($$code) in $${EL}s ⚠️"; \
			fi; \
		done; \
	else \
		echo "Step 2.5: Skipping route warming (Next not ready)"; \
	fi
	@echo ""
	@echo "Step 3: Launching Chrome with CDP..."
	@$(MAKE) start-chrome-cdp
	@echo ""
	@echo "Step 4: Verifying CDP connection from host..."
	@if curl -s $(CDP_CHECK_URL) > /dev/null 2>&1; then \
		echo "✅ CDP connection verified ($(CDP_CHECK_URL))"; \
		BROWSER_VER=$$(curl -s $(CDP_CHECK_URL) | grep -o '"Browser":"[^"]*"' | cut -d'"' -f4); \
		echo "   Browser: $$BROWSER_VER"; \
	else \
		echo "⚠️  Could not verify CDP connection ($(CDP_CHECK_URL))"; \
		echo "Dev3000 may not be able to monitor browser events."; \
	fi
	@echo ""
	@echo "✅ Development environment started"
	@echo ""
	@echo "Access points:"
	@echo "  Next.js App:    http://localhost:3000"
	@echo "  Dev3000 UI:     http://localhost:3684"
	@echo "  Logs Viewer:    http://localhost:3684/logs"
	@echo ""
	@echo "View logs: make dev-logs"
	@echo "Stop:      make dev-down"

dev-down: ## Stop dev3000 Docker environment
	@echo "Stopping development environment..."
	@docker compose down
	@echo ""
	@echo "✅ Development environment stopped"
	@echo ""
	@echo "⚠️  Note: Chrome CDP browser is still running"
	@echo "To close Chrome, close the Chrome window manually or run:"
	@if [ "$(IS_WSL2)" = "1" ]; then \
		echo "  powershell.exe -Command \"Get-Process chrome | Where-Object {\$$_.CommandLine -like '*remote-debugging-port*'} | Stop-Process\""; \
	else \
		echo "  pkill -f 'chrome.*remote-debugging-port'"; \
	fi

dev-logs: ## Follow Docker container logs
	@docker compose logs -f

dev-rebuild: ## Rebuild and restart Docker environment
	@echo "Rebuilding development environment..."
	@docker compose down
	@DOCKER_BUILDKIT=1 docker compose build --no-cache
	@$(MAKE) dev-up

dev-rebuild-fast: ## Fast rebuild using cache (for minor changes)
	@echo "Fast rebuilding development environment (with cache)..."
	@docker compose down
	@DOCKER_BUILDKIT=1 docker compose build
	@$(MAKE) dev-up

clean: ## Clean up Docker resources and build artifacts
	@echo "Cleaning up..."
	@docker compose down -v
	@rm -rf example/*/node_modules example/*/.next
	@rm -rf frontend/node_modules frontend/.next
	@echo "✅ Cleanup complete"

clean-frontend: ## Clear frontend directory (keeps only .keep file)
	@echo "Clearing frontend directory..."
	@docker compose down 2>/dev/null || true
	@if [ -d "frontend" ]; then \
		find frontend -mindepth 1 -maxdepth 1 ! -name '.keep' -print0 | xargs -0 rm -rf 2>/dev/null || true; \
		echo "# Frontend deployment directory" > frontend/.keep; \
		echo "✅ Frontend directory cleared"; \
		echo "   Only .keep file remains"; \
		echo ""; \
		echo "Deploy an example with: make deploy-frontend APP=nextjs16"; \
	else \
		echo "❌ Error: frontend directory does not exist"; \
	fi

## ========== Frontend Deployment ==========

# deploy-frontend: Copies example app to frontend/ and sets up .dev3000 reference
# The .dev3000 directory simulates how production users would include dev3000 as a git submodule
# This allows Dockerfile.dev to build dev3000 from the submodule during container builds
# Process:
#   1. Copies example app to frontend/ directory (rsync, excluding build outputs)
#   2. Creates frontend/.dev3000/ with dev3000 source code (simulates: git submodule add)
# Production setup: git submodule add https://github.com/automationjp/dev3000 frontend/.dev3000
deploy-frontend: ## Deploy example app to frontend directory (e.g., make deploy-frontend APP=nextjs16)
	@if [ -z "$(APP)" ]; then \
		echo "❌ Error: APP parameter is required"; \
		echo ""; \
		echo "Usage: make deploy-frontend APP=<app-name>"; \
		echo ""; \
		echo "Available apps in example/:"; \
		ls -1 example/ | sed 's/^/  - /'; \
		exit 1; \
	fi; \
	if [ ! -d "example/$(APP)" ]; then \
		echo "❌ Error: example/$(APP) does not exist"; \
		echo ""; \
		echo "Available apps:"; \
		ls -1 example/ | sed 's/^/  - /'; \
		exit 1; \
	fi; \
	echo "📦 Deploying example/$(APP) to frontend/..."; \
	rm -rf frontend; \
	mkdir -p frontend; \
	rsync -av --exclude='node_modules' --exclude='.next' --exclude='out' --exclude='.pnpm-store' example/$(APP)/ frontend/; \
	echo "✅ Copied example/$(APP) to frontend/"; \
	echo ""; \
	echo "🔗 Setting up frontend/.dev3000 (dev3000 reference)..."; \
	echo "   This simulates a user's dev3000 git submodule setup"; \
	echo "   Purpose: Dockerfile.dev references .dev3000 for building dev3000 CLI"; \
	echo "   Production users: git submodule add https://github.com/automationjp/dev3000 frontend/.dev3000"; \
	echo "   Development setup: Copy dev3000 source to frontend/.dev3000/"; \
	rm -rf frontend/.dev3000/src frontend/.dev3000/mcp-server frontend/.dev3000/www; \
	rsync -av --exclude='node_modules' --exclude='.next' --exclude='dist' --exclude='.pnpm-store' src mcp-server frontend/.dev3000/; \
	mkdir -p frontend/.dev3000/scripts; \
	cp scripts/docker-entrypoint.sh frontend/.dev3000/scripts/; \
	chmod +x frontend/.dev3000/scripts/docker-entrypoint.sh; \
	cp package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.json biome.json Makefile docker-compose.yml frontend/.dev3000/; \
	echo ""; \
	echo "✅ Deployed example/$(APP) to frontend/"; \
	echo "✅ Created frontend/.dev3000 reference (simulating user setup)"; \
	echo ""; \
	echo "Frontend directory contents:"; \
	du -sh frontend/ 2>/dev/null || echo "  ⚠️  Could not determine frontend/ size"; \
	if [ -d "frontend/.dev3000" ]; then \
		du -sh frontend/.dev3000/ 2>/dev/null || echo "  ⚠️  Could not determine frontend/.dev3000/ size"; \
	else \
		echo "  ⚠️  frontend/.dev3000 not created"; \
	fi; \
	echo ""; \
	echo "📝 Note: Dependencies will be installed automatically by Docker on first run"; \
	echo ""; \
	echo "Next steps:"; \
	echo "  make dev-rebuild  - Rebuild Docker image with new frontend"; \
	echo "  make dev-up       - Start development environment"

deploy-and-start: ## Deploy example and start dev environment (e.g., make deploy-and-start APP=nextjs16)
	@if [ -z "$(APP)" ]; then \
		echo "❌ Error: APP parameter is required"; \
		echo ""; \
		echo "Usage: make deploy-and-start APP=<app-name>"; \
		echo ""; \
		echo "Available apps in example/:"; \
		ls -1 example/ | sed 's/^/  - /'; \
		exit 1; \
	fi
	@echo "🚀 Deploying and starting $(APP)..."
	@echo ""
	@$(MAKE) deploy-frontend APP=$(APP)
	@echo ""
	@echo "🔨 Rebuilding Docker image..."
	@$(MAKE) dev-rebuild

list-examples: ## List available example apps
	@echo "Available example apps:"
	@ls -1 example/ | sed 's/^/  - /'
	@echo ""
	@echo "Deploy with: make deploy-frontend APP=<app-name>"
	@echo "Deploy and start with: make deploy-and-start APP=<app-name>"

## ========== Chrome CDP Management ==========

start-chrome-cdp: ## Start Chrome with CDP (auto-detects WSL/Linux/macOS)
	@echo "🌐 Starting Chrome with CDP..."
	@if [ "$(IS_WSL2)" = "1" ]; then \
		if curl -s $(CDP_CHECK_URL) > /dev/null 2>&1; then \
			echo "✅ Chrome already running with CDP on port 9222"; \
			BROWSER_VER=$$(curl -s $(CDP_CHECK_URL) | grep -o '"Browser":"[^"]*"' | cut -d'"' -f4); \
			echo "   Version: $$BROWSER_VER"; \
		else \
			echo "Detected WSL2 environment"; \
			echo "Starting Windows Chrome from WSL..."; \
			echo "   Detected WSL2 host IP: $(HOST_IP)"; \
			APP_URL="http://$(HOST_IP):3000/"; \
			echo "   Application URL: $$APP_URL"; \
			powershell.exe -Command "Start-Process chrome.exe -ArgumentList '--remote-debugging-port=9222','--remote-debugging-address=0.0.0.0','--user-data-dir=C:\\temp\\chrome-dev-profile','--no-first-run','--no-default-browser-check','$$APP_URL'" 2>/dev/null || \
			cmd.exe /c "start chrome.exe --remote-debugging-port=9222 --remote-debugging-address=0.0.0.0 --user-data-dir=C:\\temp\\chrome-dev-profile --no-first-run --no-default-browser-check $$APP_URL" 2>/dev/null || \
			echo "⚠️  Failed to start Chrome automatically. Please start Chrome manually:"; \
			echo "   chrome.exe --remote-debugging-port=9222 --remote-debugging-address=0.0.0.0 --user-data-dir=C:\\temp\\chrome-dev-profile $$APP_URL"; \
			sleep 3; \
		fi; \
	elif [ "$$(uname)" = "Darwin" ]; then \
		echo "Detected macOS environment"; \
		open -a "Google Chrome" --args --remote-debugging-port=9222 --user-data-dir=/tmp/chrome-dev-profile --no-first-run --no-default-browser-check http://localhost:3000 & \
		echo "✅ Chrome started with CDP"; \
		sleep 3; \
	else \
		echo "Detected Linux environment"; \
		google-chrome --remote-debugging-port=9222 --user-data-dir=/tmp/chrome-dev-profile --no-first-run --no-default-browser-check http://localhost:3000 > /dev/null 2>&1 & \
		echo "✅ Chrome started with CDP"; \
		sleep 3; \
	fi; \
	echo ""; \
	echo "Waiting for CDP endpoint to be ready..."; \
	i=1; while [ $$i -le 5 ]; do \
		if curl -s $(CDP_CHECK_URL) > /dev/null 2>&1; then \
			echo "✅ CDP endpoint ready!"; \
			break; \
		fi; \
		if [ $$i -eq 5 ]; then \
			echo "⚠️  CDP endpoint not ready after 5 seconds"; \
			echo "   Chrome may still be starting. Check manually: $(CDP_CHECK_URL)"; \
		fi; \
		echo -n "."; \
		sleep 1; \
		i=$$((i + 1)); \
	done

stop-chrome-cdp: ## Stop Chrome CDP process
	@echo "Stopping Chrome CDP..."
	@if [ "$(IS_WSL2)" = "1" ]; then \
		powershell.exe -Command "Get-Process chrome | Where-Object {\$$_.CommandLine -like '*remote-debugging-port*'} | Stop-Process" 2>/dev/null; \
	else \
		pkill -f 'chrome.*remote-debugging-port' 2>/dev/null; \
	fi
	@echo "✅ Chrome stopped"

## ========== Information ==========

status: ## Show development environment status
	@echo "=== Dev3000 Status ==="
	@echo ""
	@echo "Docker Containers:"
	@docker compose ps
	@echo ""
	@echo "Chrome CDP:"
	@if curl -s $(CDP_CHECK_URL) > /dev/null 2>&1; then \
		echo "  ✅ Chrome running with CDP on port 9222 ($(CDP_URL))"; \
		BROWSER_VER=$$(curl -s $(CDP_CHECK_URL) | grep -o '"Browser":"[^"]*"' | cut -d'"' -f4); \
		CDP_WS_URL=$$(curl -s $(CDP_CHECK_URL) | grep -o '"webSocketDebuggerUrl":"[^"]*"' | cut -d'"' -f4); \
		echo "  Version: $$BROWSER_VER"; \
		echo "  WebSocket URL: $$CDP_WS_URL"; \
	else \
		echo "  ❌ Chrome CDP not accessible ($(CDP_URL))"; \
	fi
	@echo ""
	@echo "CDP Integration:"
	@if docker ps --format '{{.Names}}' | grep -q 'dev3000'; then \
		CDP_ENV=$$(docker inspect dev3000 2>/dev/null | grep -o '"DEV3000_CDP_URL=[^"]*"' | head -1 | cut -d'=' -f2 | tr -d '"' || echo ""); \
		if [ -n "$$CDP_ENV" ]; then \
			echo "  ✅ Container configured with CDP URL"; \
			echo "  URL: $$CDP_ENV"; \
		else \
			echo "  ⚠️  Container running without explicit CDP URL (auto-detect mode)"; \
		fi; \
	else \
		echo "  ❌ Dev3000 container not running"; \
	fi
