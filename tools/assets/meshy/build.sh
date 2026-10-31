#!/bin/sh
# The Meshy pilot's person, from the GLB to public/assets/people/meshy*: see decimate-bake.py and rig.py.
#   sh tools/assets/meshy/build.sh <person.glb> <work-dir>
# (work-dir holds the full-size bakes; assets-src/ and the work dir stay out of git. Only the packed game files are committed, on the
# private meshy-pilot branch.)
set -e
cd "$(dirname "$0")/../../.."
GLB=$1; WORK=$2
BLENDER=${BLENDER:-/Applications/Blender.app/Contents/MacOS/Blender}
export BLENDER_USER_RESOURCES=${BLENDER_USER_RESOURCES:-$HOME/bandeja/assets-src/blender-user}
node tools/assets/meshy/read-person.mjs p1 "$WORK/p1"
[ -n "$SKIP_BAKE" ] || "$BLENDER" -b --python tools/assets/meshy/decimate-bake.py -- "$GLB" "$WORK/low" 40000 2>&1 | grep -E "^MESHY|Error|Traceback|line [0-9]+"
mkdir -p assets-src/people/meshy
"$BLENDER" -b --python tools/assets/meshy/rig.py -- "$WORK/low" "$WORK/p1" assets-src/people/meshy 2>&1 | grep -E "^RIG|Error|Traceback|line [0-9]+"
cp "$WORK/low/opaque.webp" assets-src/people/meshy/opaque.webp
[ -f assets-src/people/meshy/alpha.webp ] || "$BLENDER" -b --python-expr "import bpy; im = bpy.data.images.new('a', 4, 4, alpha=True); im.pixels.foreach_set([0.0] * 64); im.file_format = 'WEBP'; im.save(filepath='$PWD/assets-src/people/meshy/alpha.webp', quality=90)" >/dev/null 2>&1
node tools/assets/build-people.mjs meshy
cp "$WORK/low/normal.webp" public/assets/people/meshy-normal.webp
