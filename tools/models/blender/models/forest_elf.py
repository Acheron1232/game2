"""Forest Elf — tall noble ranger. Long golden-green hair, pointed ears, antler circlet,
a cloak of living leaves with team edges, leaf shoulder pads, leaf skirt, vine-wrapped boots,
a living-wood longbow with leaves in the left fist, quiver on the back.
Skin: standard 20-cell hero sheet. extra_1 = leaves, extra_2 = hair, extra_3 = quiver, extra_4 = nature glow."""

import math

import chunky as c
import humanoid
from kit import Model
from mathutils import Vector

W = "#ffffff"


def build():
    m = Model("forest_elf", skin="forest_elf_skin")
    humanoid.skeleton(m, height=1.95, shoulders=0.22, hips=0.12, leg_len=1.08, arm_len=1.05, hunch=0.3, arm_spread=0.35, knee_bend=0.25, elbow_bend=0.6)
    j = m.joints
    hz = j["hips"][2]
    top, fy = j["neck"][2], j["neck"][1]

    c.torso(m, waist=(0.26, 0.2), belly=(0.3, 0.22), chest=(0.42, 0.28), shoulders=(0.48, 0.28), neck=(0.17, 0.14), hump=False)
    c.head(m, size=(0.2, 0.21, 0.26), jaw=0.8, ears=None)
    hx, hy, hzz = j["head"]
    # Long pointed ears
    for sx in (1, -1):
        m.part("hull", 1, profile=[(sx * 0.09, hy, hzz + 0.07), (sx * 0.1, hy + 0.03, hzz + 0.13), (sx * 0.26, hy + 0.08, hzz + 0.25), (sx * 0.09, hy + 0.03, hzz + 0.04)], slot="face", sub=(0.0, 0.12, 0.45, 0.6), tint="#f0c8a8", bone="head", smooth=c.FACET)
    # Long hair down the back
    m.part("loft", 1, profile=[(0, hy + 0.06, hzz + 0.22, 0.25, 0.15), (0, hy + 0.12, hzz - 0.02, 0.3, 0.13), (0, hy + 0.15, hzz - 0.45, 0.26, 0.08), (0, hy + 0.14, hzz - 0.62, 0.12, 0.04)], slot="extra_2", uv="front", back="head_back", tint=W, bone="head", segments=5, smooth=c.FACET)
    # Antler circlet: two branching antlers
    for sx in (1, -1):
        base = Vector((sx * 0.08, hy - 0.02, hzz + 0.22))
        main = [base, base + Vector((sx * 0.08, 0.02, 0.12)), base + Vector((sx * 0.16, 0.08, 0.26)), base + Vector((sx * 0.2, 0.15, 0.36))]
        m.part("loft", 1, profile=[(*p, w, w) for p, w in zip(main, (0.05, 0.045, 0.035, 0.005))], slot="weapon_b", uv="wrap", sub=(0.2, 0.8, 0.3, 0.7), tint=W, bone="head", segments=4, smooth=c.FACET)
        for k, pt in enumerate(main[1:3]):
            tip = pt + Vector((sx * 0.02, -0.06, 0.13 - k * 0.03))
            m.part("loft", 1, profile=[(*pt, 0.03, 0.03), (*tip, 0.004, 0.004)], slot="weapon_b", uv="wrap", sub=(0.2, 0.8, 0.3, 0.7), tint=W, bone="head", segments=4, smooth=c.FACET)

    # Arms with wooden bracers, gloves; leaf shoulder pads (team edges)
    for side in ("L", "R"):
        s, e, w = j[f"upper_arm.{side}"], j[f"forearm.{side}"], j[f"hand.{side}"]
        c.blob(m, s, 0.1, "arm", f"upper_arm.{side}")
        c.limb(m, s, e, [(0.0, 0.14, 0.13), (0.5, 0.12, 0.11), (1.0, 0.1, 0.1)], slot="arm", uv="wrap", bone=f"upper_arm.{side}", segments=6)
        c.limb(m, e, w, [(0.0, 0.1, 0.1), (0.5, 0.14, 0.13), (1.0, 0.12, 0.11)], slot="forearm", uv="wrap", bone=f"forearm.{side}", segments=6)
        c.shoulder_pad(m, side, slot="shoulder", size=0.72, spikes=0)
    c.fist(m, "L", slot="hand", size=0.06)
    c.open_hand(m, "R", slot="hand", size=0.065)

    # Leaf cloak (team edges) and a skirt of leaves
    c.cape(m, slot="cloth", length=1.25, width=0.6)
    c.belt(m, size=(0.32, 0.25), height=0.09)
    for k in range(9):
        a = 2 * math.pi * k / 9
        base = Vector((math.cos(a) * 0.15, math.sin(a) * 0.12, hz))
        tip = Vector((math.cos(a) * 0.24, math.sin(a) * 0.2, hz - 0.36))
        m.part("hull", 1, profile=[tuple(base + Vector((-math.sin(a) * 0.07, math.cos(a) * 0.07, 0))), tuple(base + Vector((math.sin(a) * 0.07, -math.cos(a) * 0.07, 0))), tuple(tip), tuple((base + tip) / 2 + Vector((math.cos(a) * 0.03, math.sin(a) * 0.03, 0)))],
               slot="extra_1", tint=W, bone="hips", smooth=10)
    for side in ("L", "R"):
        c.leg(m, side, thigh_slot="legs", shin_slot="shin", foot_slot="foot", thigh=(0.17, 0.16, 0.1), shin=(0.12, 0.13, 0.09), band="trim", boot=0.8)

    # Quiver on the back
    qa, qb = Vector((0.14, fy + 0.22, top - 0.55)), Vector((-0.1, fy + 0.26, top + 0.05))
    c.limb(m, tuple(qa), tuple(qb), [(0, 0.15, 0.14), (1, 0.17, 0.16)], slot="extra_3", uv="wrap", sub=(0.2, 0.8, 0.0, 0.7), bone="chest", segments=6)

    # Living-wood longbow with small leaves, glowing green string
    g = Vector(c.grip_point(m, "L"))
    up = Vector((0, -0.05, 1)).normalized()
    out = Vector((0, -1, 0))

    def arc(sign):
        return [g + up * sign * math.sin(t * 1.15) * 0.9 - out * (1 - math.cos(t * 1.15)) * 0.32 for t in (k / 5 for k in range(6))]

    for sign in (1, -1):
        pts = arc(sign)
        m.part("loft", 1, profile=[(*p, w, w * 0.85) for p, w in zip(pts, (0.08, 0.08, 0.075, 0.065, 0.05, 0.03))], slot="weapon_a", uv="wrap", sub=(0.3, 0.7, 0.0, 1.0), tint=W, bone="hand.L", segments=5, smooth=c.FACET)
        for p in pts[2:5:2]:
            m.part("hull", 1, profile=[tuple(p), tuple(p + Vector((0.1, -0.02, 0.06 * sign))), tuple(p + Vector((0.05, -0.08, 0.1 * sign))), tuple(p + Vector((0.07, 0.03, 0.04 * sign)))], slot="extra_1", tint=W, bone="hand.L", smooth=10)
    c.limb(m, tuple(arc(-1)[-1]), tuple(arc(1)[-1]), [(0, 0.018, 0.018), (1, 0.018, 0.018)], slot="extra_4", bone="hand.L", segments=4, material="glow", light=False)

    m.socket("aura", (0, j["chest"][1], j["chest"][2]), "chest")
    m.socket("bow", tuple(g), "hand.L")
    m.socket("antlers", (0, hy, hzz + 0.45), "head")
    humanoid.animations(m, style="ranged")
    return m
