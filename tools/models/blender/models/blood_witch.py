"""Blood Witch — tall sinister caster in the classic RTS hero look.
Horned hood, spiked bone collar, skull pauldrons, long ragged skirt, clawed open hands,
crooked dead-wood staff with a big glowing red crystal held in claw prongs.
Texture: blood_witch_skin (standard 20-cell hero sheet)."""

import math

import chunky as c
import humanoid
from kit import Model
from mathutils import Vector


def build():
    m = Model("blood_witch", skin="blood_witch_skin")
    humanoid.skeleton(m, height=1.92, shoulders=0.23, hips=0.11, leg_len=1.0, arm_len=1.1, hunch=0.5, arm_spread=0.45, knee_bend=0.0, elbow_bend=0.85)
    j = m.joints
    hz = j["hips"][2]

    c.torso(m, waist=(0.3, 0.22), belly=(0.34, 0.25), chest=(0.46, 0.3), shoulders=(0.54, 0.3), neck=(0.2, 0.16), hump=False)
    c.head(m, size=(0.21, 0.22, 0.26), jaw=0.85, ears=None)
    hx, hy, hzz = j["head"]

    # Hood: an open shell around the back and sides of the head, the face stays visible.
    # Built as a hull of points on a ring that skips the front.
    hood = []
    for zc, r, yb in ((hzz - 0.08, 0.2, 0.0), (hzz + 0.08, 0.21, 0.02), (hzz + 0.22, 0.18, 0.05)):
        for k in range(9):
            a = math.radians(-60 + 300 * k / 8) - math.pi / 2  # from front-right around the back to front-left
            hood.append((math.cos(a) * r, hy + 0.04 + yb + math.sin(a) * r * -1.0, zc))
    hood += [(0, hy + 0.12, hzz + 0.34), (0, hy + 0.24, hzz + 0.36), (0, hy + 0.2, hzz - 0.12)]
    # Front edge sits at the cheeks (y in front of the face would cover it)
    hood = [(x, max(y, hy - 0.06), z) for x, y, z in hood]
    m.part("hull", 1, profile=hood, slot="extra_1", uv="front", back="extra_1", tint="#ffffff", bone="head", smooth=c.FACET)
    # Hood point at the top front
    m.part("hull", 1, profile=[(-0.08, hy - 0.06, hzz + 0.24), (0.08, hy - 0.06, hzz + 0.24), (0, hy - 0.1, hzz + 0.33), (0, hy + 0.02, hzz + 0.3)], slot="extra_1", sub=(0.3, 0.7, 0.6, 1.0), tint="#ffffff", bone="head", smooth=c.FACET)
    # Curved horns out of the hood
    for side, sx in (("L", 1), ("R", -1)):
        base = Vector((sx * 0.13, hy + 0.04, hzz + 0.24))
        p1 = base + Vector((sx * 0.12, 0.02, 0.12))
        p2 = base + Vector((sx * 0.2, 0.1, 0.26))
        p3 = base + Vector((sx * 0.16, 0.2, 0.36))
        m.part("loft", 1, profile=[(*base, 0.09, 0.09), (*p1, 0.075, 0.075), (*p2, 0.05, 0.05), (*p3, 0.005, 0.005)], slot="extra_2", uv="wrap", tint="#ffffff", bone="head", segments=5, smooth=c.FACET)

    # Arms: long sleeves, flared ragged cuffs, clawed open hands
    for side in ("L", "R"):
        s, e, w = j[f"upper_arm.{side}"], j[f"forearm.{side}"], j[f"hand.{side}"]
        c.limb(m, s, e, [(0.0, 0.17, 0.16), (0.5, 0.14, 0.13), (1.0, 0.12, 0.12)], slot="arm", uv="wrap", bone=f"upper_arm.{side}", segments=6)
        c.limb(m, e, w, [(0.0, 0.12, 0.12), (0.55, 0.15, 0.15), (1.0, 0.27, 0.25)], slot="forearm", uv="wrap", bone=f"forearm.{side}", segments=6)
        c.open_hand(m, side, slot="hand", size=0.085)

    # Spiked bone collar with team cloth, skull pauldrons
    top, fy = j["neck"][2], j["neck"][1]
    m.part("loft", 1, profile=[(0, fy, top - 0.08, 0.6, 0.42), (0, fy, top + 0.02, 0.5, 0.36), (0, fy, top + 0.1, 0.3, 0.26)], slot="shoulder", uv="wrap", tint="#ffffff", bone="chest", segments=8, smooth=c.FACET)
    for i in range(7):
        a = math.pi * (0.15 + 0.7 * i / 6)
        dx, dy = math.cos(a), -math.sin(a) * 0.3 + 0.35
        base = (dx * 0.26, fy + dy * 0.4, top + 0.02)
        tip = (dx * 0.42, fy + dy * 0.62, top + 0.3)
        m.part("loft", 1, profile=[(*base, 0.06, 0.06), (*c.lerp(base, tip, 0.5), 0.04, 0.04), (*tip, 0.004, 0.004)], slot="weapon_b", uv="wrap", tint="#ffffff", bone="chest", segments=4, smooth=c.FACET)
    for side in ("L", "R"):
        sxx, syy, szz = j[f"upper_arm.{side}"]
        sx = 1 if side == "L" else -1
        m.part("hull", 1, profile=[(sxx + sx * dx, syy + dy, szz + dz) for dx, dy, dz in [(-0.08, -0.1, 0.0), (0.1, -0.1, 0.0), (-0.08, 0.1, 0.0), (0.1, 0.1, 0.0), (0.0, -0.12, 0.13), (0.02, 0.08, 0.15), (0.12, 0.0, 0.08), (-0.1, 0.0, 0.08)]],
               slot="extra_3", uv="front", back="weapon_b", tint="#ffffff", bone=f"upper_arm.{side}", smooth=c.FACET)

    # Belt with skulls, team sash, long ragged skirt with a torn bloody hem
    c.belt(m, size=(0.36, 0.28), height=0.1)
    m.part("loft", 1, profile=[(0.06, -0.16, hz, 0.12, 0.03), (0.08, -0.2, hz - 0.35, 0.14, 0.03), (0.1, -0.2, hz - 0.62, 0.1, 0.02)], slot="cloth", uv="front", tint="#ffffff", bone="hips", segments=4, smooth=c.FACET)
    m.part("loft", 1, profile=[(0, 0.0, hz + 0.02, 0.36, 0.28), (0, 0.01, hz - 0.3, 0.5, 0.42), (0, 0.03, 0.45, 0.66, 0.56)], slot="legs", uv="wrap", tint="#ffffff", bone="hips", segments=9, smooth=c.FACET)
    m.part("loft", 1, profile=[(0, 0.03, 0.47, 0.66, 0.56), (0, 0.04, 0.2, 0.76, 0.66), (0, 0.04, 0.02, 0.82, 0.72)], slot="shin", uv="wrap", tint="#ffffff", bone="hips", segments=9, smooth=c.FACET)
    # Tattered back cape
    c.cape(m, slot="extra_1", length=1.15, width=0.5)
    for side in ("L", "R"):
        x, y, z = j[f"foot.{side}"]
        m.part("hull", 1, profile=[(x - 0.05, y + 0.04, 0), (x + 0.05, y + 0.04, 0), (x, y - 0.3, 0), (x - 0.04, y, 0.08), (x + 0.04, y, 0.08)], slot="foot", uv="top", tint="#ffffff", bone=f"foot.{side}", smooth=c.FACET)

    # Crooked staff in the right hand: three bent pieces of dead wood, claws holding a big crystal
    g = Vector(c.grip_point(m, "R"))
    pts = [g + Vector((0.02, 0.05, -0.95)), g + Vector((0.0, 0.0, -0.3)), g + Vector((-0.04, -0.02, 0.35)), g + Vector((0.03, -0.05, 0.85)), g + Vector((-0.02, -0.04, 1.15))]
    m.part("loft", 1, profile=[(*p, wdt, wdt) for p, wdt in zip(pts, (0.06, 0.075, 0.07, 0.07, 0.09))], slot="weapon_a", uv="wrap", sub=(0.2, 0.8, 0, 1), tint="#ffffff", bone="weapon", segments=5, smooth=c.FACET)
    head_c = pts[-1] + Vector((0, 0, 0.22))
    for k in range(4):
        a = math.pi * 2 * k / 4 + 0.4
        base = pts[-1] + Vector((math.cos(a) * 0.05, math.sin(a) * 0.05, 0))
        tip = head_c + Vector((math.cos(a) * 0.1, math.sin(a) * 0.1, 0.1))
        m.part("loft", 1, profile=[(*base, 0.045, 0.045), (*c.lerp(base, tip, 0.5), 0.04, 0.04), (*tip, 0.004, 0.004)], slot="weapon_b", uv="wrap", tint="#ffffff", bone="weapon", segments=4, smooth=c.FACET)
    cx, cy, cz = head_c
    m.part("hull", 1, profile=[(cx, cy, cz - 0.17), (cx, cy, cz + 0.22), (cx + 0.1, cy, cz), (cx - 0.1, cy, cz), (cx, cy + 0.09, cz + 0.02), (cx, cy - 0.09, cz + 0.02), (cx + 0.06, cy - 0.06, cz + 0.1), (cx - 0.06, cy + 0.06, cz - 0.06)],
           slot="extra_4", uv="front", back="extra_4", material="glow", light=False, tint="#ffffff", bone="weapon", smooth=c.FACET)
    c.blob(m, tuple(pts[2] + Vector((0.03, -0.04, 0.05))), 0.07, "extra_3", "weapon", sub=(0.2, 0.8, 0.3, 0.9), uv="front")

    # Glowing red eyes (small glow bits in front of the painted eyes)
    for sx in (1, -1):
        c.blob(m, (sx * 0.045, hy - 0.12, hzz + 0.13), 0.016, "extra_4", "head", sub=(0.4, 0.6, 0.4, 0.6))
    m.parts[-1] = (m.parts[-1][0], "head")

    m.socket("crystal", (cx, cy, cz), "weapon")
    m.socket("hand_l", tuple(c.grip_point(m, "L")), "hand.L")
    m.socket("hem", (0, 0.04, 0.1), "hips")

    humanoid.animations(m, style="caster")
    return m
