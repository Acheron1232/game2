"""Sky Dragon — flying hero in the classic RTS hero-dragon look: a heavy chest and shoulders,
thick S-curved neck, big horned head with an open fiery mouth, huge bat wings with bony fingers
and sagging team-color membranes, front claws held forward, hind legs tucked, a thick spiked tail.
Skin cells (standard names, dragon meaning):
  face=head front, head_back=head top + horns base, chest=belly, back=back scales (+team spikes),
  arm=upper leg, forearm=lower leg, hand=front claw, legs=haunch, shin=neck, foot=hind claw,
  belt=belly bands, cloth=wing membrane (team), shoulder=back spikes (team), trim=team scale stripe,
  weapon_a=horn, weapon_b=teeth, extra_1=tail, extra_2=wing bones, extra_3=tail tip, extra_4=fire."""

import math

import chunky as c
from kit import Model
from mathutils import Vector

W = "#ffffff"
UP = Vector((0, 0, 1))


def bones(m):
    """Body hovers ~1 m up, pitched up at the front. Head at -Y."""
    z = 1.75
    b = {
        "root": ((0, 0, 0), (0, 0, 0.2), None),
        "body": ((0, 0.75, z - 0.15), (0, 0.0, z), "root"),
        "chest": ((0, 0.0, z), (0, -0.6, z + 0.3), "body"),
        "neck1": ((0, -0.6, z + 0.3), (0, -0.85, z + 0.85), "chest"),
        "neck2": ((0, -0.85, z + 0.85), (0, -1.2, z + 1.2), "neck1"),
        "head": ((0, -1.2, z + 1.2), (0, -1.85, z + 1.05), "neck2"),
        "jaw": ((0, -1.3, z + 1.08), (0, -1.8, z + 0.9), "head"),
        "tail1": ((0, 0.75, z - 0.15), (0, 1.55, z - 0.5), "body"),
        "tail2": ((0, 1.55, z - 0.5), (0, 2.4, z - 0.45), "tail1"),
        "tail3": ((0, 2.4, z - 0.45), (0, 3.1, z - 0.15), "tail2"),
    }
    for s, x in (("L", 1), ("R", -1)):
        b[f"wing1.{s}"] = ((x * 0.35, -0.35, z + 0.4), (x * 1.25, -0.2, z + 1.05), "chest")
        b[f"wing2.{s}"] = ((x * 1.25, -0.2, z + 1.05), (x * 2.45, 0.25, z + 0.85), f"wing1.{s}")
        b[f"front_upper.{s}"] = ((x * 0.36, -0.42, z), (x * 0.45, -0.7, z - 0.4), "chest")
        b[f"front_lower.{s}"] = ((x * 0.45, -0.7, z - 0.4), (x * 0.42, -0.95, z - 0.55), f"front_upper.{s}")
        b[f"back_upper.{s}"] = ((x * 0.4, 0.6, z - 0.3), (x * 0.5, 0.35, z - 0.8), "body")
        b[f"back_lower.{s}"] = ((x * 0.5, 0.35, z - 0.8), (x * 0.45, 0.75, z - 1.05), f"back_upper.{s}")
    m.skeleton(b)
    m.joints = {n: h for n, (h, t, p) in b.items()}
    m.tails = {n: t for n, (h, t, p) in b.items()}
    m.height = z + 1.4
    return b


