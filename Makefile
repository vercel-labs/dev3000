# Dev3000 Development Makefile
# Simplified development workflow for Docker-based dev3000

.PHONY: help dev-up dev-down dev-logs dev-rebuild dev-rebuild-fast dev3000-sync dev-rebuild-frontend clean clean-frontend deploy-frontend deploy-and-start list-examples start-chrome-cdp start-chrome-cdp-xplat stop-chrome-cdp status cdp-check dev-build dev-build-fast

# Default target
.DEFAULT_GOAL := help

# Use a single bash shell per recipe to preserve variables like START_TS/END_TS
SHELL := /bin/bash
.ONESHELL:
.SHELLFLAGS := -lc

# Resolve absolute directory of this Makefile for robust cd in recipes (deferred evaluation)
MAKEFILE_DIR = $(dir $(abspath $(lastword $(MAKEFILE_LIST))))

# Detect environment
IS_WSL2 := $(shell grep -qi microsoft /proc/version 2>/dev/null && echo 1 || echo 0)

# CDP URLs always use localhost (WSL2 uses socat proxy in container)
CDP_URL := http://localhost:9222
CDP_CHECK_URL := http://localhost:9222/json/version

## ========== Quick Start ==========

help: ## Show this help message
	@echo "Dev3000 Development Commands"
	@echo ""
	@echo "Quick Start:"
	@echo "  make dev-up        - Start development environment"
	@echo "  make dev-down      - Stop development environment"
	@echo "  make dev-logs      - Follow container logs"
	@echo ""
	@grep -E '^[a-zA-Z0-9_-]+:.*?## .*$$' $(MAKEFILE_LIST) | \
		awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-15s\033[0m %s\n", $$1, $$2}'

## ========== Docker Development ==========

dev-up: ## Start dev3000 in Docker (launches Chrome automatically)
	@START_TS=$$(date +%s); echo "[RUN] Start: $$(date '+%Y-%m-%d %H:%M:%S')"
	@. scripts/make-helpers.sh
	@echo "Starting dev3000 development environment..."
	@echo ""
	@echo "Step 1: Starting Docker containers..."
	@run_cmd "docker compose up" docker compose up -d
	@echo ""
	@echo "Step 2: Waiting for Next.js to be ready..."
	@if [ "$$D3K_LOG_DRY_RUN" = "1" ]; then \
		echo "[DRY-RUN] Skipping readiness wait"; \
	else \
		NEXT_READY=0; i=1; while [ $$i -le 60 ]; do \
			if curl -s http://localhost:3000 > /dev/null 2>&1; then \
				NEXT_READY=1; \
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
		done; \
	fi
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
		@echo "[CDP] Step 3: Launching Chrome with CDP..."
			@APP_URL="http://localhost:3000/"; \
			if ! /usr/bin/env bash -lc 'cd "$(pwd -P 2>/dev/null || pwd)" && . scripts/make-helpers.sh && run_cmd "launch chrome cdp" node scripts/launch-chrome-cdp.js --app-url '"$$APP_URL"' --check-url "$(CDP_CHECK_URL)" --cdp-port 9222'; then \
				echo "[CDP] ⚠️  Chrome launcher exited with error (check logs)"; \
			fi
	@echo ""
	@echo "[CDP] Step 4: Running cdp-check diagnostics (host + container)"; $(MAKE) cdp-check
		@if false; then \
		echo "[CDP][ref] Host curl: OK"; \
		BROWSER_VER=$$(curl -s $(CDP_CHECK_URL) | grep -o '"Browser":"[^"]*"' | cut -d'"' -f4); \
		echo "[CDP][ref] Browser: $$BROWSER_VER"; \
	else \
				if [ "$(IS_WSL2)" = "1" ]; then \
					echo "[CDP][ref] Windows curl.exe check: $(CDP_CHECK_URL)"; \
					WIN_CURL=$$(command -v curl.exe 2>/dev/null || echo "$${WINDIR}\\System32\\curl.exe"); \
					if [ -n "$$WIN_CURL" ]; then \
								echo "[CDP][ref] Windows curl.exe: $$WIN_CURL -sSf $(CDP_CHECK_URL)"; "$$WIN_CURL" -sSf $(CDP_CHECK_URL) > /dev/null 2>&1; RC=$$?; \
							if [ $$RC -eq 0 ]; then \
							BROWSER_VER=$$("$$WIN_CURL" -s $(CDP_CHECK_URL) | sed -n 's/.*\"Browser\":\"\([^\"]*\)\".*/\1/p'); \
							echo "[CDP][ref] Windows curl.exe: OK"; \
							if [ -n "$$BROWSER_VER" ]; then echo "[CDP][ref] Browser: $$BROWSER_VER"; fi; \
						else \
							echo "[CDP][ref] Windows curl.exe: NG (exit=$$RC)"; \
						fi; \
					else \
						echo "[CDP][ref] Windows curl.exe: not found; skip fallback"; \
					fi; \
		else \
				echo "[CDP][ref] Host curl: NG"; \
		fi; \
		fi
		@if false; then \
		# Container-side verification (ensure container running, then curl inside)
		if ! docker ps --format '{{.Names}}' | grep -q '^dev3000$$'; then \
			echo "[CDP] Container not running. Starting dev3000..."; \
			docker compose up -d >/dev/null 2>&1 || true; \
			sleep 1; \
		fi; \
		if docker ps --format '{{.Names}}' | grep -q '^dev3000$$'; then \
			DX_LOCAL_OUT=$$(docker exec dev3000 sh -lc 'curl -sSf http://localhost:9222/json/version 2>/dev/null || true'); \
			DX_PROXY_INFO=$$(docker exec dev3000 sh -lc 'if command -v lsof >/dev/null 2>&1; then lsof -nP -iTCP:9222 -sTCP:LISTEN 2>/dev/null | awk '\''NR>1{print $$1,$$9}'\''; elif command -v ss >/dev/null 2>&1; then ss -ltnp 2>/dev/null | awk '\''/(:|\.)9222(\s|$)/ {print $$0; exit}'\''; fi' || true); \
			if [ -n "$$DX_LOCAL_OUT" ]; then \
				DX_BROWSER=$$(printf "%s" "$$DX_LOCAL_OUT" | sed -n 's/.*\"Browser\":\"\([^\"]*\)\".*/\1/p'); \
				echo "[CDP] ✅ Container: localhost:9222 OK"; \
				if [ -n "$$DX_BROWSER" ]; then echo "[CDP]    Browser(local): $$DX_BROWSER"; fi; \
			else \
				echo "[CDP] ⚠️  Container: localhost:9222 NG"; \
			fi; \
			DX_HOST_RC=$$(docker exec dev3000 sh -lc 'curl -sSf http://host.docker.internal:9222/json/version >/dev/null 2>&1; echo $$?'); \
			if [ "$$DX_HOST_RC" = "0" ]; then \
				echo "[CDP] ✅ Container: host.docker.internal:9222 OK"; \
			else \
				echo "[CDP] ⚠️  Container: host.docker.internal:9222 NG"; \
			fi; \
		else \
			echo "[CDP] ⚠️  Container dev3000 not running; skip container checks"; \
		fi; \
			if [ -n "$$DX_LOCAL_OUT" ] || [ "$$DX_HOST_RC" = "0" ]; then \
				echo "[CDP] ✅ Dev3000 CDP Ready (container reachable)"; \
				if [ -n "$$DX_LOCAL_OUT" ]; then \
					DX_PROXY_PROC=$$(printf "%s" "$$DX_PROXY_INFO" | awk 'NR==1{ if ($$1=="LISTEN") { match($$0,/users:\(\(([^,]+)/,m); if (m[1] != "") print m[1]; else print "" } else { print $$1 } }'); \
					if [ -n "$$DX_PROXY_PROC" ]; then \
						echo "[CDP]    Route: container localhost:9222 → proxy (listener: $$DX_PROXY_PROC) → Windows 127.0.0.1:9222"; \
					else \
						echo "[CDP]    Route: container localhost:9222 → proxy → Windows 127.0.0.1:9222"; \
					fi; \
					echo "[CDP]    Why: Dev3000 connects to CDP from inside the container via localhost:9222 listener"; \
				else \
					echo "[CDP]    Route: container → host.docker.internal:9222 (direct host)"; \
					echo "[CDP]    Why: Dev3000 connects to CDP from inside the container directly to host"; \
				fi; \
			else \
				echo "[CDP] ❌ Dev3000 CDP Not Ready (container cannot reach CDP)"; \
			fi; \
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
	@# Open logs UI automatically (best-effort)
	@if [ "$(IS_WSL2)" = "1" ]; then \
		echo "[LOGS] Opening http://localhost:3684/logs in Windows..."; \
		cmd.exe /C start http://localhost:3684/logs >/dev/null 2>&1 || true; \
	else \
		if command -v xdg-open >/dev/null 2>&1; then \
			echo "[LOGS] Opening http://localhost:3684/logs..."; \
			if ! xdg-open http://localhost:3684/logs >/dev/null 2>&1; then \
				echo "[LOGS] ⚠️  Failed to auto-open; visit: http://localhost:3684/logs"; \
			fi; \
		elif command -v open >/dev/null 2>&1; then \
			echo "[LOGS] Opening http://localhost:3684/logs..."; \
			if ! open http://localhost:3684/logs >/dev/null 2>&1; then \
				echo "[LOGS] ⚠️  Failed to auto-open; visit: http://localhost:3684/logs"; \
			fi; \
		else \
			echo "[LOGS] Visit: http://localhost:3684/logs"; \
		fi; \
	fi
	@END_TS=$$(date +%s); ELAPSED=$$((END_TS-START_TS)); echo "[RUN] End:   $$(date '+%Y-%m-%d %H:%M:%S') (elapsed: $${ELAPSED}s)"

dev-down: ## Stop dev3000 Docker environment
	@START_TS=$$(date +%s); echo "[RUN] Start: $$(date '+%Y-%m-%d %H:%M:%S')"
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
	@END_TS=$$(date +%s); ELAPSED=$$((END_TS-START_TS)); echo "[RUN] End:   $$(date '+%Y-%m-%d %H:%M:%S') (elapsed: $${ELAPSED}s)"

dev-logs: ## Follow Docker container logs
	@START_TS=$$(date +%s); echo "[RUN] Start: $$(date '+%Y-%m-%d %H:%M:%S')"
	@docker compose logs -f
	@END_TS=$$(date +%s); ELAPSED=$$((END_TS-START_TS)); echo "[RUN] End:   $$(date '+%Y-%m-%d %H:%M:%S') (elapsed: $${ELAPSED}s)"

dev-rebuild: ## Rebuild and restart Docker environment
	@START_TS=$$(date +%s); echo "[RUN] Start: $$(date '+%Y-%m-%d %H:%M:%S')"
	@echo "Rebuilding development environment..."
	@docker compose down
	@DOCKER_BUILDKIT=1 docker compose build --no-cache
	@$(MAKE) dev-up
	@END_TS=$$(date +%s); ELAPSED=$$((END_TS-START_TS)); echo "[RUN] End:   $$(date '+%Y-%m-%d %H:%M:%S') (elapsed: $${ELAPSED}s)"

dev-rebuild-fast: ## Fast rebuild using cache (for minor changes)
	@START_TS=$$(date +%s); echo "[RUN] Start: $$(date '+%Y-%m-%d %H:%M:%S')"
	@echo "Fast rebuilding development environment (with cache)..."
	@docker compose down
	@DOCKER_BUILDKIT=1 docker compose build
	@$(MAKE) dev-up
	@END_TS=$$(date +%s); ELAPSED=$$((END_TS-START_TS)); echo "[RUN] End:   $$(date '+%Y-%m-%d %H:%M:%S') (elapsed: $${ELAPSED}s)"

# Build-only targets (do not start or stop containers)
dev-build: ## Build Docker images without cache (no start)
	@START_TS=$$(date +%s); echo "[RUN] Start: $$(date '+%Y-%m-%d %H:%M:%S')"
	@echo "Building images (no-cache)..."
	@DOCKER_BUILDKIT=1 docker compose build --no-cache
	@END_TS=$$(date +%s); ELAPSED=$$((END_TS-START_TS)); echo "[RUN] End:   $$(date '+%Y-%m-%d %H:%M:%S') (elapsed: $${ELAPSED}s)"

dev-build-fast: ## Build Docker images with cache (no start)
	@START_TS=$$(date +%s); echo "[RUN] Start: $$(date '+%Y-%m-%d %H:%M:%S')"
	@echo "Building images (with cache)..."
	@DOCKER_BUILDKIT=1 docker compose build
	@END_TS=$$(date +%s); ELAPSED=$$((END_TS-START_TS)); echo "[RUN] End:   $$(date '+%Y-%m-%d %H:%M:%S') (elapsed: $${ELAPSED}s)"

dev3000-sync: ## Update dev3000 submodule to latest version
	@echo "🔄 Updating dev3000 submodule..."
	@if [ -d "frontend/.dev3000/.git" ]; then \
		cd frontend/.dev3000 && git pull origin main; \
		echo "✅ dev3000 submodule updated to latest"; \
		echo ""; \
		echo "Next step: make dev-rebuild-frontend"; \
	else \
		echo "❌ Error: frontend/.dev3000 is not a git repository"; \
		echo ""; \
		echo "To set up frontend/.dev3000:"; \
		echo "  1. Run: make deploy-frontend APP=nextjs16"; \
		echo "  2. Or manually: cd frontend && git submodule add https://github.com/automationjp/dev3000 .dev3000"; \
		exit 1; \
	fi

dev-rebuild-frontend: ## Rebuild frontend Docker image only (without full restart)
	@echo "🔨 Rebuilding frontend Docker image..."
	@docker compose down
	@DOCKER_BUILDKIT=1 docker compose build
	@echo "✅ Frontend Docker image rebuilt"
	@echo ""
	@echo "Next step: make dev-up"

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
	rm -rf frontend/.dev3000/node_modules frontend/.dev3000/mcp-server/node_modules; \
	echo "   Removed node_modules directories (will be installed by Docker)"; \
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

cdp-check: ## Verify CDP reachability from Windows/WSL/Docker
	@START_TS=$$(date +%s); echo "[RUN] Start: $$(date '+%Y-%m-%d %H:%M:%S')"
	@. scripts/make-helpers.sh
	@echo "=== CDP Reachability Check ==="
	@# Ensure dev3000 container is running for container-side diagnostics
	@if ! docker ps --format '{{.Names}}' | grep -q '^dev3000$$'; then \
		echo "[CDP] dev3000 container not running. Starting via docker compose..."; \
		. scripts/make-helpers.sh; run_cmd "docker compose up" docker compose up -d; \
		sleep 1; \
	fi
	@/usr/bin/env bash -lc 'cd "$(pwd -P 2>/dev/null || pwd)" && . scripts/make-helpers.sh && run_cmd "node scripts/check-cdp.mjs" node scripts/check-cdp.mjs'
	@END_TS=$$(date +%s); ELAPSED=$$((END_TS-START_TS)); echo "[RUN] End:   $$(date '+%Y-%m-%d %H:%M:%S') (elapsed: $${ELAPSED}s)"

## ========== Chrome CDP Management ==========

start-chrome-cdp: ## Start Chrome with CDP (now unified to cross-platform launcher)
	@$(MAKE) start-chrome-cdp-xplat


start-chrome-cdp-xplat: ## Start Chrome with CDP via cross-platform Node launcher
	@echo "🌐 Starting Chrome with CDP (cross-platform launcher)..."
	@echo "PWD: $$(pwd)"
	@echo "CDP check URL: $(CDP_CHECK_URL)"
	@APP_URL="http://localhost:3000/"; \
	echo "App URL: $$APP_URL"; \
	if ! /usr/bin/env bash -lc 'cd "$(pwd -P 2>/dev/null || pwd)" && node scripts/launch-chrome-cdp.js --app-url '"$$APP_URL"' --check-url "$(CDP_CHECK_URL)" --cdp-port 9222'; then \
		echo "[CDP] ⚠️  Chrome launcher exited with error (check logs)"; \
	fi

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
