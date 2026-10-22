#!/bin/zsh
set -eu

SCRIPT_DIR="${0:A:h}"
ROOT_DIR="${SCRIPT_DIR:h}"
cd "$ROOT_DIR"

PORT="${PORT:-5178}"
BIND_HOST="${BIND_HOST:-127.0.0.1}"
HEALTH_HOST="$BIND_HOST"
if [[ "$BIND_HOST" == "0.0.0.0" || "$BIND_HOST" == "::" ]]; then
  HEALTH_HOST="127.0.0.1"
fi

HEALTH_URL="http://${HEALTH_HOST}:${PORT}/api/health"
RUNTIME_DIR="${ROOT_DIR}/.runtime"
RUNTIME_SUFFIX=""
if [[ "$PORT" != "5178" ]]; then
  RUNTIME_SUFFIX="-${PORT}"
fi
PID_FILE="${RUNTIME_DIR}/server${RUNTIME_SUFFIX}.pid"
WAIT_STEPS="${STOP_WAIT_STEPS:-40}"
typeset -a TARGET_PIDS

is_project_pid() {
  local candidate_pid="$1"
  local process_cwd
  local process_command

  process_cwd="$(lsof -a -p "$candidate_pid" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p' || true)"
  process_command="$(ps -p "$candidate_pid" -o command= 2>/dev/null || true)"
  [[ "$process_cwd" == "$ROOT_DIR" ]] || return 1
  [[ -z "$process_command" || "$process_command" == *"server/index.js"* ]]
}

HEALTH="$(curl -fsS --max-time 2 "$HEALTH_URL" 2>/dev/null || true)"
if [[ -n "$HEALTH" && "$HEALTH" != *'"app":"local-roleplay-agent"'* ]]; then
  echo "Port ${PORT} is occupied by another service; nothing was stopped."
  exit 1
fi

if [[ -f "$PID_FILE" ]]; then
  SAVED_PID="$(cat "$PID_FILE" 2>/dev/null || true)"
  if [[ -n "$SAVED_PID" ]] && is_project_pid "$SAVED_PID"; then
    TARGET_PIDS+=("$SAVED_PID")
  fi
fi

if [[ ${#TARGET_PIDS[@]} -eq 0 ]]; then
  LISTENING_PIDS="$(lsof -tiTCP:"$PORT" -sTCP:LISTEN 2>/dev/null || true)"
  if [[ -n "$LISTENING_PIDS" ]]; then
    for listening_pid in ${(f)LISTENING_PIDS}; do
      if is_project_pid "$listening_pid"; then
        TARGET_PIDS+=("$listening_pid")
      fi
    done
  fi
fi

if [[ ${#TARGET_PIDS[@]} -eq 0 ]]; then
  rm -f "$PID_FILE"
  echo "Roleplay Studio is not running on port ${PORT}."
  exit 0
fi

for target_pid in "${TARGET_PIDS[@]}"; do
  kill "$target_pid" 2>/dev/null || true
done

for (( step = 1; step <= WAIT_STEPS; step++ )); do
  RUNNING=0
  for target_pid in "${TARGET_PIDS[@]}"; do
    if [[ -n "$(lsof -a -p "$target_pid" -iTCP:"$PORT" -sTCP:LISTEN -t 2>/dev/null || true)" ]]; then
      RUNNING=1
      break
    fi
  done
  if (( RUNNING == 0 )); then
    rm -f "$PID_FILE"
    echo "Roleplay Studio stopped."
    exit 0
  fi
  sleep 0.25
done

echo "Stop timed out. Check ${PID_FILE} and the process list before retrying."
exit 1
