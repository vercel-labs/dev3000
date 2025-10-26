# Makefile for User Projects using dev3000
#
# This Makefile is for projects that have dev3000 cloned in frontend/.dev3000
#
# Your project structure:
#   /your-project/                  # Your project root (THIS MAKEFILE GOES HERE)
#   ├── frontend/                   # Your Next.js application
#   │   ├── .dev3000/              # git clone https://github.com/automationjp/dev3000
#   │   ├── app/                    # Your code
#   │   └── package.json
#   ├── docker/
#   │   └── docker-compose.yml
#   └── Makefile                    # THIS FILE
#
# Usage from your project root:
#   make dev-up        - Start development with dev3000
#   make dev-down      - Stop development environment
#   make dev-logs      - View logs

.PHONY: help dev-up dev-down dev-logs dev-rebuild clean start-chrome-cdp stop-chrome-cdp status

.DEFAULT_GOAL := help

## ========== Quick Start ==========

help: ## Show this help message
	@echo "dev3000 Development Commands"
	@echo ""
	@echo "Quick Start:"
	@echo "  make dev-up        - Start development environment"
	@echo "  make dev-down      - Stop development environment"
	@echo "  make dev-logs      - Follow container logs"
	@echo ""
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | \
		awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-15s\033[0m %s\n", $$1, $$2}'

## ========== Development Environment ==========

dev-up: ## Start dev3000 environment
	@echo "Starting dev3000 development environment..."
	@echo ""
	@if [ ! -d "frontend/.dev3000" ]; then \
		echo "❌ Error: frontend/.dev3000 directory not found"; \
		echo ""; \
		echo "Please clone dev3000 first:"; \
		echo "  cd frontend"; \
		echo "  git clone https://github.com/automationjp/dev3000 .dev3000"; \
		echo ""; \
		exit 1; \
	fi
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
	@echo "Step 4: Verifying CDP connection..."
	@if curl -s http://localhost:9222/json/version > /dev/null 2>&1; then \
		echo "✅ CDP connection verified"; \
		BROWSER_VER=$$(curl -s http://localhost:9222/json/version | grep -o '"Browser":"[^"]*"' | cut -d'"' -f4); \
		echo "   Browser: $$BROWSER_VER"; \
	else \
		echo "⚠️  Could not verify CDP connection"; \
	fi
	@echo ""
	@echo "✅ Development environment started"
	@echo ""
	@echo "Access points:"
	@echo "  Your App:       http://localhost:3000"
	@echo "  Dev3000 UI:     http://localhost:3684"
	@echo "  Logs Viewer:    http://localhost:3684/logs"
	@echo ""
	@echo "Commands:"
	@echo "  make dev-logs   - View logs"
	@echo "  make dev-down   - Stop environment"
	@echo "  make status     - Check status"

dev-down: ## Stop dev3000 environment
	@echo "Stopping development environment..."
	@cd docker && docker compose down
	@echo ""
	@echo "✅ Development environment stopped"
	@echo ""
	@echo "⚠️  Note: Chrome CDP browser is still running"
	@echo "To close Chrome, close the window manually or run:"
	@if grep -qi microsoft /proc/version 2>/dev/null; then \
		echo "  make stop-chrome-cdp"; \
	else \
		echo "  make stop-chrome-cdp"; \
	fi

dev-logs: ## Follow Docker container logs
	@cd docker && docker compose logs -f

dev-rebuild: ## Rebuild and restart environment
	@echo "Rebuilding development environment..."
	@cd docker && docker compose down
	@cd docker && DOCKER_BUILDKIT=1 docker compose build --no-cache
	@$(MAKE) dev-up

clean: ## Clean up Docker resources
	@echo "Cleaning up..."
	@cd docker && docker compose down -v
	@echo "✅ Cleanup complete"

## ========== Chrome CDP Management ==========

start-chrome-cdp: ## Start Chrome with CDP
	@echo "🌐 Starting Chrome with CDP..."
	@if curl -s http://localhost:9222/json/version > /dev/null 2>&1; then \
		echo "✅ Chrome already running with CDP on port 9222"; \
		BROWSER_VER=$$(curl -s http://localhost:9222/json/version | grep -o '"Browser":"[^"]*"' | cut -d'"' -f4); \
		echo "   Version: $$BROWSER_VER"; \
	elif grep -qi microsoft /proc/version 2>/dev/null; then \
		echo "Detected WSL2 environment"; \
		HOST_IP=$$(ip route | grep default | awk '{print $$3}' || echo "127.0.0.1"); \
		APP_URL="http://$$HOST_IP:3000/"; \
		echo "   Application URL: $$APP_URL"; \
		powershell.exe -Command "Start-Process chrome.exe -ArgumentList '--remote-debugging-port=9222','--remote-debugging-address=0.0.0.0','--user-data-dir=C:\\temp\\chrome-dev-profile','--no-first-run','--no-default-browser-check','$$APP_URL'" 2>/dev/null || \
		echo "⚠️  Please start Chrome manually: chrome.exe --remote-debugging-port=9222 --remote-debugging-address=0.0.0.0 $$APP_URL"; \
		sleep 3; \
	elif [ "$$(uname)" = "Darwin" ]; then \
		echo "Detected macOS environment"; \
		open -a "Google Chrome" --args --remote-debugging-port=9222 --user-data-dir=/tmp/chrome-dev-profile http://localhost:3000 & \
		sleep 3; \
	else \
		echo "Detected Linux environment"; \
		google-chrome --remote-debugging-port=9222 --user-data-dir=/tmp/chrome-dev-profile http://localhost:3000 > /dev/null 2>&1 & \
		sleep 3; \
	fi

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
	@echo "=== dev3000 Status ==="
	@echo ""
	@echo "Project:"
	@echo "  Frontend: $(shell pwd)/frontend"
	@echo "  dev3000:  $(shell pwd)/frontend/.dev3000"
	@echo ""
	@echo "Docker Containers:"
	@cd docker && docker compose ps
	@echo ""
	@echo "Chrome CDP:"
	@if curl -s http://localhost:9222/json/version > /dev/null 2>&1; then \
		echo "  ✅ Chrome running with CDP on port 9222"; \
		BROWSER_VER=$$(curl -s http://localhost:9222/json/version | grep -o '"Browser":"[^"]*"' | cut -d'"' -f4); \
		echo "  Version: $$BROWSER_VER"; \
	else \
		echo "  ❌ Chrome CDP not accessible on port 9222"; \
	fi
