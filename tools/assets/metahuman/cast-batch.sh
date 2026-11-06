#!/bin/sh
# The current cast as MetaHumans, one name after another: the MPFB person made afresh (make-player.py --blend-only), its
# body and portrait out (cast-export.py), then in the open
# MHPilot editor (the queue watcher unreal/mhwatch.py running; the owner signed in to Epic for the cloud steps) conform,
# rig + textures + wardrobe + Optimized build (finish), DCC maps, the outfit-less full build; then the game's body
# (mh-player.py) and the pack (build-people.mjs) as <name>mh. Settings per name in cast.json.
#   sh tools/assets/metahuman/cast-batch.sh p2 p3 ...
# Logs go to ~/bandeja-people-src/cast/<name>/*.log; a step that fails stops that name and moves to the next.
cd "$(dirname "$0")/../../.."
BLENDER=${BLENDER:-/Applications/Blender.app/Contents/MacOS/Blender}
CAST=$HOME/bandeja-people-src/cast
U=$PWD/tools/assets/metahuman/unreal
YB=${YB:-$PWD/assets-src/people/ybot-rest.json}
q() {  # q <name> <script> [python lines before the exec]
  f=$CAST/$1/q_$2.py
  { echo "NAME = '$1'"; [ -n "$3" ] && printf '%s\n' "$3"; echo "exec(open('$U/$2.py').read())"; } > "$f"
  r=$(sh "$U/mhq.sh" "$f" 3600)
  [ "$r" = "OK" ] || { echo "$1: $2 failed: $r"; return 1; }
}
for n in "$@"; do
  echo "== $n $(date +%H:%M:%S)"
  set -- $(node -e "const c=require('./tools/assets/metahuman/cast.json')['$n'];console.log(c.hair,c.brows,c.skin.join(','))")
  HAIR=$1 BROWS=$2 SKIN=$3
  mkdir -p "$CAST/$n"
  rm -f "$CAST/$n/portrait.png" "$CAST/$n/target.fbx"
  # (the person as data/players has them now, made afresh by MPFB: the old builds' files predate their faces and builds)
  BLENDER_USER_RESOURCES=${BLENDER_USER_RESOURCES:-$HOME/bandeja/assets-src/blender-user} "$BLENDER" -b --python tools/assets/mpfb/make-player.py \
    -- data/players/$n.json "$YB" "$CAST/$n/mpfb" --blend-only </dev/null 2>&1 | grep -E "^PLAYER|Error|Traceback" | cut -c1-200 || true
  "$BLENDER" -b "$CAST/$n/mpfb/$n.blend" --python tools/assets/metahuman/cast-export.py -- "$CAST/$n" </dev/null 2>&1 | grep -E "^CAST (height|wrote)|Error" || true
  [ -f "$CAST/$n/portrait.png" ] || { echo "$n: no portrait"; continue; }
  q $n conform_cast || continue
  q $n finish_cast "HAIR = '$HAIR'
BROWS = '$BROWS'
SKIN = ($SKIN)" || continue
  q $n dcc_cast || continue
  q $n full_cast || continue
  node tools/assets/metahuman/cast-spec.mjs $n > tools/assets/metahuman/people/${n}mh.json || continue
  "$BLENDER" -b --python tools/assets/metahuman/mh-player.py -- tools/assets/metahuman/people/${n}mh.json assets-src/people/${n}mh "$YB" </dev/null \
    > "$CAST/$n/player.log" 2>&1
  grep -E "^MH wrote|Error|Traceback" "$CAST/$n/player.log"
  node tools/assets/build-people.mjs ${n}mh 2>&1 | tail -1
done
echo "== done $(date +%H:%M:%S)"
