"""Build one model: run its script, export GLB, render preview pictures.

    blender -b --factory-startup -P tools/models/blender/build_model.py -- <model_id> [--preview]

Output:
    client/public/assets/models/<id>.glb        (raw, tools/models/build.ts compresses it)
    art/source/models/<id>.png                  preview: RTS view + front + side + attack pose
    art/source/models/<id>.json                 triangle count, bones, clips
"""

import importlib
import json
import math
import os
import sys

import bpy
from mathutils import Vector

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(HERE, "models"))

import kit  # noqa: E402

args = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
model_id = args[0]
want_preview = "--preview" in args

kit.reset()
module = importlib.import_module(model_id)
model = module.build()
model.finish()

out_glb = os.path.join(kit.ROOT, "client", "public", "assets", "models", f"{model_id}.glb")
os.makedirs(os.path.dirname(out_glb), exist_ok=True)
model.export(out_glb)

info = {
    "id": model_id,
    "triangles": model.triangles(),
    "bones": len(model.bones),
    "clips": [{"name": n, "frames": f, "loop": loop} for n, f, loop in model.actions],
    "height": round(max(v.co.z for v in model.body.data.vertices), 3),
    "sockets": getattr(model, "sockets", []),
    "skin": model.skin,
}
src_dir = os.path.join(kit.ROOT, "art", "source", "models")
os.makedirs(src_dir, exist_ok=True)
with open(os.path.join(src_dir, f"{model_id}.json"), "w") as fh:
    json.dump(info, fh, indent=2)
print(f"FLIPPED {len(kit.FLIPPED)} parts: {sorted(set(kit.FLIPPED))}")
print(f"MODEL {model_id}: {info['triangles']} triangles, {info['bones']} bones, {len(info['clips'])} clips, height {info['height']} m")


def render_previews():
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x = 448
    scene.render.resolution_y = 448
    scene.render.film_transparent = True
    scene.render.image_settings.file_format = "PNG"
    world = bpy.data.worlds.new("w")
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs["Color"].default_value = (0.45, 0.47, 0.5, 1)
    world.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.55
    scene.world = world
    sun = bpy.data.objects.new("sun", bpy.data.lights.new("sun", "SUN"))
    sun.data.energy = 3.5
    sun.rotation_euler = (math.radians(50), 0, math.radians(-35))
    scene.collection.objects.link(sun)
    cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam"))
    cam.data.type = "ORTHO"
    scene.collection.objects.link(cam)
    scene.camera = cam
    h = info["height"]
    co = [v.co for v in model.body.data.vertices]
    width = max(max(c.x for c in co) - min(c.x for c in co), max(c.y for c in co) - min(c.y for c in co))
    cam.data.ortho_scale = max(h, width) * 1.12
    center = Vector((0, 0, h * 0.5))

    def shot(name, yaw, pitch, action=None, frame=1):
        arm = model.armature
        if arm and arm.animation_data:
            arm.animation_data.action = bpy.data.actions.get(action) if action else None
            if action:
                for t in arm.animation_data.nla_tracks:
                    t.mute = True
            scene.frame_set(frame)
        d = Vector((math.sin(yaw) * math.cos(pitch), -math.cos(yaw) * math.cos(pitch), math.sin(pitch)))
        cam.location = center + d * 10
        cam.rotation_euler = (-d).to_track_quat("-Z", "Y").to_euler()
        path = os.path.join(src_dir, f"_{model_id}_{name}.png")
        scene.render.filepath = path
        bpy.ops.render.render(write_still=True)
        return path

    shots = [
        shot("rts", math.radians(-30), math.radians(56)),
        shot("front", 0, math.radians(5)),
        shot("side", math.radians(90), math.radians(5)),
        shot("attack", math.radians(90), math.radians(5), "attack", 15),
        shot("walk", math.radians(90), math.radians(5), "walk", 8),
        shot("death", math.radians(-60), math.radians(20), "death", 40),
    ]
    # Put the shots side by side in one picture.
    imgs = [bpy.data.images.load(p) for p in shots]
    w, hgt = imgs[0].size
    out = bpy.data.images.new("sheet", w * len(imgs), hgt, alpha=True)
    pixels = [0.0] * (w * len(imgs) * hgt * 4)
    for i, im in enumerate(imgs):
        px = list(im.pixels)
        for y in range(hgt):
            src = y * w * 4
            dst = (y * w * len(imgs) + i * w) * 4
            pixels[dst : dst + w * 4] = px[src : src + w * 4]
    out.pixels = pixels
    out.filepath_raw = os.path.join(src_dir, f"{model_id}.png")
    out.file_format = "PNG"
    out.save()
    for p in shots:
        os.remove(p)
    print(f"PREVIEW art/source/models/{model_id}.png")


if want_preview:
    render_previews()
