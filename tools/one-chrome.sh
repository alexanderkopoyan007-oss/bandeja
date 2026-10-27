#!/bin/bash
# tools/one-chrome.sh <command...> : run a command that starts a headless Chrome while holding the machine-wide
# one-Chrome lock. The owner's laptop runs one headless Chrome at a time; this is the same lock and queue that the
# Meridian project's tools/audit/one-chrome.sh uses, so BANDEJA's browser tools wait their turn instead of running
# beside another project's Chrome (copied from there 2026-10-27; keep LOCK/Q identical).
LOCK=/tmp/meridian-one-chrome.lock Q=/tmp/meridian-one-chrome.queue
mkdir -p "$Q"
since=$(date -j -f "%a %b %e %T %Y" "$(ps -o lstart= -p $PPID 2>/dev/null | sed 's/ *$//')" +%s 2>/dev/null)
now=$(perl -MTime::HiRes=time -e 'printf "%d", time')
[ -z "$since" ] || [ "$since" -gt "$now" ] && since=$now
T="$Q/$(printf '%012d000' "$since")-$$"
: > "$T"
trap 'unlink "$T" 2>/dev/null' EXIT
first() { for t in $(ls "$Q" 2>/dev/null | sort); do p=${t##*-}; if kill -0 "$p" 2>/dev/null; then echo "$Q/$t"; return; fi; unlink "$Q/$t" 2>/dev/null; done; }
for i in $(seq 1 7200); do
  if [ "$(first)" = "$T" ] && mkdir "$LOCK" 2>/dev/null; then
    unlink "$T" 2>/dev/null
    "$@" & pid=$!
    trap 'kill $pid 2>/dev/null; rmdir "$LOCK" 2>/dev/null' EXIT
    while kill -0 $pid 2>/dev/null; do touch "$LOCK"; for j in $(seq 1 30); do kill -0 $pid 2>/dev/null || break; perl -e 'select(undef,undef,undef,1)'; done; done
    wait $pid; exit $?
  fi
  if [ -n "$(find "$LOCK" -maxdepth 0 -mmin +20 2>/dev/null)" ]; then rmdir "$LOCK"; fi
  perl -e 'select(undef,undef,undef,1)'
done
echo "one-chrome: lock busy for 2 hours" >&2; exit 75
