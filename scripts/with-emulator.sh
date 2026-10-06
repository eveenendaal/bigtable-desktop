#!/usr/bin/env bash
# Runs a command with a local Bigtable emulator available on $EMULATOR_PORT
# (default 8086) and BIGTABLE_EMULATOR_HOST set. Reuses an emulator that is
# already listening; otherwise starts one and stops it when the command exits.
#
#   scripts/with-emulator.sh npm test
#   scripts/with-emulator.sh            # just run the emulator in the foreground
set -euo pipefail

PORT="${EMULATOR_PORT:-8086}"
export BIGTABLE_EMULATOR_HOST="localhost:${PORT}"

listening() { (exec 3<>"/dev/tcp/127.0.0.1/${PORT}") 2>/dev/null; }

find_emulator() {
  if [[ -n "${BIGTABLE_EMULATOR_BIN:-}" ]]; then echo "$BIGTABLE_EMULATOR_BIN"; return; fi
  if command -v cbtemulator >/dev/null; then command -v cbtemulator; return; fi
  if command -v gcloud >/dev/null; then
    local sdk
    sdk="$(gcloud info --format='value(installation.sdk_root)' 2>/dev/null || true)"
    if [[ -x "$sdk/platform/bigtable-emulator/cbtemulator" ]]; then echo "$sdk/platform/bigtable-emulator/cbtemulator"; return; fi
  fi
  if command -v go >/dev/null; then
    local bin
    bin="$(go env GOPATH)/bin/emulator"
    if [[ ! -x "$bin" ]]; then
      echo "Installing the Bigtable emulator with go install…" >&2
      go install cloud.google.com/go/bigtable/cmd/emulator@latest >&2
    fi
    echo "$bin"; return
  fi
  cat >&2 <<'MSG'
No Bigtable emulator found. Install one of:
  gcloud components install bigtable
  go install cloud.google.com/go/bigtable/cmd/emulator@latest
or set BIGTABLE_EMULATOR_BIN to the emulator binary.
MSG
  exit 1
}

if listening; then
  echo "Using the emulator already running on ${BIGTABLE_EMULATOR_HOST}" >&2
  if [[ $# -gt 0 ]]; then exec "$@"; fi
  echo "Nothing to do." >&2
  exit 0
fi

EMULATOR="$(find_emulator)"
if [[ $# -eq 0 ]]; then
  echo "Bigtable emulator listening on ${BIGTABLE_EMULATOR_HOST} (Ctrl+C to stop)" >&2
  exec "$EMULATOR" -host localhost -port "$PORT"
fi

"$EMULATOR" -host localhost -port "$PORT" >/dev/null 2>&1 &
EMULATOR_PID=$!
trap 'kill "$EMULATOR_PID" 2>/dev/null || true' EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
for _ in $(seq 1 50); do
  listening && break
  kill -0 "$EMULATOR_PID" 2>/dev/null || { echo "The emulator exited unexpectedly" >&2; exit 1; }
  sleep 0.2
done
listening || { echo "The emulator did not start on ${BIGTABLE_EMULATOR_HOST}" >&2; exit 1; }
"$@"
