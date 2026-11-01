"""Model kit for Temple Wars: build low-poly, rounded, hand-painted-style models from code.

Every model is a set of simple parts (spheres, lathed profiles, cones, rounded boxes).
Each part:
  - takes one slot of the palette atlas (tools/models/palette.json) for its UVs,
  - gets a tint + painted light baked into vertex colors (top lighter, bottom darker),
  - is rigidly bound to one bone (classic RTS rigging: no soft weights, very cheap).
At the end all parts are joined into ONE mesh (one draw call), skinned to the armature,
and exported as GLB with all animations.

Axes: Blender Z is up, the model faces -Y. The glTF exporter turns this into Y-up, facing +Z.
"""

import json
import math
import os

import bmesh
import bpy
from mathutils import Euler, Matrix, Vector

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
PALETTE = json.load(open(os.path.join(ROOT, "tools", "models", "palette.json")))
# Blender previews use a copy with red team slots; the game uses palette.webp + palette_team.webp.
PALETTE_IMAGE = os.path.join(ROOT, "tools", "models", "palette_preview.png")
FPS = 30


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.context.scene.render.fps = FPS


def _to_linear(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def hex_color(value):
    """'#a0522d' or (r, g, b) sRGB in 0..1 -> linear (r, g, b).
    Vertex colors in Blender and glTF are linear, so the picked sRGB color must be converted."""
    if isinstance(value, str):
        v = value.lstrip("#")
        value = tuple(int(v[i : i + 2], 16) / 255 for i in (0, 2, 4))
    return tuple(_to_linear(c) for c in value)


# ---------------------------------------------------------------- shapes (bmesh)


def _lathe(bm, profile, segments, closed_top=True, closed_bottom=True):
    """Revolve [(radius, z), ...] (bottom to top) around Z."""
    rings = []
    for r, z in profile:
        ring = []
        for s in range(segments):
            a = 2 * math.pi * s / segments
            ring.append(bm.verts.new((r * math.cos(a), r * math.sin(a), z)))
        rings.append(ring)
    for i in range(len(rings) - 1):
        a, b = rings[i], rings[i + 1]
        for s in range(segments):
            n = (s + 1) % segments
            bm.faces.new((a[s], a[n], b[n], b[s]))
    if closed_bottom and profile[0][0] > 1e-4:
        c = bm.verts.new((0, 0, profile[0][1]))
        for s in range(segments):
            bm.faces.new((rings[0][(s + 1) % segments], rings[0][s], c))
    if closed_top and profile[-1][0] > 1e-4:
        c = bm.verts.new((0, 0, profile[-1][1]))
        for s in range(segments):
            bm.faces.new((rings[-1][s], rings[-1][(s + 1) % segments], c))


def _shape(kind, size, segments, rings, profile, bevel):
    bm = bmesh.new()
    sx, sy, sz = size
    if kind == "sphere":
        bmesh.ops.create_uvsphere(bm, u_segments=segments, v_segments=rings, radius=0.5)
        bmesh.ops.scale(bm, vec=(sx, sy, sz), verts=bm.verts)
    elif kind == "cylinder":
        bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=segments, radius1=0.5, radius2=0.5, depth=1)
        bmesh.ops.scale(bm, vec=(sx, sy, sz), verts=bm.verts)
    elif kind == "cone":
        bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=True, segments=segments, radius1=0.5, radius2=0.0, depth=1)
        bmesh.ops.scale(bm, vec=(sx, sy, sz), verts=bm.verts)
    elif kind == "box":
        bmesh.ops.create_cube(bm, size=1)
        bmesh.ops.scale(bm, vec=(sx, sy, sz), verts=bm.verts)
        if bevel > 0:
            bmesh.ops.bevel(bm, geom=list(bm.edges), offset=bevel * min(sx, sy, sz), segments=1, affect="EDGES", profile=0.5)
    elif kind == "lathe":
        # profile: [(radius, z)], scaled by size (x, y scale the radius, z the height)
        _lathe(bm, profile, segments)
        bmesh.ops.scale(bm, vec=(sx, sy, sz), verts=bm.verts)
    elif kind == "torus":
        major, minor = 0.5, 0.5 * (profile or 0.25)
        verts = []
        for i in range(segments):
            a = 2 * math.pi * i / segments
            ring = []
            for j in range(rings):
                b = 2 * math.pi * j / rings
                x = (major + minor * math.cos(b)) * math.cos(a)
                y = (major + minor * math.cos(b)) * math.sin(a)
                ring.append(bm.verts.new((x, y, minor * math.sin(b))))
            verts.append(ring)
        for i in range(segments):
            for j in range(rings):
                a, b = verts[i], verts[(i + 1) % segments]
                bm.faces.new((a[j], b[j], b[(j + 1) % rings], a[(j + 1) % rings]))
        bmesh.ops.scale(bm, vec=(sx, sy, sz), verts=bm.verts)
    elif kind == "hull":
        # profile: [(x, y, z), ...] points; the shape is the tightest convex shell around them.
        # Good for rubbed, angular forms: wedges, plates, fists, feet, jaws, horns.
        verts = [bm.verts.new(p) for p in profile]
        res = bmesh.ops.convex_hull(bm, input=verts, use_existing_faces=False)
        drop = {g for g in res["geom_interior"] + res["geom_unused"] if isinstance(g, bmesh.types.BMVert) and g.is_valid}
        if drop:
            bmesh.ops.delete(bm, geom=list(drop), context="VERTS")
        bmesh.ops.scale(bm, vec=(sx, sy, sz), verts=bm.verts)
    elif kind == "loft":
        # profile: [(x, y, z, width, depth) or (x, y, z, width, depth, twist_deg)] cross-sections
        # along a path; `segments` = sides of each section (4-6 gives the classic chunky look).
        # Each section is turned to face along the path, so limbs and torsos can bend and bulge.
        sides = max(3, segments)
        pts = [Vector(p[:3]) for p in profile]
        rings = []
        for i, sec in enumerate(profile):
            prev_p = pts[max(0, i - 1)]
            next_p = pts[min(len(pts) - 1, i + 1)]
            t = (next_p - prev_p).normalized() if (next_p - prev_p).length > 1e-6 else Vector((0, 0, 1))
            ref = Vector((1, 0, 0)) if abs(t.x) < 0.9 else Vector((0, 1, 0))
            u = (ref - t * ref.dot(t)).normalized()
            v = t.cross(u).normalized()
            twist = math.radians(sec[5]) if len(sec) > 5 else 0.0
            ring = []
            for k in range(sides):
                a = 2 * math.pi * k / sides + math.pi / sides + twist
                ring.append(bm.verts.new(pts[i] + u * (math.cos(a) * sec[3] / 2) + v * (math.sin(a) * sec[4] / 2)))
            rings.append(ring)
        for i in range(len(rings) - 1):
            for k in range(sides):
                n = (k + 1) % sides
                bm.faces.new((rings[i][k], rings[i][n], rings[i + 1][n], rings[i + 1][k]))
        bm.faces.new(list(reversed(rings[0])))
        bm.faces.new(rings[-1])
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        bmesh.ops.scale(bm, vec=(sx, sy, sz), verts=bm.verts)
    else:
        raise ValueError("unknown shape " + kind)
    # Make sure all faces point outward (the browser hides faces that look away from the camera).
    if bm.faces:
        c = sum((v.co for v in bm.verts), Vector()) / len(bm.verts)
        vol = sum((f.calc_center_median() - c).dot(f.normal) * f.calc_area() for f in bm.faces)
        if vol < 0:
            bmesh.ops.reverse_faces(bm, faces=list(bm.faces))
            FLIPPED.append(kind)
    return bm


