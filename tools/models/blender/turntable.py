"""Review pictures of one model: a turntable (8 sides), the RTS view and close-ups of the head.
Used to look for visual bugs (holes, stretched texture, parts that float or cut through).

    blender -b --factory-startup -P tools/models/blender/turntable.py -- <model_id> <out_dir> [size]

Writes <out_dir>/<model_id>_<view>.png; tools/models/turntable.ts puts them on one sheet.
"""

import importlib
import math
import os
import sys

import bpy
from mathutils import Vector

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(HERE, "models"))

import kit  # noqa: E402

args = sys.argv[sys.argv.index("--") + 1 :]
model_id, out_dir = args[0], args[1]
size = int(args[2]) if len(args) > 2 else 384
os.makedirs(out_dir, exist_ok=True)

kit.reset()
model = importlib.import_module(model_id).build()
model.finish()

scene = bpy.context.scene
scene.render.engine = "BLENDER_EEVEE"
scene.render.resolution_x = scene.render.resolution_y = size
scene.render.film_transparent = True
scene.render.image_settings.file_format = "PNG"
world = bpy.data.worlds.new("w")
world.use_nodes = True
world.node_tree.nodes["Background"].inputs["Color"].default_value = (0.5, 0.52, 0.55, 1)
world.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.6
scene.world = world
sun = bpy.data.objects.new("sun", bpy.data.lights.new("sun", "SUN"))
sun.data.energy = 3.2
sun.rotation_euler = (math.radians(45), 0, math.radians(-35))
scene.collection.objects.link(sun)
cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam"))
cam.data.type = "ORTHO"
scene.collection.objects.link(cam)
scene.camera = cam

# Rest pose: no clip on the armature.
arm = model.armature
if arm and arm.animation_data:
    arm.animation_data.action = None
    for t in arm.animation_data.nla_tracks:
        t.mute = True
    for b in arm.pose.bones:
        b.rotation_euler = (0, 0, 0)
        b.location = (0, 0, 0)
scene.frame_set(1)

co = [v.co for v in model.body.data.vertices]
h = max(c.z for c in co)
width = max(max(c.x for c in co) - min(c.x for c in co), max(c.y for c in co) - min(c.y for c in co))
head = model.joints.get("head") if hasattr(model, "joints") else None


def shot(name, yaw, pitch, center, scale):
    d = Vector((math.sin(yaw) * math.cos(pitch), -math.cos(yaw) * math.cos(pitch), math.sin(pitch)))
    cam.data.ortho_scale = scale
    cam.location = center + d * 20
    cam.rotation_euler = (-d).to_track_quat("-Z", "Y").to_euler()
    scene.render.filepath = os.path.join(out_dir, f"{model_id}_{name}.png")
    bpy.ops.render.render(write_still=True)


body_c = Vector((0, 0, h * 0.5))
full = max(h, width) * 1.1
for k in range(8):
    shot(f"t{k}", math.radians(k * 45), math.radians(8), body_c, full)
shot("rts", math.radians(-30), math.radians(56), body_c, full)
if head:
    hc = Vector((head[0], head[1], head[2] + 0.12))
    shot("head_front", 0, math.radians(5), hc, 0.75)
    shot("head_back", math.radians(180), math.radians(5), hc, 0.75)
else:
    shot("top", 0, math.radians(85), body_c, full)
print(f"TURNTABLE {model_id} {out_dir}")
