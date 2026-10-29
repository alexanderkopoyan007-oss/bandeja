# The stadium's spectators: MakeHuman people made with MPFB 2 (CC0 assets) in a background Blender, each posed
# seated, clapping (hands apart, hands together) and standing with the arms up, rendered from 7 angles round the
# front, twice: once with a white shirt and once with a black one, so the game can tint each seat's shirt exactly
# (tools/assets/crowd/pack.py: the black render is the rest of the person, the difference is the light on the shirt).
#
#   BLENDER_USER_RESOURCES=<main checkout>/assets-src/blender-user \
#     blender -b --python tools/assets/crowd/make-crowd.py -- data/crowd.json <out-dir> [name ...]
#
# The clothes' own textures are never used (some carry logos or a branded shoe photo): plain materials instead.
import sys, os, json, math
import bpy, addon_utils
from mathutils import Vector, Matrix

args = sys.argv[sys.argv.index('--') + 1:]
spec = json.load(open(args[0]))
out = args[1]
only = set(args[2:])
os.makedirs(out, exist_ok=True)

addon_utils.enable('bl_ext.user_default.mpfb', default_set=True)
from bl_ext.user_default.mpfb.services.humanservice import HumanService
from bl_ext.user_default.mpfb.services.assetservice import AssetService

P = 'mixamorig:'
# Each frame covers W x H metres (the person centred across it, the floor at the bottom), rendered at 2x the cell.
W, H = 1.125, 2.25
CELL = (64, 128)
SS = 2
VIEWS = [-90, -60, -30, 0, 30, 60, 90]
ELEV = 10
POSES = ['sit', 'clapA', 'clapB', 'cheer']
SHIRT_WHITE = 0.85
MACRO_DEFAULT = {'proportions': 0.5, 'cupsize': 0.5, 'firmness': 0.5}


def asset(kind, name, ext='.mhclo'):
    p = AssetService.find_asset_absolute_path(name + ext, asset_subdir=kind)
    if p is None:
        p = AssetService.find_asset_absolute_path(name + '/' + name + ext, asset_subdir=kind)
    if p is None:
        raise IOError(f'no {kind} asset {name}')
    return p


def clear():
    for o in list(bpy.data.objects):
        bpy.data.objects.remove(o, do_unlink=True)
    for coll in (bpy.data.meshes, bpy.data.materials, bpy.data.armatures, bpy.data.images):
        for x in list(coll):
            if x.users == 0:
                coll.remove(x)


def plain(name, rgb, rough=0.8):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    bsdf = m.node_tree.nodes.get('Principled BSDF')
    bsdf.inputs['Base Color'].default_value = (rgb[0], rgb[1], rgb[2], 1)
    bsdf.inputs['Roughness'].default_value = rough
    return m


def build(c):
    clear()
    macro = dict(MACRO_DEFAULT)
    macro.update(c['macro'])
    body = HumanService.create_human(macro_detail_dict=macro, scale=0.1)
    rig = HumanService.add_builtin_rig(body, 'mixamo')
    HumanService.set_character_skin(asset('skins', c['skin'], '.mhmat'), body, skin_type='GAMEENGINE')
    for kind, name in (('eyes', 'low-poly'), ('eyebrows', c['eyebrows']), ('eyelashes', 'eyelashes01'), ('hair', c['hair'])):
        HumanService.add_mhclo_asset(asset(kind, name), body, asset_type=kind, subdiv_levels=0, material_type='MAKESKIN')
    clothes = {'suit': c['suit'], 'shoes': c['shoesAsset']}
    if c.get('hat'):
        clothes['hat'] = c['hat']
    for k, name in clothes.items():
        HumanService.add_mhclo_asset(asset('clothes', name), body, asset_type='Clothes', subdiv_levels=0, material_type='MAKESKIN')
    for o in bpy.data.objects:
        if o.type == 'MESH':
            for m in list(o.modifiers):
                if m.type == 'SUBSURF':
                    o.modifiers.remove(m)
    # Plain materials on the clothes: the suit split at the hips into a shirt (tinted in the game) and trousers.
    hips = rig.matrix_world @ rig.data.bones[P + 'Hips'].head_local
    top = plain('top', (SHIRT_WHITE,) * 3, 0.85)
    bottom = plain('bottom', c['bottom'], 0.75)
    shoes = plain('shoes', c['shoes'], 0.6)
    hat = plain('hat', (0.07, 0.07, 0.08), 0.7)
    for o in bpy.data.objects:
        if o.type != 'MESH':
            continue
        n = o.name
        if n.endswith(c['suit']):
            o.data.materials.clear()
            o.data.materials.append(top)
            o.data.materials.append(bottom)
            mw = o.matrix_world
            for poly in o.data.polygons:
                z = (mw @ poly.center).z
                poly.material_index = 0 if z > hips.z + 0.03 else 1
        elif n.endswith(c['shoesAsset']):
            o.data.materials.clear()
            o.data.materials.append(shoes)
        elif c.get('hat') and n.endswith(c['hat']):
            o.data.materials.clear()
            o.data.materials.append(hat)
    return rig, top


def aim(rig, n, d):
    """Turn bone n (and so its children) so its head-to-tail points along d (armature space, the smallest turn)."""
    pb = rig.pose.bones[P + n]
    h = pb.head.copy()
    d0 = pb.tail - pb.head
    R = d0.rotation_difference(Vector(d).normalized()).to_matrix().to_4x4()
    pb.matrix = Matrix.Translation(h) @ R @ Matrix.Translation(-h) @ pb.matrix
    bpy.context.view_layer.update()


