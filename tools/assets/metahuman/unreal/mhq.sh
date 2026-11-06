#!/bin/sh
# Sends a Python file to the open MHPilot editor through mhwatch.py's queue and waits for it (up to $2 seconds, default 1800).
Q=$HOME/bandeja-people-src/mh-queue
N=$(date +%s)-$$-$(basename "$1" .py)
cp "$1" "$Q/$N.py.tmp" && mv "$Q/$N.py.tmp" "$Q/$N.py"
i=0; while [ ! -f "$Q/$N.done" ]; do sleep 1; i=$((i+1)); [ $i -ge ${2:-1800} ] && { echo "TIMEOUT waiting for $N"; exit 1; }; done
cat "$Q/$N.done"; echo
