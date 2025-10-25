# Dev3000 Development Makefile
# Simplified development workflow for Docker-based dev3000

.PHONY: help dev-up dev-down dev-logs dev-rebuild clean

# Default target
.DEFAULT_GOAL := help

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
	@cd docker && docker compose up -d
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
	@echo "Step 3: Launching Chrome with CDP..."
	@$(MAKE) start-chrome-cdp
	@echo ""
	@echo "Step 4: Verifying CDP connection from container..."
	@if curl -s http://localhost:9222/json/version > /dev/null 2>&1; then \
		echo "✅ CDP connection verified"; \
		BROWSER_VER=$$(curl -s http://localhost:9222/json/version | grep -o '"Browser":"[^"]*"' | cut -d'"' -f4); \
		echo "   Browser: $$BROWSER_VER"; \
	else \
		echo "⚠️  Could not verify CDP connection"; \
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
	@cd docker && docker compose down
	@echo ""
	@echo "✅ Development environment stopped"
	@echo ""
	@echo "⚠️  Note: Chrome CDP browser is still running"
	@echo "To close Chrome, close the Chrome window manually or run:"
	@if grep -qi microsoft /proc/version 2>/dev/null; then \
		echo "  powershell.exe -Command \"Get-Process chrome | Where-Object {\$$_.CommandLine -like '*remote-debugging-port*'} | Stop-Process\""; \
	else \
		echo "  pkill -f 'chrome.*remote-debugging-port'"; \
	fi

dev-logs: ## Follow Docker container logs
	@cd docker && docker compose logs -f

dev-rebuild: ## Rebuild and restart Docker environment
	@echo "Rebuilding development environment..."
	@cd docker && docker compose down
	@cd docker && docker compose build --no-cache
	@$(MAKE) dev-up

clean: ## Clean up Docker resources and build artifacts
	@echo "Cleaning up..."
	@cd docker && docker compose down -v
	@rm -rf example/nextjs15/node_modules example/nextjs15/.next
	@echo "✅ Cleanup complete"

## ========== Frontend Deployment ==========

deploy-frontend: ## Deploy example app to frontend directory (e.g., make deploy-frontend APP=nextjs15)
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
	echo "✅ Deployed example/$(APP) to frontend/"; \
	echo ""; \
	echo "Frontend directory contents:"; \
	du -sh frontend/; \
	echo ""; \
	echo "Next steps:"; \
	echo "  make dev-rebuild  - Rebuild Docker image with new frontend"; \
	echo "  make dev-up       - Start development environment"

deploy-and-start: ## Deploy example and start dev environment (e.g., make deploy-and-start APP=nextjs15)
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
	@if curl -s http://localhost:9222/json/version > /dev/null 2>&1; then \
		echo "✅ Chrome already running with CDP on port 9222"; \
		BROWSER_VER=$$(curl -s http://localhost:9222/json/version | grep -o '"Browser":"[^"]*"' | cut -d'"' -f4); \
		echo "   Version: $$BROWSER_VER"; \
	elif grep -qi microsoft /proc/version 2>/dev/null; then \
		echo "Detected WSL2 environment"; \
		echo "Starting Windows Chrome from WSL..."; \
		HOST_IP=$$(ip route | grep default | awk '{print $$3}' || echo "127.0.0.1"); \
		echo "   Detected WSL2 host IP: $$HOST_IP"; \
		APP_URL="http://$$HOST_IP:3000/"; \
		echo "   Application URL: $$APP_URL"; \
		powershell.exe -Command "Start-Process chrome.exe -ArgumentList '--remote-debugging-port=9222','--remote-debugging-address=0.0.0.0','--user-data-dir=C:\\temp\\chrome-dev-profile','--no-first-run','--no-default-browser-check','$$APP_URL'" 2>/dev/null || \
		cmd.exe /c "start chrome.exe --remote-debugging-port=9222 --remote-debugging-address=0.0.0.0 --user-data-dir=C:\\temp\\chrome-dev-profile --no-first-run --no-default-browser-check $$APP_URL" 2>/dev/null || \
		echo "⚠️  Failed to start Chrome automatically. Please start Chrome manually:"; \
		echo "   chrome.exe --remote-debugging-port=9222 --remote-debugging-address=0.0.0.0 --user-data-dir=C:\\temp\\chrome-dev-profile $$APP_URL"; \
		sleep 3; \
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
		if curl -s http://localhost:9222/json/version > /dev/null 2>&1; then \
			echo "✅ CDP endpoint ready!"; \
			break; \
		fi; \
		if [ $$i -eq 5 ]; then \
			echo "⚠️  CDP endpoint not ready after 5 seconds"; \
			echo "   Chrome may still be starting. Check manually: http://localhost:9222/json/version"; \
		fi; \
		echo -n "."; \
		sleep 1; \
		i=$$((i + 1)); \
	done

stop-chrome-cdp: ## Stop Chrome CDP process
	@echo "Stopping Chrome CDP..."
	@if grep -qi microsoft /proc/version 2>/dev/null; then \
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
	@cd docker && docker compose ps
	@echo ""
	@echo "Chrome CDP:"
	@if curl -s http://localhost:9222/json/version > /dev/null 2>&1; then \
		echo "  ✅ Chrome running with CDP on port 9222"; \
		BROWSER_VER=$$(curl -s http://localhost:9222/json/version | grep -o '"Browser":"[^"]*"' | cut -d'"' -f4); \
		CDP_WS_URL=$$(curl -s http://localhost:9222/json/version | grep -o '"webSocketDebuggerUrl":"[^"]*"' | cut -d'"' -f4); \
		echo "  Version: $$BROWSER_VER"; \
		echo "  WebSocket URL: $$CDP_WS_URL"; \
	else \
		echo "  ❌ Chrome CDP not accessible on port 9222"; \
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