FLIPPED = []


def _fcurves(act):
    """All curves of an action (Blender 4.4+ keeps them in layers / strips / channel bags)."""
    if hasattr(act, "fcurves") and not hasattr(act, "layers"):
        return list(act.fcurves)
    out = []
    for layer in act.layers:
        for strip in layer.strips:
            for bag in strip.channelbags:
                out.extend(bag.fcurves)
    return out


# ---------------------------------------------------------------- model


class Model:
    def __init__(self, name, skin=None):
        """skin: name of a model texture atlas from Phase 3 (client/public/assets/models/<skin>.json).
        Without a skin the model uses the shared palette atlas."""
        self.name = name
        self.parts = []  # (object, bone)
        self.armature = None
        self.bones = {}
        self.actions = []
        self.rects = PALETTE["rects"]
        self.image = PALETTE_IMAGE
        self.skin = skin
        if skin:
            atlas = json.load(open(os.path.join(ROOT, "client", "public", "assets", "models", f"{skin}.json")))
            # Atlas rects are {x, y, w, h} with y from the top; Blender UVs have v going up.
            self.rects = {k: [r["x"], 1 - (r["y"] + r["h"]), r["x"] + r["w"], 1 - r["y"]] for k, r in atlas["rects"].items()}
            preview = os.path.join(ROOT, "art", "source", "models", f"{skin}_preview.png")
            self.image = preview if os.path.exists(preview) else os.path.join(ROOT, "client", "public", "assets", "models", f"{skin}.webp")

    # ---- parts

    def part(
        self,
        kind,
        size,
        at=(0, 0, 0),
        rot=(0, 0, 0),
        slot="flat_white",
        tint="#ffffff",
        bone="root",
        segments=10,
        rings=7,
        profile=None,
        bevel=0.2,
        material="palette",
        light=True,
        mirror=False,
        uv="box",
        back=None,
        frame=None,
        sub=None,
        smooth=35,
    ):
        """Add one part. size = (x, y, z) in meters, at = position, rot = degrees.
        mirror=True also adds the same part mirrored on X, on the mirrored bone (.L <-> .R).
        uv: how the slot picture is laid on the part:
          box   - each face takes the picture from its main direction (good for tiling materials)
          front - picture seen from the front (-Y); faces looking backward take `back` instead
          wrap  - picture wrapped around the part like a label; its middle faces the front
          top   - picture seen from above (toes / front of the model at the top of the picture)
          side  - picture seen from the side (+X or -X, whichever the part faces more); faces
                  looking the other way take `back` (a shield on the left arm faces +X)
        frame: (x0, x1, z0, z1) fixed area for front / wrap pictures, so several parts can share
          one picture without each part repeating it (for example belly + chest).
        sub: (s0, s1, t0, t1) use only this part of the slot picture (0..1), when the painted
          thing does not fill its cell (a thin staff in the middle of a cell).
        smooth: edges sharper than this angle (degrees) stay hard, like hand-made low-poly models.
          0 = fully faceted, 180 = fully smooth."""
        size = (size, size, size) if isinstance(size, (int, float)) else size
        bm = _shape(kind, size, segments, rings, profile, bevel)
        m = Matrix.Translation(Vector(at)) @ Euler(tuple(math.radians(a) for a in rot), "XYZ").to_matrix().to_4x4()
        bmesh.ops.transform(bm, matrix=m, verts=bm.verts)
        mesh = bpy.data.meshes.new(f"{self.name}_part")
        bm.to_mesh(mesh)
        bm.free()
        obj = bpy.data.objects.new(mesh.name, mesh)
        bpy.context.scene.collection.objects.link(obj)
        self._uv_into_slot(mesh, slot, uv, back, frame, sub)
        self._paint(mesh, hex_color(tint), light)
        self._material(obj, material)
        for poly in mesh.polygons:
            poly.use_smooth = True
        if smooth < 180:
            mesh.set_sharp_from_angle(angle=math.radians(max(smooth, 0.01)))
        self.parts.append((obj, bone))
        if mirror:
            mb = bone.replace(".L", ".TMP").replace(".R", ".L").replace(".TMP", ".R")
            mframe = (-frame[1], -frame[0], frame[2], frame[3]) if frame else None
            mprofile = profile
            if kind == "hull":
                mprofile = [(-p[0], p[1], p[2]) for p in profile]
            elif kind == "loft":
                mprofile = [(-p[0], p[1], p[2], *p[3:5], *(-t for t in p[5:])) for p in profile]
            self.part(kind, size, (-at[0], at[1], at[2]), (rot[0], -rot[1], -rot[2]), slot, tint, mb, segments, rings, mprofile, bevel, material, light, False, uv, back, mframe, sub, smooth)
        return obj

    def _rect(self, slot):
        if slot not in self.rects:
            raise KeyError(f"model {self.name}: no texture slot '{slot}'")
        return self.rects[slot]

    def _uv_into_slot(self, mesh, slot, mode="box", back=None, frame=None, sub=None):
        """Lays the slot picture on the part (see part() for the modes)."""

        def cut(r):
            if not sub:
                return r
            u0, v0, u1, v1 = r
            s0, s1, t0, t1 = sub
            return [u0 + (u1 - u0) * s0, v0 + (v1 - v0) * t0, u0 + (u1 - u0) * s1, v0 + (v1 - v0) * t1]

        main = cut(self._rect(slot))
        rear = cut(self._rect(back)) if back else None
        uv = mesh.uv_layers.new(name="UVMap")
        co = [v.co for v in mesh.vertices]
        lo = Vector((min(c.x for c in co), min(c.y for c in co), min(c.z for c in co)))
        hi = Vector((max(c.x for c in co), max(c.y for c in co), max(c.z for c in co)))
        if frame:
            lo.x, hi.x, lo.z, hi.z = frame
        span = hi - lo
        span = Vector((max(span.x, 1e-4), max(span.y, 1e-4), max(span.z, 1e-4)))
        center = (lo + hi) / 2

        def put(li, rect, s, t):
            s = min(1.0, max(0.0, s))
            t = min(1.0, max(0.0, t))
            u0, v0, u1, v1 = rect
            uv.data[li].uv = (u0 + s * (u1 - u0), v0 + t * (v1 - v0))

        for poly in mesh.polygons:
            n = poly.normal
            loops = list(poly.loop_indices)
            if mode == "front":
                facing_back = rear is not None and n.y > 0.15
                for li in loops:
                    c = co[mesh.loops[li].vertex_index]
                    s = (c.x - lo.x) / span.x
                    put(li, rear if facing_back else main, 1 - s if facing_back else s, (c.z - lo.z) / span.z)
            elif mode == "wrap" and (abs(n.z) > 0.9 or (len(loops) > 4 and abs(n.z) > 0.7)):
                # Flat cap of a cylinder, cone or loft (a step, a platform, a tower top): all its
                # corners sit at one height, so the wrap picture was one smeared line. Seen from
                # above instead.
                for li in loops:
                    c = co[mesh.loops[li].vertex_index]
                    put(li, main, (c.x - lo.x) / span.x, 1 - (c.y - lo.y) / span.y)
            elif mode == "wrap":
                # Angle around the vertical axis: 0.5 = front (-Y), the seam is at the back.
                us = []
                for li in loops:
                    c = co[mesh.loops[li].vertex_index]
                    dx, dy = c.x - center.x, c.y - center.y
                    # A corner on the axis (the tip of a cone) has no angle of its own: it takes
                    # its face's. atan2(0, -0) = pi put every cone tip at the seam and smeared
                    # half of each cone roof.
                    us.append(None if dx * dx + dy * dy < 1e-8 else 0.5 + math.atan2(dx, -dy) / (2 * math.pi))
                known = [u for u in us if u is not None]
                if known and max(known) - min(known) > 0.5:  # face crosses the back seam: keep it on one side
                    known = [u if u > 0.5 else u + 1.0 for u in known]
                    us = [None if u is None else (u if u > 0.5 else u + 1.0) for u in us]
                mid = sum(known) / len(known) if known else 0.5
                for li, u in zip(loops, us):
                    c = co[mesh.loops[li].vertex_index]
                    put(li, main, mid if u is None else u, (c.z - lo.z) / span.z)
            elif mode == "tube":
                # Wrapped around the long Y axis (a lying body: wolf, horse, boar). 0.5 = the top,
                # so the back seen from the RTS camera gets the middle of the picture.
                us = []
                for li in loops:
                    c = co[mesh.loops[li].vertex_index]
                    us.append(0.5 + math.atan2(c.x - center.x, c.z - center.z) / (2 * math.pi))
                if max(us) - min(us) > 0.5:
                    us = [u if u > 0.5 else u + 1.0 for u in us]
                for li, u in zip(loops, us):
                    c = co[mesh.loops[li].vertex_index]
                    put(li, main, u, (c.y - lo.y) / span.y)
            elif mode == "top":
                for li in loops:
                    c = co[mesh.loops[li].vertex_index]
                    put(li, main, (c.x - lo.x) / span.x, 1 - (c.y - lo.y) / span.y)
            elif mode == "side":
                # Outward = the side the part's center sits on (a left-arm shield looks to +X).
                out = 1.0 if center.x >= 0 else -1.0
                facing_back = rear is not None and n.x * out < -0.15
                for li in loops:
                    c = co[mesh.loops[li].vertex_index]
                    s = (c.y - lo.y) / span.y
                    s = s if out > 0 else 1 - s
                    put(li, rear if facing_back else main, 1 - s if facing_back else s, (c.z - lo.z) / span.z)
            else:
                ax = max(range(3), key=lambda i: abs(n[i]))
                a, b = [(1, 2), (0, 2), (0, 1)][ax]
                for li in loops:
                    c = co[mesh.loops[li].vertex_index]
                    put(li, main, (c[a] - lo[a]) / span[a], (c[b] - lo[b]) / span[b])

    def _paint(self, mesh, tint, light):
        """Vertex color = tint x painted light: lit from the top, darker toward the bottom and in creases."""
        attr = mesh.color_attributes.new(name="Col", type="BYTE_COLOR", domain="CORNER")
        zs = [v.co.z for v in mesh.vertices]
        z0, z1 = min(zs), max(zs)
        for poly in mesh.polygons:
            for li in poly.loop_indices:
                v = mesh.vertices[mesh.loops[li].vertex_index]
                if light:
                    up = poly.normal.z * 0.5 + 0.5
                    height = (v.co.z - z0) / max(z1 - z0, 1e-4)
                    shade = 0.62 + 0.28 * up + 0.12 * height
                    # Whole-model ground shade: feet and lower legs a bit darker, like painted RTS models.
                    shade *= 0.8 + 0.2 * min(1.0, max(0.0, v.co.z / 0.7))
                else:
                    shade = 1.0
                shade_lin = shade**2.2  # shade is picked by eye in sRGB terms
                attr.data[li].color = (min(1, tint[0] * shade_lin), min(1, tint[1] * shade_lin), min(1, tint[2] * shade_lin), 1.0)
        mesh.color_attributes.active_color = attr

    def _material(self, obj, name):
        mat = bpy.data.materials.get(name)
        image = self.image
        if mat is None:
            mat = bpy.data.materials.new(name)
            mat.use_nodes = True
            nt = mat.node_tree
            bsdf = nt.nodes.get("Principled BSDF")
            vc = nt.nodes.new("ShaderNodeVertexColor")
            vc.layer_name = "Col"
            if False:
                pass
            else:
                # Texture x vertex color, only for previews in Blender. Export skips images:
                # the game sets the shared palette texture and team mask itself.
                tex = nt.nodes.new("ShaderNodeTexImage")
                tex.image = bpy.data.images.load(image, check_existing=True)
                mix = nt.nodes.new("ShaderNodeMix")
                mix.data_type = "RGBA"
                mix.blend_type = "MULTIPLY"
                mix.inputs["Factor"].default_value = 1.0
                nt.links.new(tex.outputs["Color"], mix.inputs["A"])
                nt.links.new(vc.outputs["Color"], mix.inputs["B"])
                nt.links.new(mix.outputs["Result"], bsdf.inputs["Base Color"])
                if name == "glow":
                    # Glow parts: textured and lit by themselves (the game draws them unlit).
                    nt.links.new(mix.outputs["Result"], bsdf.inputs["Emission Color"])
                    bsdf.inputs["Emission Strength"].default_value = 1.5
            bsdf.inputs["Roughness"].default_value = 0.9
        obj.data.materials.append(mat)

    # ---- effect sockets

    def socket(self, name, at, bone="root"):
        """An empty point named fx_<name>, glued to a bone. The game hangs particle effects on it
        (staff crystal glow, dragon mouth embers...) and it follows every animation."""
        empty = bpy.data.objects.new(f"fx_{name}", None)
        empty.empty_display_size = 0.05
        bpy.context.scene.collection.objects.link(empty)
        if self.armature and bone in self.armature.data.bones:
            empty.parent = self.armature
            empty.parent_type = "BONE"
            empty.parent_bone = bone
            # Bone parenting places the child at the bone tail; set the world position afterwards.
            bpy.context.view_layer.update()
            empty.matrix_world = Matrix.Translation(Vector(at))
        else:
            empty.location = at
        if not hasattr(self, "sockets"):
            self.sockets = []
        self.sockets.append(name)
        return empty

    # ---- skeleton

    def skeleton(self, bones):
        """bones: {name: (head, tail, parent or None)}"""
        arm_data = bpy.data.armatures.new(f"{self.name}_rig")
        arm = bpy.data.objects.new(f"{self.name}_rig", arm_data)
        bpy.context.scene.collection.objects.link(arm)
        bpy.context.view_layer.objects.active = arm
        bpy.ops.object.mode_set(mode="EDIT")
        made = {}
        for name, (head, tail, parent) in bones.items():
            b = arm_data.edit_bones.new(name)
            b.head, b.tail = Vector(head), Vector(tail)
            b.roll = 0
            if parent:
                b.parent = made[parent]
            made[name] = b
        bpy.ops.object.mode_set(mode="OBJECT")
        for pb in arm.pose.bones:
            pb.rotation_mode = "XYZ"
        self.armature = arm
        self.bones = bones
        return arm

    # ---- animation

    def action(self, name, length, keys, loop=True):
        """keys: {bone: [(frame, (rx, ry, rz) degrees, optional (lx, ly, lz) meters)]}.
        Bones not listed stay in rest pose. For loops the last key should match the first."""
        arm = self.armature
        arm.animation_data_create()
        act = bpy.data.actions.new(name)
        arm.animation_data.action = act
        for pb in arm.pose.bones:
            pb.rotation_euler = (0, 0, 0)
            pb.location = (0, 0, 0)
        for bone, frames in keys.items():
            pb = arm.pose.bones.get(bone)
            if pb is None:
                continue  # shared clip sets may key bones this rig does not have
            for k in frames:
                frame, r = k[0], k[1]
                # Clips are written with "+X = swing forward" for limbs (bones pointing down) and
                # "+X = lean back" for the spine (bones pointing up). In Blender's bone axes both are
                # the other way round (checked with a test rig), so X is flipped here, in one place.
                pb.rotation_euler = (math.radians(-r[0]), math.radians(r[1]), math.radians(r[2]))
                pb.keyframe_insert("rotation_euler", frame=frame)
                if len(k) > 2:
                    pb.location = k[2]
                    pb.keyframe_insert("location", frame=frame)
            pb.rotation_euler = (0, 0, 0)
            pb.location = (0, 0, 0)
        act.use_fake_user = True
        track = arm.animation_data.nla_tracks.new()
        track.name = name
        track.strips.new(name, 1, act)
        arm.animation_data.action = None
        self.actions.append((name, length, loop))

    # ---- whole-model changes (bosses made from other models)

    def scale_all(self, k):
        """Makes the whole model k times bigger before finish(): parts, bones, joints, effect
        sockets and the moves in its clips (a hop, a bob), so the animations fit the new size."""
        S = Matrix.Scale(k, 4)
        for obj, _bone in self.parts:
            obj.data.transform(S)
        if self.armature:
            bpy.context.view_layer.objects.active = self.armature
            bpy.ops.object.mode_set(mode="EDIT")
            for b in self.armature.data.edit_bones:
                b.head = b.head * k
                b.tail = b.tail * k
            bpy.ops.object.mode_set(mode="OBJECT")
            for act in bpy.data.actions:
                for fc in _fcurves(act):
                    if fc.data_path.endswith(".location"):
                        for p in fc.keyframe_points:
                            p.co[1] *= k
                            p.handle_left[1] *= k
                            p.handle_right[1] *= k
        for d in ("joints", "tails"):
            table = getattr(self, d, None)
            if table:
                for name, p in table.items():
                    table[name] = tuple(v * k for v in p)
        for obj in bpy.data.objects:
            if obj.name.startswith("fx_"):
                bpy.context.view_layer.update()
                mw = obj.matrix_world.copy()
                mw.translation = mw.translation * k
                obj.matrix_world = mw
        if hasattr(self, "height"):
            self.height *= k

    def retint(self, rgb, skip_glow=True):
        """Multiplies every part's colors by rgb (0..2 per channel): a darker or warmer version
        of the same model. Glow parts keep their own color."""
        for obj, _bone in self.parts:
            if skip_glow and any(m and m.name.startswith("glow") for m in obj.data.materials):
                continue
            attr = obj.data.color_attributes.get("Col")
            if not attr:
                continue
            for d in attr.data:
                c = d.color
                d.color = (min(1, c[0] * rgb[0]), min(1, c[1] * rgb[1]), min(1, c[2] * rgb[2]), c[3])

    # ---- finish

    def finish(self):
        """Join all parts into one skinned mesh."""
        objs = []
        for obj, bone in self.parts:
            vg = obj.vertex_groups.new(name=bone)
            vg.add(list(range(len(obj.data.vertices))), 1.0, "REPLACE")
            objs.append(obj)
        bpy.ops.object.select_all(action="DESELECT")
        for o in objs:
            o.select_set(True)
        bpy.context.view_layer.objects.active = objs[0]
        bpy.ops.object.join()
        body = bpy.context.view_layer.objects.active
        body.name = self.name
        body.data.name = self.name
        if self.armature:
            mod = body.modifiers.new("rig", "ARMATURE")
            mod.object = self.armature
            body.parent = self.armature
        self.body = body
        bake_shading(body)
        return body

    def triangles(self):
        return sum(len(p.vertices) - 2 for p in self.body.data.polygons)

    def export(self, path):
        bpy.ops.object.select_all(action="SELECT")
        kwargs = dict(
            filepath=path,
            export_format="GLB",
            export_yup=True,
            export_apply=False,
            export_animations=True,
            export_animation_mode="ACTIONS",
            export_skins=True,
            export_morph=False,
            export_materials="EXPORT",
            # With "NONE" the exporter also drops the UVs. Export a JPEG; tools/models/build.ts removes it.
            export_image_format="JPEG",
            export_vertex_color="ACTIVE",
        )
        try:
            bpy.ops.export_scene.gltf(**kwargs)
        except TypeError:
            kwargs.pop("export_vertex_color")
            bpy.ops.export_scene.gltf(**kwargs)


