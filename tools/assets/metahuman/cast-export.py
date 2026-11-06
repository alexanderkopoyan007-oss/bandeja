# A current player (MPFB, assets-src/people/<name>/<name>.blend) as the target a MetaHuman is conformed to
# (mh-scripts/conform_cast.py, Epic's example_conform_from_custom_mesh): their body and head as one mesh, without
# clothes, and a front portrait for MetaHuman's face-landmark tracker, with the camera that took it in Unreal's units.
#   Blender -b <name>.blend --python tools/assets/metahuman/cast-export.py -- <out-dir> [height]
# Writes <out-dir>/target.fbx, portrait.png, camera.json. With `height` (data/players' height), the person is first
# scaled to it as finish-player.py scales the game's (soles of the shoes to the top of the skin), about the bare feet.
#
# Axes: Blender's metres, z up, the person facing -y. The FBX importer brings that into Unreal as centimetres with
# y flipped, so the person faces +y as a MetaHuman does; the camera here, looking along +y, is Unreal's yaw -90.
import bpy, json, math, os, sys
import numpy as np
from mathutils import Vector

ARGS = sys.argv[sys.argv.index('--') + 1:]
OUT = ARGS[0]
WANT = float(ARGS[1]) if len(ARGS) > 1 else None
os.makedirs(OUT, exist_ok=True)
SIZE = 1024
FOV = 30.0  # degrees, the square image's both ways
FACE_SPAN = 0.30  # metres of the face's plane the portrait shows across

human = bpy.data.objects['Human']
# Clothes' masks off (the body under them is the target), the helpers' mask kept (MakeHuman's helper geometry).
for m in human.modifiers:
    if m.type == 'MASK' and m.name != 'Hide helpers':
        m.show_viewport = m.show_render = False


def z_range(o):
    ev = o.evaluated_get(bpy.context.evaluated_depsgraph_get())
    m = ev.to_mesh()
    zs = [(ev.matrix_world @ v.co).z for v in m.vertices]
    ev.to_mesh_clear()
    return min(zs), max(zs)


if WANT:
    # (MPFB makes the body at its macro's size; finish-player.py then scales everyone to their height. Exported unscaled,
    # p7 came out 1.61 m for her 1.71, and the men a few centimetres off.)
    rig = human.parent
    lo = min(z_range(o)[0] for o in bpy.data.objects if o.type == 'MESH')  # the soles (the shoes)
    feet, hi = z_range(human)
    k = WANT / (hi - lo)
    rig.scale = (k, k, k)
    rig.location = (0, 0, feet * (1 - k))
    bpy.context.view_layer.update()
    print('CAST scaled', round(hi - lo, 4), '->', WANT, 'by', round(k, 4), 'about the feet at', round(feet, 4))
dg = bpy.context.evaluated_depsgraph_get()
me = bpy.data.meshes.new_from_object(human.evaluated_get(dg))
me.transform(human.matrix_world)
target = bpy.data.objects.new('target', me)
bpy.context.scene.collection.objects.link(target)
co = np.empty(len(me.vertices) * 3, dtype=np.float32)
me.vertices.foreach_get('co', co)
co = co.reshape(-1, 3)
top = float(co[:, 2].max())
head = co[co[:, 2] > top - 0.25]
print('CAST height', round(top - float(co[:, 2].min()), 3), 'vertices', len(co))

for o in bpy.data.objects:
    o.select_set(o is target)
bpy.context.view_layer.objects.active = target
bpy.ops.export_scene.fbx(filepath=os.path.join(OUT, 'target.fbx'), use_selection=True, object_types={'MESH'},
                         apply_unit_scale=True, mesh_smooth_type='FACE', use_mesh_modifiers=False, add_leaf_bones=False,
                         bake_anim=False)

# ---------------------------------------------------------------- portrait --------------------------------------------------------
# The person as the game shows them, minus clothes and hair: skin, eyes, brows, lashes, teeth. Front lit, flat grey round.
KEEP = ('Human.eyebrow', 'Human.eyelashes', 'Human.high-poly', 'Human.low-poly', 'Human.teeth', 'Human.tongue')
for o in bpy.data.objects:
    if o.type == 'MESH':
        o.hide_render = not (o.name == 'Human' or o.name.startswith(KEEP))
print('CAST portrait shows', [o.name for o in bpy.data.objects if o.type == 'MESH' and not o.hide_render])
scn = bpy.context.scene
eng = [e.identifier for e in bpy.types.RenderSettings.bl_rna.properties['engine'].enum_items]
scn.render.engine = 'BLENDER_EEVEE_NEXT' if 'BLENDER_EEVEE_NEXT' in eng else 'BLENDER_EEVEE'
scn.render.resolution_x = scn.render.resolution_y = SIZE
scn.render.resolution_percentage = 100
scn.render.film_transparent = False
scn.view_settings.view_transform = 'Standard'
scn.render.image_settings.file_format = 'PNG'
scn.world = scn.world or bpy.data.worlds.new('w')
scn.world.use_nodes = True
scn.world.node_tree.nodes['Background'].inputs['Color'].default_value = (0.35, 0.35, 0.35, 1)
scn.world.node_tree.nodes['Background'].inputs['Strength'].default_value = 0.35

face_y = float(head[:, 1].min())
eye_z = top - 0.115
dist = FACE_SPAN / 2 / math.tan(math.radians(FOV / 2))
cam_loc = Vector((0.0, face_y - dist, eye_z))
cam_data = bpy.data.cameras.new('cam')
cam_data.sensor_fit = 'HORIZONTAL'
cam_data.angle = math.radians(FOV)
cam = bpy.data.objects.new('cam', cam_data)
scn.collection.objects.link(cam)
cam.location = cam_loc
cam.rotation_euler = (math.radians(90), 0, 0)  # looking along +y
scn.camera = cam
for name, loc, energy, size in (('key', (0.25, face_y - 1.2, eye_z + 0.35), 22, 1.2), ('fill', (-0.6, face_y - 1.0, eye_z), 8, 1.5)):
    ld = bpy.data.lights.new(name, 'AREA')
    ld.energy = energy
    ld.size = size
    lo = bpy.data.objects.new(name, ld)
    scn.collection.objects.link(lo)
    lo.location = loc
    d = Vector((0, face_y, eye_z)) - Vector(loc)
    lo.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()
scn.render.filepath = os.path.join(OUT, 'portrait.png')
bpy.ops.render.render(write_still=True)

# Unreal: centimetres, y flipped; Blender's camera looking +y is Unreal's yaw -90.
camera = {'location': [cam_loc.x * 100, -cam_loc.y * 100, cam_loc.z * 100], 'rotation': {'pitch': 0.0, 'yaw': -90.0, 'roll': 0.0},
          'fov': FOV, 'size': [SIZE, SIZE]}
json.dump(camera, open(os.path.join(OUT, 'camera.json'), 'w'), indent=1)
print('CAST wrote', OUT, camera)
