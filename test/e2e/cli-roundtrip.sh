#!/usr/bin/env bash
# Phase 5 CLI E2E: exercise cli/redstring.js in BOTH backends —
#   1. direct-library mode (no daemon), and
#   2. daemon/HTTP mode (against a running wizard-server).
# Asserts round-trip persistence to the .redstring file. Needs node + jq.
set -uo pipefail

CLI="node cli/redstring.js"
PORT="${WIZARD_PORT:-3013}"
TMP="$(mktemp -d "${TMPDIR:-/tmp}/rs-cli-e2e.XXXXXX")"
FAIL=0
DAEMON_PID=""

pass() { printf '\033[32mPASS\033[0m %s\n' "$*"; }
fail() { printf '\033[31mFAIL\033[0m %s\n' "$*"; FAIL=1; }
cleanup() { [ -n "$DAEMON_PID" ] && kill "$DAEMON_PID" 2>/dev/null; rm -rf "$TMP"; }
trap cleanup EXIT

jqget() { echo "$1" | jq -r "$2"; }

run_roundtrip() { # $1 = universe path, uses whatever backend is active
  local U="$1"
  local gid
  gid="$(jqget "$($CLI --universe "$U" --json graph create 'Roundtrip Graph')" '.id')"
  [ -n "$gid" ] && [ "$gid" != "null" ] || { fail "graph create returned no id"; return; }
  pass "graph create → $gid"

  $CLI --universe "$U" --json node create 'Sun'  --graph "$gid" >/dev/null || fail "node create Sun"
  $CLI --universe "$U" --json node create 'Moon' --graph "$gid" >/dev/null || fail "node create Moon"
  pass "created 2 nodes"

  local edge; edge="$($CLI --universe "$U" --json edge create 'Sun' 'Moon' --graph "$gid" --type 'orbits')"
  [ "$(jqget "$edge" '.created')" = "true" ] && pass "edge create Sun→Moon" || fail "edge create ($edge)"

  local nodes; nodes="$($CLI --universe "$U" --json node list --graph "$gid")"
  [ "$(echo "$nodes" | jq 'length')" = "2" ] && pass "node list shows 2 nodes" || fail "node list count ($nodes)"

  local hits; hits="$($CLI --universe "$U" --json search sun)"
  echo "$hits" | jq -e '.[] | select(.name=="Sun")' >/dev/null && pass "search finds Sun" || fail "search ($hits)"

  local st; st="$($CLI --universe "$U" --json state)"
  [ "$(jqget "$st" '.graphs | length')" -ge 1 ] && pass "state reports graphs" || fail "state ($st)"
}

echo "== CLI E2E: DIRECT mode (no daemon) =="
DU="$TMP/direct.redstring"
$CLI --universe "$DU" --json universe create >/dev/null && pass "universe create" || fail "universe create"
run_roundtrip "$DU"
# Persistence: fresh process re-reads the same file.
FRESH="$($CLI --universe "$DU" --json graph list)"
echo "$FRESH" | jq -e '.[] | select(.name=="Roundtrip Graph")' >/dev/null && pass "persists across fresh process" || fail "persistence ($FRESH)"
grep -q "Roundtrip Graph" "$DU" && pass "file on disk has the graph" || fail "file missing graph"
grep -q "Sun" "$DU" && pass "file on disk has Sun" || fail "file missing Sun"

echo
echo "== CLI E2E: DAEMON mode (HTTP) =="
HU="$TMP/daemon.redstring"
REDSTRING_UNIVERSE="$HU" WIZARD_PORT="$PORT" node wizard-server.js >"$TMP/daemon.log" 2>&1 &
DAEMON_PID=$!
# wait for health
up=0
for _ in $(seq 1 50); do
  if curl -sf "http://127.0.0.1:${PORT}/api/bridge/health" >/dev/null 2>&1; then up=1; break; fi
  sleep 0.2
done
[ "$up" = "1" ] && pass "daemon healthy on :$PORT" || { fail "daemon never healthy"; cat "$TMP/daemon.log"; }

if [ "$up" = "1" ]; then
  # CLI auto-detects the daemon (probes health) → HTTP mode. --universe is ignored
  # for the running daemon but harmless.
  export WIZARD_PORT="$PORT"
  gid="$(jqget "$($CLI --json graph create 'Daemon CLI Graph')" '.id')"
  [ -n "$gid" ] && [ "$gid" != "null" ] && pass "HTTP graph create → $gid" || fail "HTTP graph create"
  $CLI --json node create 'Star' --graph "$gid" >/dev/null && pass "HTTP node create" || fail "HTTP node create"
  # confirm it reached the daemon's live state
  $CLI --json state | jq -e '.graphs[] | select(.name=="Daemon CLI Graph")' >/dev/null && pass "HTTP state shows graph" || fail "HTTP state"
  # stop daemon → file should persist
  kill -TERM "$DAEMON_PID" 2>/dev/null; wait "$DAEMON_PID" 2>/dev/null; DAEMON_PID=""
  grep -q "Daemon CLI Graph" "$HU" && pass "daemon-mode change persisted to file" || fail "daemon persistence"
  grep -q "Star" "$HU" && pass "daemon-mode node persisted" || fail "daemon node persistence"
fi

echo
if [ "$FAIL" -eq 0 ]; then printf '\033[32mALL CLI E2E CHECKS PASSED\033[0m\n'; else printf '\033[31mCLI E2E FAILURES\033[0m\n'; fi
exit "$FAIL"
