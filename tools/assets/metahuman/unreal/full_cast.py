# The default build of a cast MetaHuman (every LOD of its face and body: the Optimized build at Medium keeps the face
# from LOD3 down), its body and face skeletal meshes to FBX in cast/<NAME>/full. Set NAME first, as conform_cast.py.
# Logs to cast/<NAME>/full.log.
import unreal, os, traceback

CAST = os.path.expanduser('~/bandeja-people-src/cast/' + NAME)
LOG = os.path.join(CAST, 'full.log')
open(LOG, 'w').close()
OUTDIR = os.path.join(CAST, 'full')
os.makedirs(OUTDIR, exist_ok=True)


def log(s):
    with open(LOG, 'a') as f:
        f.write(str(s) + '\n')


ch = unreal.load_asset('/Game/Cast/%s/MHC_%s' % (NAME, NAME))
sub = unreal.get_editor_subsystem(unreal.MetaHumanCharacterEditorSubsystem)
added = not sub.is_object_added_for_editing(ch) and bool(sub.try_add_object_to_edit(ch))
# Built without its outfit: with one, the build drops the body's skin under the garment, and the game needs the skin
# behind the collar (and decides itself what the kit hides). The outfit goes back on afterwards.
inst = ch.internal_collection.default_instance
outfit = [x.selection.selected_item for x in inst.get_slot_selection_data() if str(x.selection.slot_name) == 'Outfits']
inst.set_single_slot_selection('Outfits', unreal.MetaHumanPaletteItemKey())
log('outfit off for the build (had %d)' % len(outfit))
try:
    bp = unreal.MetaHumanCharacterEditorBuildParameters()
    bp.set_editor_property('name_override', 'Full_' + NAME)
    log('build_meta_human returned %s' % (sub.build_meta_human(ch, bp),))
except Exception:
    log(traceback.format_exc())
finally:
    if outfit:
        inst.set_single_slot_selection('Outfits', outfit[0])
        unreal.EditorAssetLibrary.save_loaded_asset(ch, only_if_is_dirty=False)
        log('outfit back on: %s' % [str(x.selection.slot_name) for x in inst.get_slot_selection_data()])
    if added and sub.is_object_added_for_editing(ch):
        sub.remove_object_to_edit(ch)
paths = [p for p in unreal.EditorAssetLibrary.list_assets('/Game', recursive=True, include_folder=False) if 'Full_' + NAME in p]
log('%d assets' % len(paths))
for p in paths:
    a = unreal.load_asset(p)
    if not a or a.get_class().get_name() != 'SkeletalMesh' or not any(k in a.get_name() for k in ('BodyMesh', 'FaceMesh')):
        continue
    o = unreal.FbxExportOption()
    for k, v in (('ascii', False), ('level_of_detail', True), ('export_morph_targets', True), ('collision', False)):
        try:
            o.set_editor_property(k, v)
        except Exception as e:
            log('fbx option %s: %s' % (k, e))
    t = unreal.AssetExportTask()
    t.object = a
    t.filename = os.path.join(OUTDIR, a.get_name() + '.fbx')
    t.automated = True
    t.prompt = False
    t.replace_identical = True
    t.options = o
    log('export %s : %s' % (a.get_name(), unreal.Exporter.run_asset_export_task(t)))
log('DONE')
