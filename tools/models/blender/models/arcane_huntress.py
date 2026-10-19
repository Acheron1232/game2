"""Arcane Huntress — agile ranger. Silver-white ponytail, purple leather and silver armor, team cape
and shoulder guards, a big curved bow with a glowing violet string in the left hand, a quiver of
glowing arrows on the back, tall armored boots.
Skin cells: standard 20-cell hero sheet. extra_1 = quiver, extra_2 = glowing arrows,
extra_3 = hair, extra_4 = arcane energy (string, glow)."""

import math

import chunky as c
import humanoid
from kit import Model
from mathutils import Vector

W = "#ffffff"


def build():
    m = Model("arcane_huntress", skin="arcane_huntress_skin")
    humanoid.skeleton(m, height=1.85, shoulders=0.22, hips=0.12, leg_len=1.06, arm_len=1.05, hunch=0.35, arm_spread=0.35, knee_bend=0.3, elbow_bend=0.6)
    j = m.joints
    hz = j["hips"][2]
    top, fy = j["neck"][2], j["neck"][1]

    c.torso(m, waist=(0.26, 0.2), belly=(0.3, 0.22), chest=(0.42, 0.28), shoulders=(0.48, 0.28), neck=(0.17, 0.14), hump=False)
    c.head(m, size=(0.2, 0.21, 0.25), jaw=0.82, ears=None)
    hx, hy, hzz = j["head"]
    # Pointed ears out of the hair, long silver ponytail
    for sx in (1, -1):
        m.part("hull", 1, profile=[(sx * 0.09, hy, hzz + 0.08), (sx * 0.1, hy + 0.03, hzz + 0.12), (sx * 0.2, hy + 0.06, hzz + 0.2), (sx * 0.09, hy + 0.03, hzz + 0.05)], slot="face", sub=(0.0, 0.15, 0.4, 0.6), tint="#9a6a4a", bone="head", smooth=c.FACET)
    tail = [(0, hy + 0.12, hzz + 0.2), (0, hy + 0.22, hzz + 0.15), (0, hy + 0.3, hzz - 0.05), (0, hy + 0.28, hzz - 0.35), (0, hy + 0.24, hzz - 0.55)]
    m.part("loft", 1, profile=[(*p, w, w * 0.8) for p, w in zip(tail, (0.12, 0.13, 0.11, 0.08, 0.02))], slot="extra_3", uv="wrap", tint=W, bone="head", segments=5, smooth=c.FACET)
    m.part("loft", 1, profile=[(0, hy + 0.15, hzz + 0.18, 0.12, 0.1), (0, hy + 0.17, hzz + 0.21, 0.12, 0.1)], slot="trim", uv="wrap", tint=W, bone="head", segments=6)

    # Arms with silver vambraces, gloves
    for side in ("L", "R"):
        s, e, w = j[f"upper_arm.{side}"], j[f"forearm.{side}"], j[f"hand.{side}"]
        c.blob(m, s, 0.1, "arm", f"upper_arm.{side}")
        c.limb(m, s, e, [(0.0, 0.14, 0.13), (0.5, 0.12, 0.11), (1.0, 0.1, 0.1)], slot="arm", uv="wrap", bone=f"upper_arm.{side}", segments=6)
        c.limb(m, e, w, [(0.0, 0.1, 0.1), (0.5, 0.14, 0.13), (1.0, 0.12, 0.11)], slot="forearm", uv="wrap", bone=f"forearm.{side}", segments=6)
        c.shoulder_pad(m, side, slot="shoulder", size=0.62, spikes=1, spike_slot="weapon_b")
    c.fist(m, "L", slot="hand", size=0.06)
    c.open_hand(m, "R", slot="hand", size=0.065)

    # Belt with pouches, short team cape, slim legs in tall armored boots
    c.belt(m, size=(0.32, 0.25), height=0.09)
    for sx in (1, -1):
        m.part("hull", 1, profile=[(sx * 0.13 + dx, -0.12 + dy, hz - 0.08 + dz) for dx in (-0.05, 0.05) for dy in (-0.03, 0.05) for dz in (0, 0.1)], slot="belt", sub=(0.0, 0.35, 0.0, 0.45), tint=W, bone="hips", smooth=c.FACET)
    c.cape(m, slot="cloth", length=0.8, width=0.42)
    for side in ("L", "R"):
        c.leg(m, side, thigh_slot="legs", shin_slot="shin", foot_slot="foot", thigh=(0.17, 0.16, 0.1), shin=(0.12, 0.13, 0.09), band="trim", boot=0.8)

    # Quiver on the back with glowing arrows sticking out
    qa = Vector((0.12, fy + 0.2, top - 0.5))
    qb = Vector((-0.12, fy + 0.25, top + 0.05))
    c.limb(m, tuple(qa), tuple(qb), [(0, 0.15, 0.14), (1, 0.17, 0.16)], slot="extra_1", uv="wrap", bone="chest", segments=6)
    for k in range(4):
        base = qb + Vector((0.03 * (k - 1.5), 0.0, 0.0))
        tip = base + (qb - qa).normalized() * 0.3 + Vector((0.02 * (k - 1.5), 0.02, 0))
        c.limb(m, tuple(base), tuple(tip), [(0, 0.04, 0.015), (1, 0.06, 0.015)], slot="extra_2", sub=(0.0, 0.2, 0.7, 1.0), bone="chest", segments=4)

    # The bow in the left fist: two curved limbs, silver grip, glowing string
    g = Vector(c.grip_point(m, "L"))
    up = Vector((0, -0.05, 1)).normalized()
    out = Vector((0, -1, 0))
    def arc(sign):
        pts = []
        for k in range(6):
            t = k / 5
            a = t * 1.05
            pts.append(g + up * sign * math.sin(a) * 0.8 + out * (1 - math.cos(a)) * 0.35 * -1)
        return pts
    for sign in (1, -1):
        pts = arc(sign)
        m.part("loft", 1, profile=[(*p, w, w * 0.8) for p, w in zip(pts, (0.07, 0.075, 0.07, 0.06, 0.05, 0.03))], slot="weapon_a", uv="wrap", sub=(0.3, 0.75, 0.0, 1.0), tint=W, bone="hand.L", segments=5, smooth=c.FACET)
    top_tip, bot_tip = arc(1)[-1], arc(-1)[-1]
    c.limb(m, tuple(bot_tip), tuple(top_tip), [(0, 0.018, 0.018), (1, 0.018, 0.018)], slot="extra_4", bone="hand.L", segments=4, material="glow", light=False)
    c.blob(m, tuple(g), 0.06, "weapon_b", "hand.L", sub=(0.3, 0.7, 0.3, 0.7))

    m.socket("bow", tuple(g + Vector((0, 0.1, 0))), "hand.L")
    m.socket("arrow", tuple(c.grip_point(m, "R")), "hand.R")
    m.socket("quiver", tuple(qb), "chest")
    humanoid.animations(m, style="ranged")
    return m
