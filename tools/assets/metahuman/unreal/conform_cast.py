# A MetaHuman conformed to one of BANDEJA's current players (Epic's example_conform_from_custom_mesh), run in the open
# MHPilot editor through the queue: set NAME first, e.g. a queue file of
#   NAME = 'p1'; exec(open('/Users/alexanderkopoyan/bandeja/tools/assets/metahuman/unreal/conform_cast.py').read())
# Reads ~/bandeja-people-src/cast/<NAME>/{target.fbx, portrait.png, camera.json} (tools/assets/metahuman/cast-export.py in
# the game's repo), imports the target as a static mesh, creates /Game/Cast/<NAME>/MHC_<NAME>, conforms its face (the
# portrait's landmarks) and body (the mesh) to it, commits the result as MetaHuman's A pose and saves.
# Logs to cast/<NAME>/conform.log.
import unreal, os, json, traceback

CAST = os.path.expanduser('~/bandeja-people-src/cast/' + NAME)
LOG = os.path.join(CAST, 'conform.log')
open(LOG, 'w').close()


def log(s):
    with open(LOG, 'a') as f:
        f.write(str(s) + '\n')
    unreal.log('bandeja-conform: ' + str(s)[:300])


PKG = '/Game/Cast/' + NAME
ASSET = 'MHC_' + NAME
sub = unreal.get_editor_subsystem(unreal.MetaHumanCharacterEditorSubsystem)
cam = json.load(open(os.path.join(CAST, 'camera.json')))

# 1. The target mesh.
task = unreal.AssetImportTask()
task.filename = os.path.join(CAST, 'target.fbx')
task.destination_path = PKG
task.destination_name = 'SM_' + NAME + '_target'
task.automated = True
task.replace_existing = True
task.save = True
opts = unreal.FbxImportUI()
opts.import_mesh = True
opts.import_as_skeletal = False
opts.import_materials = False
opts.import_textures = False
opts.import_animations = False
opts.mesh_type_to_import = unreal.FBXImportType.FBXIT_STATIC_MESH
task.options = opts
unreal.AssetToolsHelpers.get_asset_tools().import_asset_tasks([task])
log('imported %s' % list(task.imported_object_paths))
mesh_path = next((p for p in task.imported_object_paths if 'SM_' in p), None) or (PKG + '/SM_' + NAME + '_target')
target = unreal.load_asset(mesh_path)
if target is None:
    raise RuntimeError('no target mesh at ' + mesh_path)
bb = target.get_bounding_box()
log('target %s bounds min %s max %s' % (target.get_class().get_name(), bb.min, bb.max))

# 2. The portrait's landmarks.
size, pixels = unreal.PromotedFrameUtils.get_promoted_frame_as_pixel_array_from_disk(os.path.join(CAST, 'portrait.png'))
res = sub.track_face_landmarks_from_image(pixels, size.x, size.y)
if isinstance(res, tuple) and len(res) == 1:
    res = res[0]
curves = res if (res and hasattr(res, 'items')) else None
if not curves:
    raise RuntimeError('no face landmarks found on the portrait')
log('%d landmark curves on a %dx%d portrait' % (len(curves), size.x, size.y))

verts, idx, *_ = sub.get_mesh_data_for_conforming(target)
log('target: %d vertices, %d triangles' % (len(verts), len(idx) // 3))

# 3. The character, conformed.
path = PKG + '/' + ASSET
if unreal.EditorAssetLibrary.does_asset_exist(path):
    unreal.EditorAssetLibrary.delete_asset(path)
ch = unreal.AssetToolsHelpers.get_asset_tools().create_asset(asset_name=ASSET, package_path=PKG, asset_class=unreal.MetaHumanCharacter,
                                                              factory=unreal.new_object(type=unreal.MetaHumanCharacterFactoryNew))
if not sub.try_add_object_to_edit(ch):
    raise RuntimeError('cannot edit ' + path)
ok = False
try:
    p = unreal.ConformTargetParams()
    p.conform_target_mesh.target_parts_type = unreal.TargetPartsType.COMBINED
    p.conform_target_mesh.body_vertices = verts
    p.conform_target_mesh.body_vertex_indices = idx
    p.estimate_body_joints_from_mesh = True
    p.auto_solve = True
    p.body_conform_solve_settings.pipeline_name = 'combined'
    v = unreal.MinimalViewInfo()
    v.location = unreal.Vector(*cam['location'])
    v.rotation = unreal.Rotator(pitch=cam['rotation']['pitch'], yaw=cam['rotation']['yaw'], roll=cam['rotation']['roll'])
    v.fov = cam['fov']
    v.aspect_ratio = float(size.x) / float(size.y)
    v.projection_mode = unreal.CameraProjectionMode.PERSPECTIVE
    p.curve_tracking_points = curves
    p.camera_view_info = v
    p.image_size = size
    key = unreal.MetaHumanCharacterTargetMeshKey()
    key.combined_mesh = target
    log('conforming...')
    if not sub.conform_to_target_meshes(ch, key, p):
        raise RuntimeError('conform_to_target_meshes failed')
    sub.commit_posed_state_as_a_pose(ch, key)
    unreal.EditorAssetLibrary.save_asset(path, only_if_is_dirty=False)
    log('conformed and saved ' + path)
    ok = True
except Exception:
    log(traceback.format_exc())
    raise
finally:
    if sub.is_object_added_for_editing(ch):
        sub.remove_object_to_edit(ch)
    if not ok:
        unreal.EditorAssetLibrary.delete_asset(path)
log('DONE')
