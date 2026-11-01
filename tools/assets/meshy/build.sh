#!/bin/sh
# A Meshy person, from the GLB to public/assets/people/<name>*: see decimate-bake.py, fit.py and rig.py.
#   sh tools/assets/meshy/build.sh <name> <person.glb> <work-dir> <height, soles to the top of the hair>
# (work-dir holds the full-size bakes; assets-src/ and the work dir stay out of git. Only the packed game files are committed.)
# tools/assets/meshy/marks/<name>.json are the person's joints: fit.py writes it if it isn't there.
set -e
cd "$(dirname "$0")/../../.."
NAME=$1; GLB=$2; WORK=$3; HEIGHT=$4
BLENDER=${BLENDER:-/Applications/Blender.app/Contents/MacOS/Blender}
BPY=$(ls -d "$(dirname "$BLENDER")"/../Resources/*/python/bin/python3* | head -1)
export BLENDER_USER_RESOURCES=${BLENDER_USER_RESOURCES:-$HOME/bandeja/assets-src/blender-user}
OUT=assets-src/people/$NAME
node tools/assets/meshy/read-person.mjs p1 "$WORK/p1"
[ -n "$SKIP_BAKE" ] || "$BLENDER" -b --python tools/assets/meshy/decimate-bake.py -- "$GLB" "$WORK/low" 40000 "$HEIGHT" 2>&1 | grep -E "^MESHY|Error|Traceback|line [0-9]+"
MARKS=tools/assets/meshy/marks/$NAME.json
[ -f "$MARKS" ] || "$BPY" -I tools/assets/meshy/fit.py "$WORK/low" "$MARKS" | grep -E "^FIT (tip|upper|elbow|side|reach|arms|finger|thumb)"
mkdir -p "$OUT"
"$BLENDER" -b --python tools/assets/meshy/rig.py -- "$WORK/low" "$WORK/p1" "$OUT" "$MARKS" "$NAME" 2>&1 | grep -E "^RIG|Error|Traceback|line [0-9]+"
cp "$WORK/low/opaque.webp" "$OUT/opaque.webp"
[ -f "$OUT/alpha.webp" ] || "$BLENDER" -b --python-expr "import bpy; im = bpy.data.images.new('a', 4, 4, alpha=True); im.pixels.foreach_set([0.0] * 64); im.file_format = 'WEBP'; im.save(filepath='$PWD/$OUT/alpha.webp', quality=90)" >/dev/null 2>&1
node tools/assets/build-people.mjs "$NAME"
cp "$WORK/low/normal.webp" "public/assets/people/$NAME-normal.webp"
