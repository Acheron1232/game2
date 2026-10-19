"""Staff Warrior — huge hunched monk fighter in the classic RTS hero look.
Bent arms, the staff held through the right fist, boulder fists, bronze gong on the back,
prayer beads, spiked team shoulder pad, team bands on wrists and knees.
Texture: staff_warrior_skin (standard 20-cell hero sheet)."""

import chunky as c
import humanoid
from kit import Model
from mathutils import Vector


def build():
    m = Model("staff_warrior", skin="staff_warrior_skin")
    humanoid.skeleton(m, height=1.85, shoulders=0.34, hips=0.14, leg_len=0.85, arm_len=1.1, hunch=1.0, arm_spread=0.55, knee_bend=0.4, elbow_bend=0.7)
    j = m.joints

    c.torso(m, waist=(0.42, 0.31), belly=(0.54, 0.37), chest=(0.82, 0.46), shoulders=(0.98, 0.45))
    c.head(m, size=(0.25, 0.25, 0.27))
    hx, hy, hz = j["head"]
    # Topknot: hair cone bound with a bronze ring
    m.part("loft", 1, profile=[(0, hy + 0.05, hz + 0.21, 0.11, 0.11), (0, hy + 0.07, hz + 0.29, 0.13, 0.13), (0, hy + 0.1, hz + 0.37, 0.07, 0.07), (0, hy + 0.15, hz + 0.45, 0.01, 0.01)],
           slot="extra_3", uv="wrap", sub=(0.2, 0.8, 0.0, 0.45), tint=c.W, bone="head", segments=5, smooth=c.FACET)
    m.part("loft", 1, profile=[(0, hy + 0.06, hz + 0.27, 0.12, 0.12), (0, hy + 0.065, hz + 0.31, 0.12, 0.12)], slot="extra_3", uv="wrap", sub=(0.3, 0.7, 0.45, 0.62), tint=c.W, bone="head", segments=6)

    for side in ("L", "R"):
        c.arm(m, side, upper=(0.36, 0.31, 0.23, 0.17), forearm=(0.18, 0.26, 0.22, 0.15))
        c.leg(m, side, thigh=(0.28, 0.3, 0.19), shin=(0.17, 0.18, 0.12))
    c.shoulder_pad(m, "L", size=1.05, spikes=2, spike_slot="weapon_b")
    c.belt(m)
    c.loincloth(m)
    c.beads(m, slot="extra_2", sub=(0.2, 0.8, 0.2, 0.8), tint="#ffffff")
    # Bronze gong on the back
    m.part("cylinder", (0.5, 0.5, 0.06), at=(0, 0.22, j["hips"][2] + 0.5), rot=(78, 0, 0), slot="extra_1", uv="front", back="extra_1", tint=c.W, bone="chest", segments=8, smooth=c.FACET)

    # ---- The staff goes through the right fist, tilted a little forward and out
    g = Vector(c.grip_point(m, "R"))
    axis = Vector((-0.08, -0.16, 1)).normalized()
    c.fist(m, "R", grip_axis=tuple(axis))
    c.fist(m, "L")
    bottom, top = g - axis * 0.95, g + axis * 1.25
    c.limb(m, tuple(bottom), tuple(top), [(0, 0.08, 0.08), (0.45, 0.095, 0.095), (1, 0.085, 0.085)], slot="weapon_a", uv="wrap", sub=(0.3, 0.7, 0, 1), bone="weapon", segments=6)
    for t0, t1 in ((-0.02, 0.1), (0.9, 1.0)):
        c.limb(m, tuple(bottom), tuple(top), [(t0, 0.13, 0.13), (t1, 0.13, 0.13)], slot="weapon_b", uv="wrap", bone="weapon", segments=6)
    ring = top + axis * 0.18
    m.part("torus", (0.36, 0.36, 0.08), at=tuple(ring), rot=(90, 0, -8), slot="extra_4", sub=(0.15, 0.85, 0.5, 0.9), tint=c.W, bone="weapon", segments=8, rings=4, profile=0.22, smooth=c.FACET)
    for dx in (-0.1, 0.1):
        c.blob(m, tuple(ring + Vector((dx, 0, -0.16))), 0.045, "extra_4", "weapon", sub=(0.3, 0.7, 0.05, 0.35))
    for dx in (0.07, -0.06):
        base = top - axis * 0.05 + Vector((dx, 0, 0))
        m.part("loft", 1, profile=[(*base, 0.08, 0.012), (base.x + dx * 0.8, base.y + 0.03, base.z - 0.3, 0.09, 0.012), (base.x + dx * 1.6, base.y + 0.06, base.z - 0.6, 0.06, 0.012)],
               slot="trim", uv="front", tint=c.W, bone="weapon", segments=4, smooth=c.FACET)

    # ---- Effect sockets
    m.socket("ring", tuple(ring), "weapon")
    m.socket("aura", (0, j["chest"][1], j["chest"][2]), "chest")
    m.socket("fist_l", c.grip_point(m, "L"), "hand.L")

    humanoid.animations(m, style="melee")
    return m
