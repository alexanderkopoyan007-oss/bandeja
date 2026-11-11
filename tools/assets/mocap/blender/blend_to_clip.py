# The action of a Blender file made by clip_to_blend.py (and changed by hand since, or not) written back as a clip the
# game's tools read (keys.py, then TRACK= for the game): every bone's turn as it is posed in the end, constraints and all.
#
#   /Applications/Blender.app/Contents/MacOS/Blender -b <file.blend> --python tools/assets/mocap/blender/blend_to_clip.py -- \
#       <out clip.json> [ACTION=<name>]
import bpy, json, os, sys

argv = sys.argv[sys.argv.index('--') + 1:]
opt = dict(a.split('=', 1) for a in argv[1:])
ob = bpy.data.objects['Player']
scene = bpy.context.scene
if 'ACTION' in opt:
    act = bpy.data.actions[opt['ACTION']]
    ob.animation_data.action = act
    if hasattr(ob.animation_data, 'action_slot') and ob.animation_data.action_slot is None and len(act.slots):
        ob.animation_data.action_slot = act.slots[0]
names = [b.name for b in ob.data.bones]
par = [names.index(b.parent.name) if b.parent else -1 for b in ob.data.bones]
quat, hips = [], []
for f in range(scene.frame_start, scene.frame_end + 1):
    scene.frame_set(f)
    bpy.context.view_layer.update()
    W = [ob.pose.bones[n].matrix.to_quaternion() for n in names]
    for i in range(len(names)):
        q = W[i] if par[i] < 0 else W[par[i]].inverted() @ W[i]
        quat += [round(q.x, 6), round(q.y, 6), round(q.z, 6), round(q.w, 6)]
    hips += [round(x, 5) for x in ob.pose.bones[names[0]].matrix.translation]
contact = next((m.frame for m in scene.timeline_markers if m.name == 'contact'), scene.frame_end)
out = {'name': os.path.basename(argv[0]).replace('.json', ''), 'fps': float(scene.render.fps), 'frames': scene.frame_end - scene.frame_start + 1,
       'bones': names, 'quat': quat, 'hips': hips, 'contact': round((contact - scene.frame_start) / scene.render.fps, 4)}
json.dump(out, open(argv[0], 'w'))
print('WROTE', argv[0], out['frames'], 'frames, action', ob.animation_data.action.name, 'contact', out['contact'])
