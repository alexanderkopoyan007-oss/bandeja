#!/bin/sh
# Builds every person in data/players/ with MPFB in a background Blender (its own profile under the main
# checkout's assets-src/, see make-player.py), then packs them for the game (tools/assets/build-people.mjs).
#   sh tools/assets/mpfb/build-all.sh [--preview] [name ...]
set -e
cd "$(dirname "$0")/../../.."
PREVIEW=""
if [ "$1" = "--preview" ]; then PREVIEW="--preview"; shift; fi
NAMES="$*"
[ -z "$NAMES" ] && NAMES=$(ls data/players/*.json | xargs -n1 basename | sed 's/\.json$//')
BLENDER=${BLENDER:-/Applications/Blender.app/Contents/MacOS/Blender}
export BLENDER_USER_RESOURCES=${BLENDER_USER_RESOURCES:-$HOME/bandeja/assets-src/blender-user}
mkdir -p assets-src/people
node tools/assets/mpfb/ybot-rest.mjs assets-src/people/ybot-rest.json
for n in $NAMES; do
  "$BLENDER" -b --python tools/assets/mpfb/make-player.py -- data/players/$n.json assets-src/people/ybot-rest.json \
    assets-src/people/$n $PREVIEW 2>&1 | grep -E "^(PLAYER|HEIGHT|SHORTS|COVERED|ALIGN|MESH|WROTE|FACE|MASKED|AO|PAINT|FIT)|Error|Traceback|line [0-9]+" || true
  [ -f assets-src/people/$n/body.json ] || { echo "no body for $n"; exit 1; }
done
node tools/assets/build-people.mjs $NAMES
