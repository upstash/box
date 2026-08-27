#!/usr/bin/env bash
#
# Manual smoke test for the box CLI against a real box.
#
#   ./scripts/smoke.sh            run every check, then delete the box
#   ./scripts/smoke.sh --keep     leave the box alive to poke at afterwards
#   ./scripts/smoke.sh --shell    skip the checks, open a shell set up to use it
#
# Needs UPSTASH_BOX_API_KEY. If it is not set, packages/sdk/.env is read.
# Creates one box, exercises the whole surface against it, and deletes it at
# the end even if a check fails.
set -uo pipefail

CLI_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CLI_JS="$CLI_DIR/dist/cli.js"
KEEP=0
SHELL_ONLY=0
for arg in "$@"; do
  case "$arg" in
    --keep) KEEP=1 ;;
    --shell) SHELL_ONLY=1 ;;
    -h|--help) sed -n '2,11p' "${BASH_SOURCE[0]}"; exit 0 ;;
    *) echo "unknown option: $arg" >&2; exit 2 ;;
  esac
done

if [ ! -f "$CLI_JS" ]; then
  echo "Build it first:  cd $CLI_DIR && npm run build" >&2
  exit 1
fi

if [ -z "${UPSTASH_BOX_API_KEY:-}" ] && [ -f "$CLI_DIR/../sdk/.env" ]; then
  set -a; . "$CLI_DIR/../sdk/.env"; set +a
fi
unset UPSTASH_BOX_BASE_URL
if [ -z "${UPSTASH_BOX_API_KEY:-}" ]; then
  echo "Set UPSTASH_BOX_API_KEY first." >&2
  exit 1
fi

# The published `box` is an older build, so put this one first on PATH. Doing it
# through a shim means every command below reads exactly as it would for a user.
BIN="$(mktemp -d)/bin"
mkdir -p "$BIN"
printf '#!/bin/sh\nexec node %s "$@"\n' "$CLI_JS" > "$BIN/box"
chmod +x "$BIN/box"
export PATH="$BIN:$PATH"

WORK="$(mktemp -d)"
cd "$WORK" || exit 1

if [ "$SHELL_ONLY" = 1 ]; then
  echo "box -> $(command -v box) ($(box --version))"
  echo "working directory: $WORK"
  echo "Try:  box create --no-repl --runtime node   then   box exec -- uname -a"
  echo "Exit the shell when done. Delete any box you create with: box delete --yes"
  exec "${SHELL:-/bin/bash}"
fi

PASS=0
FAIL=0
BOX_ID=""

cleanup() {
  if [ -n "$BOX_ID" ] && [ "$KEEP" = 0 ]; then
    echo
    echo "cleaning up $BOX_ID"
    box delete --yes "$BOX_ID" >/dev/null 2>&1 || echo "  could not delete $BOX_ID, remove it in the console"
  elif [ -n "$BOX_ID" ]; then
    echo
    echo "left alive: $BOX_ID   (delete with: box delete --yes $BOX_ID)"
  fi
  rm -rf "$WORK" "$(dirname "$BIN")"
}
trap cleanup EXIT

# check <name> <expected> <actual>
check() {
  if [ "$2" = "$3" ]; then
    printf '  ok    %s\n' "$1"
    PASS=$((PASS + 1))
  else
    printf '  FAIL  %s\n        expected: %s\n        actual:   %s\n' "$1" "$2" "$3"
    FAIL=$((FAIL + 1))
  fi
}

# check_contains <name> <needle> <haystack>
check_contains() {
  case "$3" in
    *"$2"*) printf '  ok    %s\n' "$1"; PASS=$((PASS + 1)) ;;
    *) printf '  FAIL  %s\n        wanted to find: %s\n        in:             %s\n' "$1" "$2" "$3"
       FAIL=$((FAIL + 1)) ;;
  esac
}

echo "box -> $(command -v box) ($(box --version))"
echo "working directory: $WORK"
echo

echo "create"
CREATE_LOG="$WORK/create.log"
BOX_ID=$(box create --no-repl --runtime node --name smoke-test 2>"$CREATE_LOG")
if [ -z "$BOX_ID" ]; then
  # Everything below needs a box, and comparing empty against empty would
  # report a wall of passes for a run that did nothing. Report the error this
  # attempt produced rather than making a second one, which would leak a box
  # if it happened to succeed.
  echo "  FAIL  could not create a box; the rest of the checks need one"
  echo
  sed 's/^/        /' "$CREATE_LOG"
  echo
  echo "----"
  echo "0 passed, 1 failed"
  exit 1
fi
check "prints one bare line on stdout, nothing else" "1" "$(printf '%s\n' "$BOX_ID" | wc -l | tr -d ' ')"
check "writes a .box pin naming it" "$BOX_ID" "$(cat .box 2>/dev/null)"
check_contains "status reports the box" "$BOX_ID" "$(box status 2>/dev/null)"

