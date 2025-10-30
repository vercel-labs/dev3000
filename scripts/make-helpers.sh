#!/usr/bin/env bash
# Shared helpers for Makefile recipes to enable log-driven workflows.
# Source this file at the beginning of recipes: `. scripts/make-helpers.sh`

# section "Title"
section() {
  printf "\n===== %s =====\n" "$*"
}

# kv key value
kv() {
  printf -- "- %s: %s\n" "$1" "${2:-}"
}

# hint "message"
hint() {
  printf -- "👉 %s\n" "$*"
}

# run_cmd "Name" <command...>
# Respects D3K_LOG_DRY_RUN=1 for safe testing. Emits intent, command, timing, exit code.
run_cmd() {
  local name="$1"; shift
  local cmd=("$@")
  local t0=$(date +%s)
  section "RUN: $name"
  kv Command "${cmd[*]}"
  if [[ "${D3K_LOG_DRY_RUN:-}" == "1" ]]; then
    kv Mode "DRY-RUN"
    return 0
  fi
  set +e
  "${cmd[@]}"
  local rc=$?
  set -e
  local t1=$(date +%s)
  kv Exit "$rc"
  kv Time "$(($t1-$t0))s"
  if [[ $rc -ne 0 ]]; then
    hint "Command failed. Inspect logs above, adjust and re-run."
  fi
  return $rc
}

# ensure_container "name" "up-command..."
# Starts container if not running. DRY-RUN aware.
ensure_container() {
  local cname="$1"; shift
  if docker ps --format '{{.Names}}' | grep -q "^${cname}$"; then
    kv "Container ${cname}" "running"
    return 0
  fi
  kv "Container ${cname}" "not running"
  if [[ "${D3K_LOG_DRY_RUN:-}" == "1" ]]; then
    hint "DRY-RUN: would start container '${cname}'"
    return 0
  fi
  section "Start container: ${cname}"
  "$@"
}

