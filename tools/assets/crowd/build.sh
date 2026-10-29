#!/bin/sh
# Builds the stadium's crowd: every spectator in data/crowd.json made with MPFB in a background Blender (its own
# profile under the main checkout's assets-src/, as the players), rendered into assets-src/crowd/, then packed into
# public/assets/crowd/ (base.webp, shirt.webp) and data/crowd-atlas.json (the layout the game imports).
#   sh tools/assets/crowd/build.sh [name ...]     (names: re-render only those; the pack always takes them all)
set -e
cd "$(dirname "$0")/../../.."
BLENDER=${BLENDER:-/Applications/Blender.app/Contents/MacOS/Blender}
export BLENDER_USER_RESOURCES=${BLENDER_USER_RESOURCES:-$HOME/bandeja/assets-src/blender-user}
mkdir -p assets-src/crowd public/assets/crowd
"$BLENDER" -b --python tools/assets/crowd/make-crowd.py -- data/crowd.json assets-src/crowd "$@" 2>&1 \
  | grep -E "^CROWD|Error|Traceback" || true
"$BLENDER" -b --factory-startup --python tools/assets/crowd/pack.py -- assets-src/crowd public/assets/crowd \
  data/crowd-atlas.json 2>&1 | grep -E "^PACKED|Error|Traceback" || true