echo
echo "exec"
check "runs a command" "hello" "$(box exec -- echo hello 2>/dev/null)"
check "passes the remote exit code through" "7" "$(box exec -- 'exit 7' >/dev/null 2>&1; echo $?)"
check "succeeds with 0" "0" "$(box exec -- true >/dev/null 2>&1; echo $?)"
check "applies --cwd" "/tmp" "$(box exec -C /tmp -- pwd 2>/dev/null)"
check "keeps stdout clean when piped" "hello" "$(box exec -- echo hello 2>/dev/null | cat)"
JSON=$(box exec --json -- 'echo out; echo err >&2' 2>/dev/null)
check_contains "--json separates stdout and stderr" '"stderr": "err' "$JSON"
check "a CLI failure is 125, not a command status" "125" \
  "$(box --box no-such-box-here exec -- true >/dev/null 2>&1; echo $?)"

echo
echo "files"
printf 'console.log(2 + 3)\n' | box files write app.js - >/dev/null 2>&1
check "writes from stdin and the file runs" "5" "$(box exec -- node app.js 2>/dev/null)"
check "reads raw content back" "console.log(2 + 3)" "$(box files read app.js 2>/dev/null)"
check_contains "lists a directory" "app.js" "$(box files list 2>/dev/null)"
box files mkdir -p a/b/c >/dev/null 2>&1
check_contains "mkdir -p creates the tree" "b" "$(box files list a 2>/dev/null)"
box files rename app.js renamed.js >/dev/null 2>&1
check_contains "renames" "renamed.js" "$(box files list 2>/dev/null)"
check "refuses to remove a directory without -r" "125" \
  "$(box files remove a >/dev/null 2>&1; echo $?)"
check "removes a directory with -r" "0" "$(box files remove a -r >/dev/null 2>&1; echo $?)"

echo
echo "git"
box git clone https://github.com/octocat/Hello-World >/dev/null 2>&1
check_contains "clones into a directory named after the repo" "Hello-World" "$(box files list 2>/dev/null)"
box git clone https://github.com/octocat/Hello-World -C my-app >/dev/null 2>&1
check_contains "clones into an explicit -C destination" "my-app" "$(box files list 2>/dev/null)"
check "a clean tree is silent and exits 0" "0" "$(box git status -C Hello-World >/dev/null 2>&1; echo $?)"
check "the workspace root is reported as not a repository" "125" \
  "$(box git status >/dev/null 2>&1; echo $?)"
check_contains "and says why" "Not a git repository" "$(box git status 2>&1)"
box git config -C Hello-World --name "Smoke Test" --email smoke@example.com >/dev/null 2>&1
check_contains "sets and reads the identity" "Smoke Test" "$(box git config -C Hello-World 2>/dev/null)"
box git checkout -C Hello-World smoke-branch >/dev/null 2>&1
check "checkout accepts git's -b spelling too" "0" \
  "$(box git checkout -C Hello-World -b smoke-branch >/dev/null 2>&1; echo $?)"
printf 'from the smoke test\n' | box files write Hello-World/smoke.txt - >/dev/null 2>&1
check_contains "status shows the new file" "smoke.txt" "$(box git status -C Hello-World 2>/dev/null)"
box git exec -C Hello-World -- add -A >/dev/null 2>&1
check_contains "commits" "Committed" "$(box git commit -C Hello-World -m 'smoke commit' 2>/dev/null)"
check "git exec passes git's exit code through" "128" \
  "$(box git exec -- rev-parse --abbrev-ref HEAD >/dev/null 2>&1; echo $?)"
check "and reports the branch it is on" "smoke-branch" \
  "$(box git exec -C Hello-World -- rev-parse --abbrev-ref HEAD 2>/dev/null)"

echo
echo "expose"
box exec -- '( node -e "require(\"http\").createServer((_,r)=>r.end(\"alive\")).listen(3000)" > s.log 2>&1 & )' >/dev/null 2>&1
URL=$(box expose 3000 --json 2>/dev/null | sed -n 's/.*"url": "\([^"]*\)".*/\1/p')
check_contains "returns a public URL" "https://" "$URL"

# The server has to boot and the route has to propagate; how long that takes is
# not fixed, so poll instead of sleeping once and hoping.
BODY=""
for _ in 1 2 3 4 5 6 7 8 9 10; do
  BODY=$(curl -s --max-time 15 "$URL" 2>/dev/null)
  [ "$BODY" = "alive" ] && break
  sleep 3
done
check "the detached server answers on it" "alive" "$BODY"
check_contains "lists the exposed port" "3000" "$(box expose list 2>/dev/null)"
check "deletes the public URL" "0" "$(box expose delete 3000 >/dev/null 2>&1; echo $?)"

echo
echo "lifecycle"
check_contains "get reports details, not just the id" "smoke-test" "$(box get "$BOX_ID" 2>/dev/null)"
check_contains "pause reports paused" "Paused" "$(box pause 2>/dev/null)"
check "a paused box resumes on the next command" "back" "$(box exec -- echo back 2>/dev/null)"
check "delete refuses without --yes in a script" "125" "$(box delete >/dev/null 2>&1; echo $?)"
# Asks whether the box still exists, rather than running a command in it: an
# exec here has to wait out a resume and fails for reasons unrelated to delete.
check_contains "the box survives that refusal" "$BOX_ID" "$(box get "$BOX_ID" 2>/dev/null)"
DELETED=$(box delete --yes 2>/dev/null)
check_contains "delete --yes removes it" "Deleted" "$DELETED"
check "and clears the pin" "gone" "$([ -f .box ] && echo present || echo gone)"
BOX_ID=""

echo
echo "----"
echo "$PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ] || exit 1