def animations(m):
    def flap(a, b, period=24):
        h = period // 2
        return {
            "wing1.L": [(1, (0, a, 0)), (h, (0, b, 0)), (period, (0, a, 0))],
            "wing1.R": [(1, (0, -a, 0)), (h, (0, -b, 0)), (period, (0, -a, 0))],
            "wing2.L": [(1, (0, a * 0.7, 0)), (h + 2, (0, b * 0.9, 0)), (period, (0, a * 0.7, 0))],
            "wing2.R": [(1, (0, -a * 0.7, 0)), (h + 2, (0, -b * 0.9, 0)), (period, (0, -a * 0.7, 0))],
            "body": [(1, (0, 0, 0), (0, 0, 0.15)), (h, (0, 0, 0), (0, 0, -0.1)), (period, (0, 0, 0), (0, 0, 0.15))],
        }

    tail = {k: [(1, (0, 0, a)), (12, (0, 0, -a)), (24, (0, 0, a))] for k, a in (("tail1", 6), ("tail2", 10), ("tail3", 14))}
    neck = {"neck1": [(1, (0, 0, 0)), (12, (-4, 0, 0)), (24, (0, 0, 0))], "neck2": [(1, (0, 0, 0)), (12, (5, 0, 0)), (24, (0, 0, 0))]}
    m.action("idle", 24, {**flap(-35, 30), **tail, **neck})
    m.action("walk", 20, {**flap(-45, 40, 20), **tail, "chest": [(1, (10, 0, 0)), (20, (10, 0, 0))]})
    m.action("attack", 24, {**flap(-25, 20), "neck1": [(1, (0, 0, 0)), (8, (-20, 0, 0)), (13, (25, 0, 0)), (24, (0, 0, 0))],
                            "head": [(1, (0, 0, 0)), (8, (-15, 0, 0)), (13, (20, 0, 0)), (24, (0, 0, 0))], "jaw": [(1, (0, 0, 0)), (10, (30, 0, 0)), (14, (0, 0, 0)), (24, (0, 0, 0))]}, loop=False)
    m.action("attack2", 24, {**flap(-25, 20), "front_upper.L": [(1, (0, 0, 0)), (8, (-50, 0, 0)), (13, (40, 0, 0)), (24, (0, 0, 0))], "front_upper.R": [(1, (0, 0, 0)), (10, (-50, 0, 0)), (15, (40, 0, 0)), (24, (0, 0, 0))],
                             "tail1": [(1, (0, 0, 0)), (14, (0, 0, 35)), (24, (0, 0, 0))]}, loop=False)
    m.action("cast", 36, {**flap(-55, 55, 36), "neck1": [(1, (0, 0, 0)), (14, (-25, 0, 0)), (26, (15, 0, 0)), (36, (0, 0, 0))], "jaw": [(1, (0, 0, 0)), (14, (40, 0, 0)), (30, (40, 0, 0)), (36, (0, 0, 0))]}, loop=False)
    m.action("hit", 12, {"body": [(1, (0, 0, 0), (0, 0, 0)), (4, (-12, 0, 0), (0, 0.2, 0.1)), (12, (0, 0, 0), (0, 0, 0))], "neck1": [(1, (0, 0, 0)), (4, (-20, 0, 0)), (12, (0, 0, 0))]}, loop=False)
    m.action("death", 44, {"body": [(1, (0, 0, 0), (0, 0, 0)), (20, (20, 30, 0), (0, 0, -0.8)), (38, (10, 80, 0), (0, 0, -1.45)), (44, (10, 85, 0), (0, 0, -1.45))],
                           "wing1.L": [(1, (0, 0, 0)), (30, (0, -55, 0)), (44, (0, -60, 0))], "wing1.R": [(1, (0, 0, 0)), (30, (0, 30, 0)), (44, (0, 35, 0))],
                           "neck1": [(1, (0, 0, 0)), (44, (40, 0, 20))], "neck2": [(1, (0, 0, 0)), (44, (30, 0, 0))]}, loop=False)
    m.action("victory", 40, {**flap(-65, 65, 40), "neck1": [(1, (0, 0, 0)), (12, (-35, 0, 0)), (30, (-35, 0, 0)), (40, (0, 0, 0))], "jaw": [(1, (0, 0, 0)), (12, (40, 0, 0)), (30, (40, 0, 0)), (40, (0, 0, 0))]}, loop=False)


