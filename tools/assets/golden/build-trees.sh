#!/bin/sh
# The golden club's impostor trees (DECISIONS.md "The golden club"): each CC0 tree in assets-src/golden/<id>/ rendered from
# eight sides (impostor.py, Cycles, about 2 minutes a tree), then its atlases to WebP (atlas.py). Prints each one's frame and
# foot for data/arenas.json `grove.trees.kinds`.
#   sh tools/assets/golden/build-trees.sh
set -e
cd "$(dirname "$0")/../../.."
mkdir -p assets-src/golden/impostors public/assets/arena/golden
B=/Applications/Blender.app/Contents/MacOS/Blender
$B -b --factory-startup --python tools/assets/golden/impostor.py -- assets-src/golden/island_tree_01/island_tree_01.gltf assets-src/golden/impostors olive 8 512 | grep IMPOSTOR
$B -b --factory-startup --python tools/assets/golden/impostor.py -- assets-src/golden/island_tree_02/island_tree_02.gltf assets-src/golden/impostors olive2 8 512 | grep IMPOSTOR
$B -b --factory-startup --python tools/assets/golden/impostor.py -- assets-src/golden/tree_small_02/tree_small_02.gltf assets-src/golden/impostors broadleaf 8 512 | grep IMPOSTOR
~/bandeja-mocap/venv/bin/python -I tools/assets/golden/atlas.py assets-src/golden/impostors public/assets/arena/golden olive olive2 broadleaf
