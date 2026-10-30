# Builds one player with MPFB (MakeHuman's Blender add-on, GPL; its assets CC0) in a background Blender:
# a body from macro settings on MPFB's Mixamo rig, a skin, eyes, brows, lashes, hair, clothes and shoes.
#
#   BLENDER_USER_RESOURCES=<repo>/../bandeja/assets-src/blender-user \
#     blender -b --python tools/assets/mpfb/make-player.py -- <player.json> <ybot-rest.json> <out-dir> [--preview]
#
# then finish-player.py's finish() puts it on the game skeleton and exports it (same session).
#
# The add-on and the asset packs live in that isolated Blender profile (assets-src/, gitignored), never in the
# owner's own Blender settings. player.json: {"name", "macro": {...}, "skin", "eyes", "eyebrows", "eyelashes",
# "hair", "clothes": [...], "shorts": metres above the floor to cut trouser legs at (optional)}.
import sys, os, json
import bpy, addon_utils

args = sys.argv[sys.argv.index('--') + 1:]
spec = json.load(open(args[0]))
yb = json.load(open(args[1]))
out = args[2]
preview = '--preview' in args
os.makedirs(out, exist_ok=True)

addon_utils.enable('bl_ext.user_default.mpfb', default_set=True)
from bl_ext.user_default.mpfb.services.humanservice import HumanService
from bl_ext.user_default.mpfb.services.assetservice import AssetService
from bl_ext.user_default.mpfb.services.targetservice import TargetService

for o in list(bpy.data.objects):
    bpy.data.objects.remove(o, do_unlink=True)

body = HumanService.create_human(macro_detail_dict=spec['macro'], scale=0.1)
# The bones of this one face, on the macro's average head: MakeHuman's detail targets ("face": {"nose/nose-hump-incr": 0.25}),
# asymmetry among them (nobody's face is the same on both sides); "build" the same for the body's measures.
targets_dir = os.path.join(os.path.dirname(TargetService.target_full_path('head-oval') or ''), '..')
for key, weight in {**spec.get('face', {}), **spec.get('build', {})}.items():
    TargetService.load_target(body, os.path.normpath(os.path.join(targets_dir, key + '.target.gz')), weight=weight, name=key.split('/')[-1])
rig = HumanService.add_builtin_rig(body, 'mixamo')


def asset(kind, name, ext='.mhclo'):
    p = AssetService.find_asset_absolute_path(name + ext, asset_subdir=kind)
    if p is None:
        p = AssetService.find_asset_absolute_path(name + '/' + name + ext, asset_subdir=kind)
    if p is None:
        raise IOError(f'no {kind} asset {name}')
    return p


HumanService.set_character_skin(asset('skins', spec['skin'], '.mhmat'), body, skin_type='GAMEENGINE')
# Teeth and tongue: an open mouth (the expression morphs) shows them.
spec.setdefault('teeth', 'teeth_base')
spec.setdefault('tongue', 'tongue01')
for part in ('eyes', 'eyebrows', 'eyelashes', 'hair', 'teeth', 'tongue'):
    if spec.get(part):
        HumanService.add_mhclo_asset(asset(part, spec[part]), body, asset_type=part, subdiv_levels=0,
                                     material_type='MAKESKIN')
for c in spec.get('clothes', []):
    HumanService.add_mhclo_asset(asset('clothes', c), body, asset_type='Clothes', subdiv_levels=0,
                                 material_type='MAKESKIN')

# Subdivision off everywhere (a game mesh).
for o in bpy.data.objects:
    if o.type != 'MESH':
        continue
    for m in list(o.modifiers):
        if m.type == 'SUBSURF':
            o.modifiers.remove(m)

print('PLAYER', spec['name'], 'meshes', [(o.name, len(o.data.vertices)) for o in bpy.data.objects if o.type == 'MESH'])
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(out, spec['name'] + '.blend'))

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import importlib
finish_player = importlib.import_module('finish-player')
finish_player.finish(yb, spec, out, preview)
