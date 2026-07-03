#!/usr/bin/env bash
# CLI E2E: exercise cli/redstring.js universe lifecycle + graph ops in BOTH
#   1. direct-library mode (no background Redstring), and
#   2. running mode (auto-started background over HTTP).
# HOME is isolated to a temp dir so the real ~/.redstring is never touched.
# Needs node + jq.
set -uo pipefail

CLI="node cli/redstring.js"
PORT="${WIZARD_PORT:-3023}"
export WIZARD_PORT="$PORT"
TMP="$(mktemp -d "${TMPDIR:-/tmp}/rs-cli-e2e.XXXXXX")"
export HOME="$TMP/home"; mkdir -p "$HOME"     # isolate ~/.redstring
WS="$TMP/workspace"
FAIL=0

pass() { printf '\033[32mPASS\033[0m %s\n' "$*"; }
fail() { printf '\033[31mFAIL\033[0m %s\n' "$*"; FAIL=1; }
cleanup() { $CLI stop >/dev/null 2>&1; rm -rf "$TMP"; }
trap cleanup EXIT

jqget() { echo "$1" | jq -r "$2"; }

echo "== CLI E2E: DIRECT mode (no background) =="
# auto-default universe
$CLI -w "$WS" --json list >/dev/null 2>&1 && pass "list boots + auto-default" || fail "list failed"
$CLI -w "$WS" --json create Physics   >/dev/null 2>&1 && pass "create Physics"   || fail "create Physics"
$CLI -w "$WS" --json create Chemistry >/dev/null 2>&1 && pass "create Chemistry" || fail "create Chemistry"
NAMES="$($CLI -w "$WS" --json list | jq -r '[.[].name] | sort | join(",")')"
[ "$NAMES" = "Chemistry,Physics,Universe" ] && pass "list shows 3 universes" || fail "list names: $NAMES"

# switch active + add a graph to Physics
$CLI -w "$WS" use Physics >/dev/null 2>&1 && pass "use Physics" || fail "use Physics"
GID="$(jqget "$($CLI -w "$WS" --json graph create 'Mechanics')" '.id')"
[ -n "$GID" ] && [ "$GID" != "null" ] && pass "graph create in Physics" || fail "graph create"

# persistence across a fresh process: Physics still active + has the graph
ACTIVE="$($CLI -w "$WS" --json list | jq -r '.[] | select(.active) | .slug')"
[ "$ACTIVE" = "physics" ] && pass "active universe persisted (physics)" || fail "active: $ACTIVE"
$CLI -w "$WS" --json graph list | jq -e '.[] | select(.name=="Mechanics")' >/dev/null && pass "graph persisted in active universe" || fail "graph lost"
# switching away hides Physics's graph
$CLI -w "$WS" use Chemistry >/dev/null 2>&1
CNT="$($CLI -w "$WS" --json graph list | jq 'length')"
[ "$CNT" = "0" ] && pass "Chemistry is empty (isolation)" || fail "Chemistry graph count: $CNT"

# rm
$CLI -w "$WS" rm Chemistry >/dev/null 2>&1 && pass "rm Chemistry" || fail "rm Chemistry"
$CLI -w "$WS" --json list | jq -e '.[] | select(.name=="Chemistry")' >/dev/null && fail "Chemistry still listed" || pass "Chemistry removed from list"
[ -f "$WS/Physics.redstring" ] && grep -q "Mechanics" "$WS/Physics.redstring" && pass "Physics file on disk has Mechanics" || fail "Physics file missing graph"

echo
echo "== CLI E2E: RUNNING mode (auto-start over HTTP) =="
RUN="$($CLI -w "$WS" run 2>/dev/null)"
echo "$RUN" | grep -q "running on" && pass "run auto-starts background" || { fail "run failed: $RUN"; }
$CLI status --json | jq -e '.headless==true' >/dev/null && pass "status: running" || fail "status not running"
# create + switch over HTTP
$CLI --json create Astronomy >/dev/null 2>&1 && pass "HTTP create Astronomy" || fail "HTTP create"
$CLI --json list | jq -e '.[] | select(.name=="Astronomy")' >/dev/null && pass "HTTP list shows Astronomy" || fail "HTTP list"
$CLI run Physics >/dev/null 2>&1
$CLI status --json | jq -e '.activeUniverse=="physics"' >/dev/null && pass "run <universe> switches active" || fail "switch active"
# a graph op over HTTP lands in the file
$CLI --json node create "Newton" --graph "$GID" >/dev/null 2>&1 && pass "HTTP node create" || fail "HTTP node create"
$CLI stop >/dev/null 2>&1 && pass "stop" || fail "stop"
grep -q "Newton" "$WS/Physics.redstring" && pass "HTTP node persisted to file" || fail "HTTP node not persisted"

echo
if [ "$FAIL" -eq 0 ]; then printf '\033[32mALL CLI E2E CHECKS PASSED\033[0m\n'; else printf '\033[31mCLI E2E FAILURES\033[0m\n'; fi
exit "$FAIL"
