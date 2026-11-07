# Ambient occlusion baked with Cycles, shared by the MPFB players (finish-player.py, through person_face.py) and the
# MetaHumans (tools/assets/metahuman/mh-player.py). Plain bpy and numpy: no MPFB, so a Blender without the add-on can
# import it.
import bpy
import numpy as np


def cycles_setup(samples=48, distance=0.1):
    scn = bpy.context.scene
    scn.render.engine = 'CYCLES'
    scn.cycles.samples = samples
    scn.render.bake.margin = 6
    try:
        prefs = bpy.context.preferences.addons['cycles'].preferences
        prefs.compute_device_type = 'METAL'
        prefs.get_devices()
        for d in prefs.devices:
            d.use = True
        scn.cycles.device = 'GPU'
    except Exception as e:  # CPU is fine, only slower
        print('AO bake on the CPU:', e)
    scn.world = scn.world or bpy.data.worlds.new('w')
    scn.world.light_settings.distance = distance


def bake_ao_image(o, size, name):
    """AO baked into a new size x size image on the object's UVs; returns (h, w) float array."""
    img = bpy.data.images.new(name, size, size, alpha=False, float_buffer=True)
    for slot in o.material_slots:
        mat = slot.material
        mat.use_nodes = True
        nd = mat.node_tree.nodes.new('ShaderNodeTexImage')
        nd.image = img
        mat.node_tree.nodes.active = nd
    for x in bpy.data.objects:
        x.select_set(False)
    o.select_set(True)
    bpy.context.view_layer.objects.active = o
    bpy.ops.object.bake(type='AO', target='IMAGE_TEXTURES', use_clear=True)
    px = np.empty(size * size * 4, dtype=np.float32)
    img.pixels.foreach_get(px)
    for slot in o.material_slots:
        nt = slot.material.node_tree
        nt.nodes.remove(nt.nodes.active)
    bpy.data.images.remove(img)
    return px.reshape(size, size, 4)[:, :, 0].copy()


def bake_ao_vertices(o):
    """AO per vertex (the shoes and eyes have no UVs of their own in the atlas)."""
    me = o.data
    attr = me.color_attributes.new('bake_ao', 'FLOAT_COLOR', 'POINT')
    me.color_attributes.active_color = attr
    for x in bpy.data.objects:
        x.select_set(False)
    o.select_set(True)
    bpy.context.view_layer.objects.active = o
    bpy.ops.object.bake(type='AO', target='VERTEX_COLORS', use_clear=True)
    a = np.empty(len(me.vertices) * 4, dtype=np.float32)
    attr.data.foreach_get('color', a)
    me.color_attributes.remove(attr)
    return a.reshape(-1, 4)[:, 0].copy()
