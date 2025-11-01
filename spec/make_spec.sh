#!/usr/bin/env shellspec
# Verify Makefile targets behavior using ShellSpec.

set -eu

Describe 'Make targets (ShellSpec)'
  BeforeAll 'setup'
  setup() {
    export PATH=$PATH
    PROJECT_ROOT=$(pwd -P)
    export PROJECT_ROOT
    # Ensure at least one log entry exists so log-tail-last succeeds
    make -C "$PROJECT_ROOT" -s test-echo >/dev/null 2>&1 || true
  }

  # Helper to run make with optional env pairs
  run_make() {
    # Usage: run_make target [KEY=VAL ...]
    local target="$1"; shift || true
    env "$@" make -C "$PROJECT_ROOT" -s "$target"
  }

  # Helper to run an arbitrary command sequence from repo root
  run_seq() {
    # Usage: run_seq "<shell commands>" [KEY=VAL ...]
    local seq="$1"; shift || true
    env "$@" bash -lc "cd \"$PROJECT_ROOT\" && { $seq; }"
  }

  It 'help prints quick start'
    When run run_make help
    The status should be success
    The output should include 'Dev3000 Development Commands'
  End

  It 'dev-up shows all steps (real)'
    When run run_make dev-up
    The status should be success
    The output should include 'Step 1: Starting Docker containers'
    The output should include 'Step 2: Waiting for Next.js to be ready'
    The output should include 'Step 3: Launching Chrome with CDP'
    The output should include 'Step 4: Running cdp-check diagnostics'
    The stderr should be present
  End

  It 'cdp-check logs intent (real)'
    When run run_make cdp-check
    The status should be success
    The output should include 'CDP Reachability Check'
    The output should include 'RUN: node scripts/check-cdp.mjs'
    The stderr should be present
  End

  It 'diagnose covers sections (real)'
    When run run_make diagnose NON_INTERACTIVE=1
    The status should be success
    The output should include 'Environment'
    The output should include 'Docker Containers'
    The output should include 'Ports'
    The output should include 'HTTP Probes'
    The output should include 'Status'
    The stderr should be present
  End

  It 'dev-logs one-shot (real)'
    When run run_make dev-logs D3K_LOG_ONE_SHOT=1
    The status should be success
    The output should include 'RUN: docker compose logs --tail 100'
    The stderr should be present
  End

  It 'dev-build no-cache (real)'
        When run run_make dev-build
    The status should be success
    The output should include 'RUN: docker compose build --no-cache'
    The stderr should be present
  End

  It 'dev-build-fast with cache (real)'
        When run run_make dev-build-fast
    The status should be success
    The output should include 'RUN: docker compose build (cache)'
    The stderr should be present
  End

  It 'dev-rebuild down + build (real)'
        When run run_seq "make -s deploy-frontend APP=nextjs16 && make -s dev-rebuild"
    The status should be success
    The output should include 'RUN: docker compose down'
    The output should include 'RUN: docker compose build --no-cache'
    The stderr should be present
  End

  It 'dev-rebuild-fast down + build cache (real)'
        When run run_seq "make -s deploy-frontend APP=nextjs16 && make -s dev-rebuild-fast"
    The status should be success
    The output should include 'RUN: docker compose down'
    The output should include 'RUN: docker compose build (cache)'
    The stderr should be present
  End

  It 'dev-down wraps docker compose down (real)'
    When run run_make dev-down
    The status should be success
    The output should include 'RUN: docker compose down'
    The stderr should be present
  End

  It 'status prints summary (real)'
    When run run_make status
    The status should be success
    The output should include 'Dev3000 Status'
    The stderr should be present
  End

  It 'start-chrome-cdp delegates to xplat (real)'
    When run run_make start-chrome-cdp
    The status should be success
    The output should include 'Starting Chrome with CDP (cross-platform launcher)'
    The stderr should be present
  End

  It 'stop-chrome-cdp executes stop logic (real)'
    When run run_make stop-chrome-cdp
    The status should be success
    The output should include 'Stopping Chrome CDP'
    The stderr should be present
  End

  It 'log utility test-echo (real)'
    When run run_make test-echo
    The status should be success
    The output should be present
    The stderr should be present
  End

  It 'log utility log-ls (real)'
    When run run_make log-ls
    The status should be success
    The output should be present
    The stderr should be present
  End

  It 'log utility log-tail-last (real)'
    When run run_make log-tail-last
    The status should be success
    The output should be present
    The stderr should be present
  End

  It 'log utility log-clean (real)'
    When run run_make log-clean
    The status should be success
    The output should be present
    The stderr should be present
  End

  It 'list-examples lists available examples (real)'
    When run run_make list-examples
    The status should be success
    The output should include 'Available example apps:'
    The stderr should be present
  End

  It 'deploy-and-start requires APP (real)'
    When run run_make deploy-and-start
    The status should be failure
    The output should include 'Usage: make deploy-and-start APP='
    The stderr should be present
  End

  It 'dev3000-sync errors without submodule (real)'
    When run run_make dev3000-sync
    The status should be failure
    The output should include 'frontend/.dev3000 is not a git repository'
    The stderr should be present
  End

  It 'dev-rebuild-frontend down + build cache (real)'
        When run run_seq "make -s deploy-frontend APP=nextjs16 && make -s dev-rebuild-frontend"
    The status should be success
    The output should include 'RUN: docker compose down'
    The output should include 'RUN: docker compose build (cache)'
    The stderr should be present
  End

  It 'clean down -v and rm (real)'
    When run run_make clean
    The status should be success
    The output should include 'RUN: docker compose down -v'
    The stderr should be present
  End

  It 'start-chrome-cdp-xplat logs intent (real)'
    When run run_make start-chrome-cdp-xplat
    The status should be success
    The output should include 'RUN: launch chrome cdp'
    The stderr should be present
  End

  It 'clean-frontend wraps remove under run_cmd (real)'
    When run run_make clean-frontend
    The status should be success
    The output should include 'RUN: rm frontend/* (keep .keep)'
    The stderr should be present
  End

  It 'deploy-frontend requires APP (real)'
    When run run_make deploy-frontend
    The status should be failure
    The output should include 'Usage: make deploy-frontend APP='
    The stderr should be present
  End
End