def pose(rig, kind):
    for pb in rig.pose.bones:
        pb.matrix_basis = Matrix.Identity(4)
    bpy.context.view_layer.update()
    # Facing -Y; the person's left is +X.
    for s, sx in (('Left', 1), ('Right', -1)):
        if kind == 'cheer':
            aim(rig, s + 'UpLeg', (0.07 * sx, 0.0, -1))
            aim(rig, s + 'Leg', (0.03 * sx, 0.04, -1))
        else:
            aim(rig, s + 'UpLeg', (0.13 * sx, -1, -0.06))
            aim(rig, s + 'Leg', (0.04 * sx, 0.1, -1))
        aim(rig, s + 'Foot', (0.05 * sx, -1, -0.5))
        if kind == 'sit':
            aim(rig, s + 'Arm', (0.22 * sx, -0.3, -1))
            aim(rig, s + 'ForeArm', (-0.08 * sx, -1, -0.2))
            aim(rig, s + 'Hand', (-0.05 * sx, -1, -0.3))
        elif kind in ('clapA', 'clapB'):
            k = 0.35 if kind == 'clapA' else 0.72
            aim(rig, s + 'Arm', (0.32 * sx, -0.7, -0.62))
            aim(rig, s + 'ForeArm', (-k * sx, -0.62, 0.62))
            aim(rig, s + 'Hand', (-k * sx, -0.45, 0.75))
        else:
            aim(rig, s + 'Arm', (0.5 * sx, -0.15, 1))
            aim(rig, s + 'ForeArm', (0.3 * sx, -0.1, 1))
            aim(rig, s + 'Hand', (0.22 * sx, 0, 1))
    if kind != 'cheer':
        # Sitting, leaning a little forward.
        aim(rig, 'Spine', (0, -0.12, 1))


def floor_z():
    dg = bpy.context.evaluated_depsgraph_get()
    lo = 1e9
    for o in bpy.data.objects:
        if o.type != 'MESH':
            continue
        ev = o.evaluated_get(dg)
        me = ev.to_mesh()
        for v in me.vertices:
            lo = min(lo, (ev.matrix_world @ v.co).z)
        ev.to_mesh_clear()
    return lo


def setup_scene():
    scn = bpy.context.scene
    names = [e.identifier for e in bpy.types.RenderSettings.bl_rna.properties['engine'].enum_items]
    scn.render.engine = 'BLENDER_EEVEE_NEXT' if 'BLENDER_EEVEE_NEXT' in names else 'BLENDER_EEVEE'
    scn.render.film_transparent = True
    scn.render.image_settings.file_format = 'PNG'
    scn.render.image_settings.color_mode = 'RGBA'
    scn.render.image_settings.color_depth = '16'
    scn.render.resolution_x, scn.render.resolution_y = CELL[0] * SS, CELL[1] * SS
    scn.render.resolution_percentage = 100
    scn.view_settings.view_transform = 'Standard'
    scn.view_settings.look = 'None'
    try:
        scn.eevee.taa_render_samples = 32
    except AttributeError:
        pass
    scn.world = scn.world or bpy.data.worlds.new('w')
    scn.world.use_nodes = True
    bg = scn.world.node_tree.nodes.get('Background')
    bg.inputs[0].default_value = (0.6, 0.62, 0.66, 1)
    bg.inputs[1].default_value = 0.55
    return scn


def lights_and_camera(scn):
    sun = bpy.data.objects.new('sun', bpy.data.lights.new('sun', 'SUN'))
    sun.data.energy = 3.2
    # From above and in front (the court's floodlights), a little from the side.
    sun.rotation_euler = (math.radians(40), 0, math.radians(-15))
    scn.collection.objects.link(sun)
    cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam'))
    cam.data.type = 'ORTHO'
    cam.data.ortho_scale = H
    cam.data.sensor_fit = 'VERTICAL'
    scn.collection.objects.link(cam)
    scn.camera = cam
    return cam


meta = {'cell': CELL, 'size': [W, H], 'views': VIEWS, 'elevation': ELEV, 'poses': POSES, 'shirt': SHIRT_WHITE, 'people': []}
scn = setup_scene()
for c in spec['people']:
    if only and c['name'] not in only:
        continue
    rig, top = build(c)
    cam = lights_and_camera(scn)
    rec = {'name': c['name']}
    for kind in POSES:
        pose(rig, kind)
        fz = floor_z()
        hips = rig.matrix_world @ rig.pose.bones[P + 'Hips'].head
        if kind == 'sit':
            rec['seat'] = round(hips.z - fz, 3)
        # The frame's centre: over the hips (seated, a little towards the knees) and half the frame above the floor.
        tgt = Vector((hips.x, hips.y - (0.18 if kind != 'cheer' else 0.0), fz + H / 2))
        for a in VIEWS:
            ar, er = math.radians(a), math.radians(ELEV)
            cam.location = tgt + 10 * Vector((math.sin(ar) * math.cos(er), -math.cos(ar) * math.cos(er), math.sin(er)))
            cam.rotation_euler = (tgt - cam.location).to_track_quat('-Z', 'Y').to_euler()
            for tag, v in (('A', SHIRT_WHITE), ('B', 0.0)):
                top.node_tree.nodes.get('Principled BSDF').inputs['Base Color'].default_value = (v, v, v, 1)
                scn.render.filepath = os.path.join(out, f"{c['name']}-{kind}-{a}-{tag}.png")
                bpy.ops.render.render(write_still=True)
    meta['people'].append(rec)
    print('CROWD', c['name'], rec)
json.dump(meta, open(os.path.join(out, 'meta.json' if not only else 'meta-partial.json'), 'w'), indent=1)
