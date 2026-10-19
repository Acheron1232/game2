"""Light Healer — priestess of light. Big golden sun halo behind the head, white and gold robes,
pale blue cuffs and hem, team tabard and mantle, a book on the belt, a sun-disk mace held up,
the other hand open for spells.
Texture: light_healer_skin (standard 20-cell hero sheet)."""

import math

import chunky as c
import humanoid
from kit import Model
from mathutils import Vector

W = "#ffffff"


def build():
    m = Model("light_healer", skin="light_healer_skin")
    humanoid.skeleton(m, height=1.85, shoulders=0.22, hips=0.11, leg_len=1.0, arm_len=1.05, hunch=0.25, arm_spread=0.4, knee_bend=0.0, elbow_bend=0.8)
    j = m.joints
    hz = j["hips"][2]
    top, fy = j["neck"][2], j["neck"][1]

    c.torso(m, waist=(0.3, 0.22), belly=(0.33, 0.24), chest=(0.44, 0.3), shoulders=(0.5, 0.3), neck=(0.18, 0.15), hump=False)
    c.head(m, size=(0.21, 0.22, 0.25), jaw=0.82, ears=None)
    hx, hy, hzz = j["head"]
    # Long golden hair down the back
    m.part("loft", 1, profile=[(0, hy + 0.06, hzz + 0.2, 0.24, 0.14), (0, hy + 0.12, hzz - 0.05, 0.28, 0.12), (0, hy + 0.14, hzz - 0.4, 0.22, 0.08)], slot="extra_2", uv="front", back="head_back", tint=W, bone="head", segments=5, smooth=c.FACET)

    # Sun halo: a ring with rays, standing behind the head (gold metal)
    hc = Vector((0, hy + 0.2, hzz + 0.14))
    m.part("torus", (0.56, 0.56, 0.08), at=tuple(hc), rot=(90, 0, 0), slot="extra_1", sub=(0.1, 0.9, 0.05, 0.6), tint=W, bone="head", segments=12, rings=4, profile=0.15, smooth=c.FACET)
    for k in range(12):
        a = 2 * math.pi * k / 12
        d = Vector((math.cos(a), 0, math.sin(a)))
        ln = 0.18 if k % 2 == 0 else 0.11
        base, tip = hc + d * 0.28, hc + d * (0.28 + ln)
        m.part("loft", 1, profile=[(*base, 0.06, 0.03), (*tip, 0.004, 0.004)], slot="extra_1", sub=(0.3, 0.7, 0.6, 0.95), tint=W, bone="head", segments=4, smooth=c.FACET)

    # Arms: white sleeves, blue-gold cuffs, gloved hands (mace hand closed, other open)
    for side in ("L", "R"):
        s, e, w = j[f"upper_arm.{side}"], j[f"forearm.{side}"], j[f"hand.{side}"]
        c.blob(m, s, 0.11, "arm", f"upper_arm.{side}")
        c.limb(m, s, e, [(0.0, 0.16, 0.15), (0.6, 0.13, 0.12), (1.0, 0.12, 0.12)], slot="arm", uv="wrap", bone=f"upper_arm.{side}", segments=6)
        c.limb(m, e, w, [(0.0, 0.12, 0.12), (0.6, 0.16, 0.15), (1.0, 0.2, 0.19)], slot="arm", uv="wrap", bone=f"forearm.{side}", segments=6)
        c.limb(m, e, w, [(0.72, 0.21, 0.2), (1.0, 0.23, 0.22)], slot="forearm", uv="wrap", bone=f"forearm.{side}", segments=6)
    c.fist(m, "R", slot="hand", size=0.065)
    c.open_hand(m, "L", slot="hand", size=0.075)

    # Team mantle over the shoulders, team tabard front and back, golden belt, the book
    m.part("loft", 1, profile=[(0, fy, top - 0.12, 0.62, 0.42), (0, fy, top - 0.02, 0.56, 0.38), (0, fy, top + 0.06, 0.28, 0.24)], slot="shoulder", uv="wrap", tint=W, bone="chest", segments=8, smooth=c.FACET)
    c.belt(m, size=(0.36, 0.28), height=0.1)
    m.part("loft", 1, profile=[(0, -0.15, top - 0.12, 0.2, 0.03), (0, -0.2, hz - 0.1, 0.24, 0.03), (0, -0.24, 0.35, 0.22, 0.03)], slot="cloth", uv="front", tint=W, bone="hips", segments=4, smooth=c.FACET)
    m.part("hull", 1, profile=[(0.17, -0.1, hz - 0.18), (0.27, -0.1, hz - 0.18), (0.17, 0.08, hz - 0.18), (0.27, 0.08, hz - 0.18), (0.17, -0.1, hz + 0.02), (0.27, -0.1, hz + 0.02), (0.17, 0.08, hz + 0.02), (0.27, 0.08, hz + 0.02)],
           slot="extra_3", uv="front", tint=W, bone="hips", smooth=c.FACET)
    # Long robe skirt and its blue-gold hem
    m.part("loft", 1, profile=[(0, 0.0, hz + 0.02, 0.36, 0.28), (0, 0.01, hz - 0.35, 0.48, 0.4), (0, 0.02, 0.3, 0.6, 0.5)], slot="legs", uv="wrap", tint=W, bone="hips", segments=9, smooth=c.FACET)
    m.part("loft", 1, profile=[(0, 0.02, 0.32, 0.6, 0.5), (0, 0.03, 0.02, 0.7, 0.6)], slot="shin", uv="wrap", tint=W, bone="hips", segments=9, smooth=c.FACET)
    for side in ("L", "R"):
        x, y, z = j[f"foot.{side}"]
        m.part("hull", 1, profile=[(x - 0.05, y + 0.04, 0), (x + 0.05, y + 0.04, 0), (x - 0.04, y - 0.2, 0), (x + 0.04, y - 0.2, 0), (x - 0.04, y, 0.07), (x + 0.04, y, 0.07)], slot="foot", uv="top", tint=W, bone=f"foot.{side}", smooth=c.FACET)

    # The sun mace, held upright: white wrapped handle, gold head with a glowing sun disk
    g = Vector(c.grip_point(m, "R"))
    axis = Vector((0, -0.1, 1)).normalized()
    c.limb(m, tuple(g - axis * 0.25), tuple(g + axis * 0.6), [(0, 0.05, 0.05), (1, 0.05, 0.05)], slot="weapon_a", uv="wrap", sub=(0.3, 0.7, 0, 1), bone="weapon", segments=6)
    head_c = g + axis * 0.75
    m.part("torus", (0.3, 0.3, 0.06), at=tuple(head_c), rot=(90, 0, 0), slot="weapon_b", sub=(0.1, 0.9, 0.1, 0.9), tint=W, bone="weapon", segments=10, rings=4, profile=0.25, smooth=c.FACET)
    m.part("cylinder", (0.2, 0.05, 0.2), at=tuple(head_c), rot=(90, 0, 0), slot="extra_4", uv="front", back="extra_4", tint=W, bone="weapon", segments=10, material="glow", light=False)
    for k in range(8):
        a = 2 * math.pi * k / 8
        d = Vector((math.cos(a), 0, math.sin(a)))
        m.part("loft", 1, profile=[(*(head_c + d * 0.15), 0.05, 0.03), (*(head_c + d * 0.27), 0.004, 0.004)], slot="weapon_b", sub=(0.3, 0.7, 0.3, 0.7), tint=W, bone="weapon", segments=4, smooth=c.FACET)

    m.socket("halo", tuple(hc), "head")
    m.socket("mace", tuple(head_c), "weapon")
    m.socket("hand_l", c.grip_point(m, "L"), "hand.L")
    humanoid.animations(m, style="caster")
    return m
