# The second step for a cast MetaHuman (after conform_cast.py), in the open MHPilot editor through the queue. Set first:
#   NAME = 'p1'; HAIR = 'WI_Hair_S_Casual'; BROWS = 'WI_Eyebrows_M_Natural'; SKIN = None or (u, v)
#   exec(open('/Users/alexanderkopoyan/bandeja/tools/assets/metahuman/unreal/finish_cast.py').read())
# - skin tone (SKIN: MetaHuman's skin-tone map coordinates), rig (Epic's cloud auto-rig: the owner's Epic sign-in in this
#   editor), texture sources (cloud as well)
# - hair, brows, lashes and the default garment
# - the 'UE Optimized' build at Medium, every mesh to FBX and every texture to PNG in cast/<NAME>/export/
# Logs to cast/<NAME>/finish.log; each step logs and carries on to the next only if it worked.
import unreal, os, traceback

CAST = os.path.expanduser('~/bandeja-people-src/cast/' + NAME)
LOG = os.path.join(CAST, 'finish.log')
open(LOG, 'w').close()
OUTDIR = os.path.join(CAST, 'export')
os.makedirs(os.path.join(OUTDIR, 'tex'), exist_ok=True)


def log(s):
    with open(LOG, 'a') as f:
        f.write(str(s) + '\n')
    unreal.log('bandeja-finish: ' + str(s)[:300])


GROOMS = '/MetaHumanCharacter/Optional/Grooms/Bindings/'
WANT = [('Hair', GROOMS + 'Hair/%s.%s' % (HAIR, HAIR)),
        ('Eyebrows', GROOMS + 'Eyebrows/%s.%s' % (BROWS, BROWS)),
        ('Eyelashes', GROOMS + 'Eyelashes/WI_Eyelashes_S_Fine.WI_Eyelashes_S_Fine'),
        ('Outfits', '/MetaHumanCharacter/Optional/Clothing/WI_DefaultGarment.WI_DefaultGarment')]
path = '/Game/Cast/%s/MHC_%s' % (NAME, NAME)
ch = unreal.load_asset(path)
sub = unreal.get_editor_subsystem(unreal.MetaHumanCharacterEditorSubsystem)
if not sub.try_add_object_to_edit(ch):
    raise RuntimeError('cannot edit ' + path)
try:
    if SKIN:
        s = unreal.MetaHumanCharacterSkinSettings()
        s.skin = unreal.MetaHumanCharacterSkinProperties()
        s.skin.u, s.skin.v = SKIN
        s.enable_texture_overrides = False
        sub.commit_skin_settings(ch, s)
        log('skin tone %s' % (SKIN,))
    rq = unreal.MetaHumanCharacterAutoRiggingRequestParams()
    rq.blocking = True
    rq.report_progress = False
    rq.rig_type = getattr(unreal.MetaHumanRigType, 'JOINTS_AND_BLEND_SHAPES', unreal.MetaHumanRigType.JOINTS_ONLY)
    log('auto-rig (%s)...' % rq.rig_type)
    sub.request_auto_rigging(ch, rq)
    log('rig state after: %s' % sub.get_rigging_state(ch) if hasattr(sub, 'get_rigging_state') else 'rigged (no state call)')
    tq = unreal.MetaHumanCharacterTextureRequestParams()
    tq.blocking = True
    tq.report_progress = False
    log('texture sources...')
    sub.request_texture_sources(ch, tq)
    log('has_high_resolution_textures %s' % ch.get_editor_property('has_high_resolution_textures'))
    col = ch.internal_collection
    for slot, wpath in WANT:
        wi = unreal.load_asset(wpath)
        if not wi:
            log('missing wardrobe item %s' % wpath)
            continue
        key = col.try_add_item_from_wardrobe_item(slot, wi)
        ok = col.default_instance.try_add_slot_selection(unreal.MetaHumanPipelineSlotSelection(slot_name=slot, selected_item=key))
        log('%s <- %s : selected %s' % (slot, wpath.split('.')[-1], ok))
    sub.assemble_for_preview(character=ch)
    unreal.EditorAssetLibrary.save_loaded_asset(ch, only_if_is_dirty=False)
    log('saved')

    bp = unreal.MetaHumanCharacterEditorBuildParameters()
    bp.set_editor_property('pipeline_type', unreal.MetaHumanDefaultPipelineType.OPTIMIZED)
    bp.set_editor_property('pipeline_quality', unreal.MetaHumanQualityLevel.MEDIUM)
    bp.set_editor_property('name_override', 'Cast_' + NAME)
    log('build_meta_human returned %s' % (sub.build_meta_human(ch, bp),))
finally:
    if sub.is_object_added_for_editing(ch):
        sub.remove_object_to_edit(ch)


def export(obj, filename, options=None):
    t = unreal.AssetExportTask()
    t.object = obj
    t.filename = filename
    t.automated = True
    t.prompt = False
    t.replace_identical = True
    if options is not None:
        t.options = options
    log('export %s -> %s : %s' % (obj.get_name(), os.path.basename(filename), unreal.Exporter.run_asset_export_task(t)))


root = '/Game/MH/Unpacked/Cast_' + NAME
paths = unreal.EditorAssetLibrary.list_assets(root, recursive=True, include_folder=False)
if not paths:
    paths = [p for p in unreal.EditorAssetLibrary.list_assets('/Game', recursive=True, include_folder=False) if 'Cast_' + NAME in p]
log('%d assets under %s' % (len(paths), root))
for p in paths:
    a = unreal.load_asset(p)
    if not a:
        continue
    cls = a.get_class().get_name()
    if cls in ('SkeletalMesh', 'StaticMesh'):
        o = unreal.FbxExportOption()
        for k, v in (('ascii', False), ('level_of_detail', True), ('export_morph_targets', True), ('collision', False), ('vertex_color', True)):
            try:
                o.set_editor_property(k, v)
            except Exception as e:
                log('fbx option %s: %s' % (k, e))
        export(a, os.path.join(OUTDIR, a.get_name() + '.fbx'), o)
    elif cls == 'Texture2D':
        export(a, os.path.join(OUTDIR, 'tex', a.get_name() + '.png'))
log('DONE')
