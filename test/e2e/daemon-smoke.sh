#!/usr/bin/env bash
# Phase 3 daemon E2E: boot the headless daemon on a temp universe, drive
# mutations over HTTP, verify the .redstring file on disk, restart, and confirm
# persistence. Requires: node, curl, jq. Run from repo root.
set -uo pipefail

PORT="${WIZARD_PORT:-3011}"
BASE="http://127.0.0.1:${PORT}"
TMP="$(mktemp -d "${TMPDIR:-/tmp}/rs-daemon-e2e.XXXXXX")"
UNIVERSE="${TMP}/universe.redstring"
PIDFILE="${TMP}/daemon.pid"
FAIL=0

log()  { printf '  %s\n' "$*"; }
pass() { printf '\033[32mPASS\033[0m %s\n' "$*"; }
fail() { printf '\033[31mFAIL\033[0m %s\n' "$*"; FAIL=1; }

cleanup() {
  [ -f "$PIDFILE" ] && kill "$(cat "$PIDFILE")" 2>/dev/null
  rm -rf "$TMP"
}
trap cleanup EXIT

start_daemon() {
  REDSTRING_UNIVERSE="$UNIVERSE" WIZARD_PORT="$PORT" node wizard-server.js >"${TMP}/daemon.log" 2>&1 &
  echo $! > "$PIDFILE"
  # wait for health
  for _ in $(seq 1 50); do
    if curl -sf "${BASE}/api/bridge/health" >/dev/null 2>&1; then return 0; fi
    sleep 0.2
  done
  fail "daemon did not become healthy"; cat "${TMP}/daemon.log"; exit 1
}

stop_daemon() {
  local pid; pid="$(cat "$PIDFILE")"
  kill -TERM "$pid" 2>/dev/null
  for _ in $(seq 1 25); do kill -0 "$pid" 2>/dev/null || return 0; sleep 0.2; done
  kill -9 "$pid" 2>/dev/null
}

# poll action-status until completed (or timeout)
await_action() {
  local aid="$1"
  for _ in $(seq 1 50); do
    local status; status="$(curl -sf "${BASE}/api/bridge/action-status/${aid}" | jq -r '.status')"
    [ "$status" = "completed" ] && return 0
    [ "$status" = "unknown" ] && return 1
    sleep 0.1
  done
  return 1
}

enqueue() { # $1 = json actions array
  curl -sf -X POST "${BASE}/api/bridge/pending-actions/enqueue" \
    -H 'Content-Type: application/json' -d "$1"
}

echo "== Daemon E2E =="
log "universe: $UNIVERSE"

echo "-- boot --"
start_daemon
HEALTH="$(curl -sf "${BASE}/api/bridge/health")"
[ "$(echo "$HEALTH" | jq -r '.headless')" = "true" ] && pass "health reports headless" || fail "health not headless: $HEALTH"
[ "$(echo "$HEALTH" | jq -r '.storeMode')" = "runtime" ] && pass "storeMode=runtime" || fail "storeMode wrong"

echo "-- create graph --"
RESP="$(enqueue '{"actions":[{"action":"createNewGraph","params":[{"id":"g-e2e","name":"E2E Graph"}]}]}')"
AID="$(echo "$RESP" | jq -r '.actionIds[0]')"
await_action "$AID" && pass "createNewGraph completed" || fail "createNewGraph did not complete ($RESP)"

echo "-- apply mutations (prototype + instance) --"
RESP="$(enqueue '{"actions":[{"action":"applyMutations","params":[[{"type":"addNodePrototype","prototypeData":{"id":"p-e2e","name":"E2E Node","color":"#886644"}},{"type":"addNodeInstance","graphId":"g-e2e","prototypeId":"p-e2e","position":{"x":100,"y":120},"instanceId":"i-e2e"}]]}]}')"
# applyMutations may be preceded by an inferred openGraph; take the LAST id (the applyMutations)
AID="$(echo "$RESP" | jq -r '.actionIds[-1]')"
await_action "$AID" && pass "applyMutations completed" || fail "applyMutations did not complete ($RESP)"

echo "-- read bridge state --"
STATE="$(curl -sf "${BASE}/api/bridge/state")"
[ "$(echo "$STATE" | jq -r '.storeMode')" = "runtime" ] && pass "state storeMode=runtime" || fail "state storeMode wrong"
echo "$STATE" | jq -e '.graphs[] | select(.id=="g-e2e")' >/dev/null && pass "graph g-e2e in state" || fail "graph missing from state"
echo "$STATE" | jq -e '.nodePrototypes[] | select(.id=="p-e2e")' >/dev/null && pass "prototype p-e2e in state" || fail "prototype missing"

echo "-- store export + save --"
curl -sf "${BASE}/api/store/export" | jq -e '.' >/dev/null && pass "/api/store/export returns JSON" || fail "export failed"
curl -sf -X POST "${BASE}/api/store/save" | jq -e '.ok==true' >/dev/null && pass "/api/store/save ok" || fail "save failed"

echo "-- store import (Phase 6 coexistence) --"
VER="$(curl -sf "${BASE}/api/bridge/health" | jq -r '.stateVersion')"
EXPORT_JSON="$(curl -sf "${BASE}/api/store/export")"
# accept: correct baseVersion
IMP="$(curl -sf -X POST "${BASE}/api/store/import" -H 'Content-Type: application/json' \
  -d "$(jq -n --argjson v "$VER" --argjson r "$EXPORT_JSON" '{baseVersion:$v, redstring:$r}')")"
[ "$(echo "$IMP" | jq -r '.ok')" = "true" ] && pass "import accepted with correct baseVersion" || fail "import rejected ($IMP)"
# reject: stale baseVersion → 409
CODE="$(curl -s -o /dev/null -w '%{http_code}' -X POST "${BASE}/api/store/import" -H 'Content-Type: application/json' \
  -d "$(jq -n --argjson r "$EXPORT_JSON" '{baseVersion:999999, redstring:$r}')")"
[ "$CODE" = "409" ] && pass "import rejects stale baseVersion (409)" || fail "expected 409 for stale version, got $CODE"

echo "-- shutdown + on-disk check --"
stop_daemon
[ -f "$UNIVERSE" ] && pass "universe file exists on disk" || fail "no universe file written"
if [ -f "$UNIVERSE" ]; then
  grep -q "E2E Graph" "$UNIVERSE" && pass "file contains 'E2E Graph'" || fail "graph not persisted to file"
  grep -q "E2E Node"  "$UNIVERSE" && pass "file contains 'E2E Node'"  || fail "prototype not persisted to file"
fi

echo "-- restart + persistence --"
start_daemon
STATE="$(curl -sf "${BASE}/api/bridge/state")"
echo "$STATE" | jq -e '.graphs[] | select(.id=="g-e2e")' >/dev/null && pass "graph persisted across restart" || fail "graph lost on restart"
echo "$STATE" | jq -e '.nodePrototypes[] | select(.id=="p-e2e")' >/dev/null && pass "prototype persisted across restart" || fail "prototype lost on restart"
stop_daemon

echo
if [ "$FAIL" -eq 0 ]; then printf '\033[32mALL DAEMON E2E CHECKS PASSED\033[0m\n'; else printf '\033[31mDAEMON E2E FAILURES\033[0m\n'; fi
exit "$FAIL"
