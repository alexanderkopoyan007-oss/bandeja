#!/bin/sh
# The golden club's sky (DECISIONS.md "The golden club"): the CC0 HDR in assets-src/golden/sky/ (Poly Haven
# hilly_terrain_01_puresky since round 5, SKY= another; rustig_koppie_puresky before, 4k) -> public/assets/arena/golden/sky.webp, and the numbers data/arenas.json `club-golden` takes
# (hdri.scale, light.key.dir and intensity). Arguments: the sun's azimuth (deg, atan2(z, x)) and its irradiance wanted.
#   sh tools/assets/golden/build-sky.sh [-55] [3.8]
set -e
cd "$(dirname "$0")/../../.."
/Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup --python tools/assets/golden/sky_read.py -- \
  "assets-src/golden/sky/${SKY:-hilly_terrain_01_puresky}_4k.hdr" assets-src/golden/sky/sky2k.npy
mkdir -p public/assets/arena/golden
~/bandeja-mocap/venv/bin/python -I tools/assets/golden/sky.py assets-src/golden/sky/sky2k.npy public/assets/arena/golden/sky.webp "${1:--55}" "${2:-3.8}"