# Hemisphere directions around +Z (cosine-weighted, fixed so builds are repeatable).
_AO_DIRS = []
for _i in range(16):
    _u = (_i + 0.5) / 16
    _a = _i * 2.399963
    _r = math.sqrt(_u)
    _AO_DIRS.append(Vector((math.cos(_a) * _r, math.sin(_a) * _r, math.sqrt(max(0.0, 1 - _u)))))


def bake_shading(body):
    """Painted-look shading baked into the vertex colors of the joined model, like hand-painted
    textures in classic hero games: ambient occlusion from the model's own parts and from the
    ground (rays from each vertex), darker creases and lighter sharp edges. Glow parts are left
    as they are. Cheap at run time: it is only vertex color."""
    from mathutils.bvhtree import BVHTree

    mesh = body.data
    attr = mesh.color_attributes.get("Col")
    if attr is None or not mesh.vertices:
        return
    verts = [v.co.copy() for v in mesh.vertices]
    tree = BVHTree.FromPolygons(verts, [tuple(p.vertices) for p in mesh.polygons], all_triangles=False)
    height = max(0.3, max(v.z for v in verts) - min(min(v.z for v in verts), 0.0))
    # Only near things count (folds, armpits, under pads). A longer reach let a cape 0.5 m away
    # turn the backs of legs and shoulder pads black.
    reach = min(0.4, max(0.06, height * 0.16))
    eps = height * 0.004
    glow = {i for i, m in enumerate(mesh.materials) if m and m.name == "glow"}

    # Neighbors for the crease / edge term.
    links = [[] for _ in verts]
    for e in mesh.edges:
        a, b = e.vertices
        links[a].append(b)
        links[b].append(a)

    shade = [1.0] * len(verts)
    for vi, v in enumerate(mesh.vertices):
        n = v.normal
        if n.length < 0.5:
            continue
        rot = Vector((0, 0, 1)).rotation_difference(n)
        origin = v.co + n * eps
        hidden = 0.0
        for d0 in _AO_DIRS:
            d = rot @ d0
            hit = tree.ray_cast(origin, d, reach)
            dist = hit[3] if hit[0] is not None else None
            # The ground under the model also blocks light (dark feet, contact shadow).
            if d.z < -0.05 and origin.z >= -eps:
                g = -origin.z / d.z
                if g < reach and (dist is None or g < dist):
                    dist = g
            if dist is not None:
                hidden += 1.0 - 0.6 * (dist / reach)
        ao = 1.0 - hidden / len(_AO_DIRS)
        # Crease (+) or sharp edge (-): where the neighbors lie compared with the normal.
        bend = 0.0
        if links[vi]:
            for o in links[vi]:
                dv = verts[o] - v.co
                if dv.length > 1e-6:
                    bend += n.dot(dv.normalized())
            bend /= len(links[vi])
        edge = 1.0 + 0.2 * min(1.0, max(0.0, -bend * 3.0)) - 0.22 * min(1.0, max(0.0, bend * 3.0))
        # The darkest hidden spot keeps about 60% of its color (sRGB terms): dark armor must not
        # turn black. A small lift keeps open surfaces as bright as before.
        shade[vi] = (0.6 + 0.43 * ao) * edge

    # Two smoothing passes keep the shading soft on low-poly parts.
    for _ in range(2):
        nxt = shade[:]
        for vi, ls in enumerate(links):
            if ls:
                nxt[vi] = 0.5 * shade[vi] + 0.5 * sum(shade[o] for o in ls) / len(ls)
        shade = nxt

    print(f"SHADING avg {sum(shade) / len(shade):.2f} min {min(shade):.2f} max {max(shade):.2f}")
    for poly in mesh.polygons:
        if poly.material_index in glow:
            continue
        for li in poly.loop_indices:
            k = shade[mesh.loops[li].vertex_index] ** 2.2  # picked in sRGB terms, colors are linear
            c = attr.data[li].color
            attr.data[li].color = (min(1.0, c[0] * k), min(1.0, c[1] * k), min(1.0, c[2] * k), c[3])