def build():
    m = Model("sky_dragon", skin="sky_dragon_skin")
    bones(m)
    j, t = m.joints, m.tails

    # ---- Body: heavy chest and shoulders, slimmer hips. Back scales, belly underneath.
    path = [Vector(j["body"]), Vector((0, 0.35, j["body"][2] + 0.07)), Vector(j["chest"]), Vector((0, -0.35, j["chest"][2] + 0.18)), Vector(t["chest"])]
    widths = [(0.62, 0.58), (0.82, 0.74), (1.0, 0.86), (1.05, 0.88), (0.74, 0.66)]
    m.part("loft", 1, profile=[(*p, w, d) for p, (w, d) in zip(path, widths)], slot="back", uv="wrap", tint=W, bone="body", segments=7, smooth=c.FACET)
    m.part("loft", 1, profile=[(*(p - UP * d * 0.42), w * 0.78, d * 0.25) for p, (w, d) in zip(path[1:], widths[1:])], slot="chest", uv="top", tint=W, bone="chest", segments=6, smooth=c.FACET)

    # ---- Neck: thick S-curve in two bones, belly bands under it
    n = [Vector(t["chest"]), Vector(t["neck1"]), Vector(t["neck2"])]
    c.limb(m, tuple(n[0]), tuple(n[1]), [(0, 0.62, 0.6), (1, 0.42, 0.42)], slot="shin", uv="wrap", bone="neck1", segments=6)
    c.limb(m, tuple(n[1]), tuple(n[2]), [(0, 0.42, 0.42), (1, 0.34, 0.34)], slot="shin", uv="wrap", bone="neck2", segments=6)
    for a, b, bone, w in ((n[0], n[1], "neck1", 0.36), (n[1], n[2], "neck2", 0.26)):
        c.limb(m, tuple(a + Vector((0, -0.17, -0.05))), tuple(b + Vector((0, -0.13, -0.04))), [(0, w, 0.1), (1, w * 0.8, 0.09)], slot="belt", uv="wrap", bone=bone, segments=4)

    # ---- Head: big wedge skull, heavy brow, open jaw with teeth and fire inside, swept horns
    h0, h1 = Vector(j["head"]), Vector(t["head"])
    fwd = (h1 - h0).normalized()
    side = fwd.cross(UP).normalized()
    up = side.cross(fwd).normalized()
    c.frame_hull(m, h0, (side, -fwd, up), [(-0.26, 0.12, -0.12), (0.26, 0.12, -0.12), (-0.28, 0.1, 0.2), (0.28, 0.1, 0.2), (-0.17, -0.62, -0.03), (0.17, -0.62, -0.03), (-0.15, -0.58, 0.13), (0.15, -0.58, 0.13),
                                             (0, -0.7, 0.05), (0, 0.2, 0.28), (-0.22, -0.2, 0.26), (0.22, -0.2, 0.26)], slot="face", uv="front", back="head_back", bone="head")
    j0 = Vector(j["jaw"])
    jf = (Vector(t["jaw"]) - j0).normalized()
    js = jf.cross(UP).normalized()
    ju = js.cross(jf).normalized()
    c.frame_hull(m, j0, (js, -jf, ju), [(-0.2, 0.05, 0.02), (0.2, 0.05, 0.02), (-0.18, 0.05, -0.14), (0.18, 0.05, -0.14), (-0.12, -0.55, 0.0), (0.12, -0.55, 0.0), (-0.1, -0.52, -0.1), (0.1, -0.52, -0.1)],
                 slot="weapon_b", uv="front", bone="jaw")
    fire = j0 + jf * 0.3 + ju * 0.07
    c.blob(m, tuple(fire), 0.11, "extra_4", "jaw", uv="front")
    m.parts[-1][0].data.materials.clear()
    m._material(m.parts[-1][0], "glow")
    for sx in (1, -1):
        base = h0 + side * 0.2 * sx + up * 0.2 + fwd * 0.02
        pts = [base, base + side * 0.12 * sx - fwd * 0.28 + up * 0.14, base + side * 0.2 * sx - fwd * 0.62 + up * 0.12, base + side * 0.16 * sx - fwd * 0.92 - up * 0.04]
        m.part("loft", 1, profile=[(*p, w, w) for p, w in zip(pts, (0.15, 0.12, 0.07, 0.005))], slot="weapon_a", uv="wrap", tint=W, bone="head", segments=5, smooth=c.FACET)
        for k, (off, ln) in enumerate(((-0.05, 0.22), (-0.22, 0.16))):
            cb = h0 + side * 0.26 * sx - fwd * 0.0 + fwd * off * -1 + up * 0.0
            m.part("loft", 1, profile=[(*cb, 0.08, 0.08), (*(cb + side * ln * sx - fwd * 0.14 - up * 0.04), 0.005, 0.005)], slot="weapon_a", uv="wrap", tint=W, bone="head", segments=4, smooth=c.FACET)

    # ---- Back spikes (team) from the head down the spine to the tail
    spine = [(0.55, "body"), (0.25, "body"), (-0.05, "chest"), (-0.35, "chest")]
    for k, (y, bone) in enumerate(spine):
        z = j["chest"][2] + 0.45 - k * 0.02
        h = 0.32 - k * 0.03
        m.part("hull", 1, profile=[(-0.07, y + 0.12, z - 0.08), (0.07, y + 0.12, z - 0.08), (-0.07, y - 0.1, z - 0.08), (0.07, y - 0.1, z - 0.08), (0, y + 0.14, z + h)], slot="shoulder", uv="front", tint=W, bone=bone, smooth=c.FACET)

    # ---- Tail: three thick segments, team spikes, a spiked club at the tip
    tp = [Vector(j["tail1"]), Vector(t["tail1"]), Vector(t["tail2"]), Vector(t["tail3"])]
    for k, (bone, w0, w1) in enumerate((("tail1", 0.6, 0.42), ("tail2", 0.42, 0.26), ("tail3", 0.26, 0.12))):
        c.limb(m, tuple(tp[k]), tuple(tp[k + 1]), [(0, w0, w0 * 0.9), (1, w1, w1 * 0.9)], slot="extra_1", uv="wrap", bone=bone, segments=6)
        mid = (tp[k] + tp[k + 1]) / 2 + UP * w0 * 0.42
        m.part("hull", 1, profile=[(-0.05, mid.y + 0.08, mid.z - 0.05), (0.05, mid.y + 0.08, mid.z - 0.05), (-0.05, mid.y - 0.08, mid.z - 0.05), (0.05, mid.y - 0.08, mid.z - 0.05), (0, mid.y + 0.12, mid.z + 0.22 - k * 0.04)],
               slot="shoulder", uv="front", tint=W, bone=bone, smooth=c.FACET)
    tip = tp[3]
    c.frame_hull(m, tip, (Vector((1, 0, 0)), Vector((0, 1, 0)), UP), [(-0.26, 0, 0), (0.26, 0, 0), (0, 0.5, 0.02), (0, -0.08, 0.16), (0, -0.08, -0.12), (-0.09, 0.15, 0.08), (0.09, 0.15, 0.08)], slot="extra_3", uv="front", bone="tail3")

    # ---- Legs: front claws reach forward, hind legs tucked under the body
    for sd in ("L", "R"):
        for part, slot_u, slot_f, r in (("front", "arm", "hand", 0.24), ("back", "legs", "foot", 0.34)):
            u0, u1, l1 = Vector(j[f"{part}_upper.{sd}"]), Vector(t[f"{part}_upper.{sd}"]), Vector(t[f"{part}_lower.{sd}"])
            c.limb(m, tuple(u0), tuple(u1), [(0, r * 1.5, r * 1.4), (0.5, r * 1.15, r * 1.1), (1, r * 0.75, r * 0.75)], slot=slot_u, uv="wrap", bone=f"{part}_upper.{sd}", segments=6)
            c.limb(m, tuple(u1), tuple(l1), [(0, r * 0.75, r * 0.75), (1, r * 0.5, r * 0.5)], slot="forearm", uv="wrap", bone=f"{part}_lower.{sd}", segments=5)
            d = (l1 - u1).normalized()
            sx_ = Vector((1, 0, 0))
            c.frame_hull(m, l1, (sx_, d, sx_.cross(d)), [(-0.12, -0.02, 0.05), (0.12, -0.02, 0.05), (-0.14, 0.16, -0.05), (0.14, 0.16, -0.05), (-0.1, -0.05, -0.08), (0.1, -0.05, -0.08), (0, 0.24, -0.1)],
                         slot=slot_f, uv="top", bone=f"{part}_lower.{sd}")
            for k in (-1, 0, 1):
                cb = l1 + d * 0.14 + sx_ * k * 0.08
                m.part("loft", 1, profile=[(*cb, 0.05, 0.05), (*(cb + d * 0.16 - UP * 0.06), 0.004, 0.004)], slot="weapon_a", uv="wrap", tint=W, bone=f"{part}_lower.{sd}", segments=4, smooth=c.FACET)

    # ---- Wings: arm bone, forearm bone, 3 long fingers; membranes sag between the fingers
    for sd, sx in (("L", 1), ("R", -1)):
        w0, w1, w2 = Vector(j[f"wing1.{sd}"]), Vector(t[f"wing1.{sd}"]), Vector(t[f"wing2.{sd}"])
        c.limb(m, tuple(w0), tuple(w1), [(0, 0.22, 0.2), (1, 0.13, 0.12)], slot="extra_2", uv="wrap", bone=f"wing1.{sd}", segments=5)
        c.limb(m, tuple(w1), tuple(w2), [(0, 0.13, 0.12), (1, 0.05, 0.05)], slot="extra_2", uv="wrap", bone=f"wing2.{sd}", segments=5)
        m.part("loft", 1, profile=[(*w1, 0.1, 0.1), (*(w1 + Vector((sx * 0.05, -0.08, 0.32))), 0.005, 0.005)], slot="weapon_a", uv="wrap", tint=W, bone=f"wing2.{sd}", segments=4, smooth=c.FACET)  # thumb claw
        fingers = [w2, w1 + Vector((sx * 1.05, 1.05, -0.45)), w1 + Vector((sx * 0.45, 1.35, -0.75))]
        for f in fingers[1:]:
            c.limb(m, tuple(w1), tuple(f), [(0, 0.08, 0.07), (1, 0.025, 0.025)], slot="extra_2", uv="wrap", bone=f"wing2.{sd}", segments=4)
        body_back = Vector((sx * 0.38, 0.75, j["body"][2] - 0.05))
        edges = [(w0, w1, fingers[2], body_back, f"wing1.{sd}"), (w1, fingers[0], fingers[1], None, f"wing2.{sd}"), (w1, fingers[1], fingers[2], None, f"wing2.{sd}")]
        for a, b, cc, dd, bone in edges:
            outer = [b, cc] + ([dd] if dd else [])
            # Sagging trailing edge: a point between the two tips, pulled toward the root and down
            sag = (b + cc) / 2 * 0.78 + a * 0.22 - UP * 0.12
            pts = [a, b, sag, cc] + ([dd] if dd else [])
            for p0, p1, p2 in [(pts[0], pts[i], pts[i + 1]) for i in range(1, len(pts) - 1)]:
                tri = [p0, p1, p2]
                thick = [p + UP * 0.02 for p in tri] + [p - UP * 0.02 for p in tri]
                m.part("hull", 1, profile=[tuple(p) for p in thick], slot="cloth", uv="top", tint=W, bone=bone, smooth=8)

    m.socket("mouth", tuple(fire + jf * 0.25), "jaw")
    m.socket("chest", (0, -0.45, j["chest"][2] - 0.2), "chest")
    m.socket("tail", tuple(tip), "tail3")
    animations(m)
    return m
