#!/usr/bin/env bash
# Shared helpers for Makefile recipes to enable log-driven workflows.
# Source this file at the beginning of recipes: `. scripts/make-helpers.sh`

# ========= Pretty Printers =========

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

# ========= Logging (combined only) =========

# Ensure log directory; can be overridden via D3K_LOG_DIR
_d3k_log_dir() {
  local dir="${D3K_LOG_DIR:-.make-logs}"
  mkdir -p "$dir" 2>/dev/null || true
  printf "%s" "$dir"
}

# Very small JSON string escaper for simple metadata values
_json_escape() {
  # Kept for compatibility if needed in messages; not used for files now
  sed -e 's/\\/\\\\/g' \
      -e 's/\"/\\\"/g' \
      -e 's/\t/\\t/g' \
      -e 's/\r/\\r/g' \
      -e 's/\n/\\n/g'
}

# Path to combined human-readable log
_combined_log_path() {
  local dir=$(_d3k_log_dir)
  local file="${D3K_LOG_FILE:-$dir/combined.log}"
  # Ensure parent exists
  mkdir -p "$(dirname "$file")" 2>/dev/null || true
  printf "%s" "$file"
}

# No JSON lines output — only combined.log is maintained

# ========= Command Runner =========

# run_cmd "Name" <command...>
# - Emits human-readable intent with timing/exit
# - Captures stdout/stderr per command, consolidates into combined.log
# Env knobs:
#   D3K_LOG_DRY_RUN=1  -> do not execute, still log intent
#   D3K_LOG_DIR=path   -> where to write logs (default .make-logs)
run_cmd() {
  local name="$1"; shift
  local cmd=("$@")
  local t0
  t0=$(date +%s)
  local ts_iso
  ts_iso=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
  local dir
  dir=$(_d3k_log_dir)
  local combined
  combined=$(_combined_log_path)
  local id
  id="$(date +%Y%m%dT%H%M%S)-$$-$RANDOM"
  local out_file="$dir/${id}.out"
  local err_file="$dir/${id}.err"

  section "RUN: $name"
  kv Command "${cmd[*]}"
  kv LogDir "$dir"
  kv LogID "$id"

  if [[ "${D3K_LOG_DRY_RUN:-}" == "1" ]]; then
    kv Mode "DRY-RUN"
    # Combined log entry for skipped command
    {
      printf "===== ENTRY %s START =====\n" "$id"
      printf "TS: %s\n" "$ts_iso"
      printf "Mode: DRY-RUN\n"
      printf "Name: %s\n" "$name"
      printf "Cmd: %s\n" "${cmd[*]}"
      printf "Exit: SKIPPED\n"
      printf "Time: 0s\n"
      printf "Stdout-Bytes: 0\n"
      printf "Stderr-Bytes: 0\n"
      printf "--- STDOUT (first 0 bytes) ---\n"
      printf "\n--- STDERR (first 0 bytes) ---\n"
      printf "\n===== ENTRY %s END =====\n" "$id"
    } >> "$combined" 2>/dev/null || true
    return 0
  fi

  # Execute with capture
  local rc
  set +e
  # Avoid failing captures on shells without process substitution
  if (true) 2>/dev/null; then
    "${cmd[@]}" > >(tee "$out_file") 2> >(tee "$err_file" >&2)
  else
    "${cmd[@]}" 1>"$out_file" 2>"$err_file"
  fi
  rc=$?
  set -e

  local t1
  t1=$(date +%s)
  local elapsed=$(($t1-$t0))
  kv Exit "$rc"
  kv Time "${elapsed}s"

  # Consolidate stdout/stderr into a single combined file
  local max_bytes=${D3K_LOG_MAX_CAPTURE:-65536}
  local stdout_len=0 stderr_len=0
  [[ -f "$out_file" ]] && stdout_len=$(wc -c <"$out_file" 2>/dev/null || echo 0)
  [[ -f "$err_file" ]] && stderr_len=$(wc -c <"$err_file" 2>/dev/null || echo 0)
  local stdout_trunc=false stderr_trunc=false
  local stdout_len=0 stderr_len=0
  [[ -f "$out_file" ]] && stdout_len=$(wc -c <"$out_file" 2>/dev/null || echo 0)
  [[ -f "$err_file" ]] && stderr_len=$(wc -c <"$err_file" 2>/dev/null || echo 0)

  {
    printf "===== ENTRY %s START =====\n" "$id"
    printf "TS: %s\n" "$ts_iso"
    printf "Mode: EXEC\n"
    printf "Name: %s\n" "$name"
    printf "Cmd: %s\n" "${cmd[*]}"
    printf "Exit: %s\n" "$rc"
    printf "Time: %ss\n" "$elapsed"
    printf "Stdout-Bytes: %s\n" "$stdout_len"
    printf "Stderr-Bytes: %s\n" "$stderr_len"
    printf "--- STDOUT (first %s bytes) ---\n" "$max_bytes"
    [[ -f "$out_file" ]] && head -c "$max_bytes" "$out_file" || true
    printf "\n--- STDERR (first %s bytes) ---\n" "$max_bytes"
    [[ -f "$err_file" ]] && head -c "$max_bytes" "$err_file" || true
    printf "\n===== ENTRY %s END =====\n" "$id"
  } >> "$combined" 2>/dev/null || true

  if [[ $rc -ne 0 ]]; then
    hint "Command failed. Inspect combined log section by: make log-tail-last"
  fi

  # Cleanup split files unless explicitly requested
  if [[ "${D3K_LOG_KEEP_FILES:-}" != "1" ]]; then
    rm -f "$out_file" "$err_file" 2>/dev/null || true
  else
    kv Stdout "$out_file"
    kv Stderr "$err_file"
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
