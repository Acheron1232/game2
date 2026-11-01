"""Elder Colossus — the boss of the two boss camps (map corners). A basalt titan about 5.5 m
tall that walks on its fists like a great ape: a huge boulder chest split by a glowing lava
fissure, a small horned head sunk low between the shoulders, a ridge of black obsidian spikes
down the back, red crystal clusters on the shoulders, arms as long as its body with slab fists,
short column legs. Built at Stone Golem scale, then scaled up.
Own 8-cell skin, painted by Codex over the model's UV guide (model-first textures):
face = head front, body = basalt chest and back boulders, arm = arm boulders and forearms,
legs = thighs and shins, foot_hand = foot (left half) and fist (right half), team = crystal
clusters (neutral: plain red), weapon_a = black obsidian (horns, spikes, brow, knuckles),
weapon_b = molten lava (the glowing fissure and veins)."""

import math
import random

import chunky as c
import humanoid
import unitkit as u
from kit import Model
from mathutils import Vector
from stone_golem import rock

W = "#ffffff"
SIZE = 2.35


S = u.Slots("elder_colossus")


def glow(m, points, widths, bone, tint=W):
    """A glowing crack or core: unlit, so it shines in the shade and in the fog's half light."""
    m.part("loft", 1, profile=[(*p, w, w * 0.55) for p, w in zip(points, widths)], slot=S.weapon_b, uv="wrap", tint=tint, bone=bone, segments=5, smooth=30)
    m._material(m.parts[-1][0], "glow")
    m.parts[-1][0].data.materials.pop(index=0)


def spike(m, base, tip, width, bone, slot=S.weapon_a):
    m.part("loft", 1, profile=[(*base, width, width), (*c.lerp(base, tip, 0.6), width * 0.75, width * 0.75), (*tip, 0.005, 0.005)], slot=slot, uv="wrap", tint=W, bone=bone, segments=5, smooth=12)


def build():
    m = Model("elder_colossus", skin="elder_colossus_skin")
    # Knuckle walker: long arms, short legs, a deep forward hunch.
    humanoid.skeleton(m, height=2.3, shoulders=0.56, hips=0.22, leg_len=0.6, arm_len=1.75, hunch=1.5, arm_spread=0.5, knee_bend=0.6, elbow_bend=0.15)
    j = m.joints
    hz = j["hips"][2]
    top, fy = j["neck"][2], j["neck"][1]
    cy, cz = fy * 0.7, (hz + top) / 2 + 0.12

    # ---- body: a belly stone, a huge chest boulder, a stone collar over the neck
    rock(m, (0, -0.02, hz + 0.16), (0.46, 0.38, 0.32), S.body, "spine", 101)
    rock(m, (0, cy + 0.05, cz), (0.82, 0.62, 0.6), S.body, "chest", 102)
    rock(m, (0, cy + 0.12, top + 0.02), (0.6, 0.42, 0.3), S.body, "chest", 103)
    # Rune plate on the front, split down the middle by the lava fissure
    fy0 = cy - 0.5
    for sx in (1, -1):
        c.frame_hull(m, (sx * 0.2, fy0, cz), (Vector((1, 0, 0)), Vector((0, -1, 0)), Vector((0, 0, 1))),
                     [(-0.2, 0.0, -0.32), (0.18, 0.0, -0.3), (-0.22, 0.0, 0.34), (0.2, 0.0, 0.36), (-0.18, -0.12, -0.26), (0.15, -0.1, -0.24), (-0.19, -0.12, 0.3), (0.16, -0.1, 0.32)],
                     slot=S.body, uv="front", bone="chest", smooth=20)
    glow(m, [(0, fy0 - 0.06, cz - 0.42), (0, fy0 - 0.1, cz - 0.1), (0, fy0 - 0.11, cz + 0.12), (0, fy0 - 0.08, cz + 0.4)], (0.04, 0.12, 0.13, 0.05), "chest")
    glow(m, [(0, fy0 - 0.12, cz), (0, fy0 - 0.16, cz + 0.02)], (0.22, 0.03), "chest", tint="#fff0c0")
    # Veins from the fissure over the chest plates
    for sx in (1, -1):
        for a, b in (((0.08, 0.2), (0.34, 0.36)), ((0.08, -0.15), (0.32, -0.32))):
            p0 = Vector((sx * a[0], fy0 - 0.11, cz + a[1]))
            p1 = Vector((sx * b[0], fy0 - 0.13, cz + b[1]))
            glow(m, [p0, c.lerp(p0, p1, 0.5), p1], (0.035, 0.05, 0.02), "chest")

    # ---- head: small and low, pushed forward between the shoulders, two long horns
    hx, hy, hzz = j["head"]
    hc = Vector((0, cy - 0.46, hzz - 0.06))
    c.frame_hull(m, hc, (Vector((1, 0, 0)), Vector((0, -1, 0)), Vector((0, 0, 1))),
                 [(-0.2, -0.16, -0.16), (0.2, -0.16, -0.16), (-0.23, -0.14, 0.14), (0.23, -0.14, 0.14), (-0.18, 0.2, -0.14), (0.18, 0.2, -0.14), (-0.2, 0.22, 0.12), (0.2, 0.22, 0.12), (0, 0.27, 0.0), (0, -0.04, 0.24)],
                 slot=S.face, uv="front", back=S.body, bone="head", smooth=20)
    # Heavy brow and a glowing visor slit for eyes
    c.frame_hull(m, hc, (Vector((1, 0, 0)), Vector((0, -1, 0)), Vector((0, 0, 1))),
                 [(-0.27, 0.12, 0.05), (0.27, 0.12, 0.05), (-0.27, 0.3, 0.07), (0.27, 0.3, 0.07), (-0.24, 0.12, 0.18), (0.24, 0.12, 0.18), (-0.22, 0.28, 0.16), (0.22, 0.28, 0.16)],
                 slot=S.weapon_a, bone="head", smooth=20)
    glow(m, [hc + Vector((-0.17, -0.31, 0.03)), hc + Vector((0, -0.33, 0.02)), hc + Vector((0.17, -0.31, 0.03))], (0.05, 0.06, 0.05), "head", tint="#fff0c0")
    for sx in (1, -1):
        base = hc + Vector((sx * 0.2, -0.02, 0.14))
        pts = [base, base + Vector((sx * 0.22, -0.02, 0.18)), base + Vector((sx * 0.34, -0.14, 0.4)), base + Vector((sx * 0.3, -0.34, 0.56))]
        m.part("loft", 1, profile=[(*p, w, w) for p, w in zip(pts, (0.16, 0.13, 0.09, 0.01))], slot=S.weapon_a, uv="wrap", tint=W, bone="head", segments=6, smooth=30)

    # ---- shoulders: huge boulders, obsidian spikes, red crystal clusters
    for side, sx in (("L", 1), ("R", -1)):
        s = Vector(j[f"upper_arm.{side}"])
        rock(m, tuple(s + Vector((sx * 0.08, 0.02, 0.1))), (0.42, 0.4, 0.38), S.arm, f"upper_arm.{side}", 110 + sx)
        rnd = random.Random(120 + sx)
        for k in range(5):
            base = s + Vector((sx * (0.05 + rnd.random() * 0.25), (rnd.random() - 0.5) * 0.35, 0.34))
            tip = base + Vector((sx * rnd.uniform(0.08, 0.25), rnd.uniform(-0.1, 0.12), rnd.uniform(0.3, 0.6)))
            spike(m, base, tip, rnd.uniform(0.1, 0.15), f"upper_arm.{side}", slot=S.team)
        spike(m, s + Vector((sx * 0.3, 0.12, 0.2)), s + Vector((sx * 0.62, 0.3, 0.42)), 0.16, f"upper_arm.{side}")

        # Long arms of stacked boulders, a thick forearm and a slab fist that rests on the ground
        e, w_ = Vector(j[f"forearm.{side}"]), Vector(j[f"hand.{side}"])
        for k, tt in enumerate((0.3, 0.65, 0.95)):
            rock(m, c.lerp(s, e, tt), (0.26, 0.25, 0.27), S.arm, f"upper_arm.{side}", 130 + k * 3 + sx)
        c.limb(m, tuple(e), tuple(w_), [(0.0, 0.4, 0.38), (0.55, 0.46, 0.42), (1.0, 0.36, 0.34)], slot=S.arm, uv="wrap", bone=f"forearm.{side}", segments=7, smooth=30)
        glow(m, [e + Vector((0, -0.22, -0.05)), Vector(c.lerp(e, w_, 0.5)) + Vector((0, -0.25, 0)), w_ + Vector((0, -0.2, 0.08))], (0.03, 0.05, 0.02), f"forearm.{side}")
        g = Vector(c.grip_point(m, side))
        rock(m, tuple(g + Vector((0, -0.02, -0.08))), (0.36, 0.36, 0.3), S.foot_hand, f"hand.{side}", 150 + sx, sub=u.HAND, uv="front")
        # Knuckle slabs
        for k in range(3):
            rock(m, tuple(g + Vector((sx * (k - 1) * 0.15, -0.28, -0.2))), (0.11, 0.1, 0.1), S.weapon_a, f"hand.{side}", 160 + k + sx)

    # ---- back: a ridge of obsidian spikes down the spine
    for k, (yb, zb, h) in enumerate(((0.28, 0.32, 0.55), (0.42, 0.12, 0.62), (0.5, -0.1, 0.5), (0.48, -0.3, 0.38))):
        base = Vector((0, cy + yb, cz + zb))
        spike(m, base, base + Vector((0, 0.32, h)), 0.2 - k * 0.02, "chest" if k < 3 else "spine")
        for sx in (1, -1):
            b2 = base + Vector((sx * 0.25, -0.05, -0.05))
            spike(m, b2, b2 + Vector((sx * 0.15, 0.25, h * 0.6)), 0.12, "chest" if k < 3 else "spine")

    # ---- legs: short stone columns with flat feet
    for side in ("L", "R"):
        tl, k, f = Vector(j[f"thigh.{side}"]), Vector(j[f"shin.{side}"]), Vector(j[f"foot.{side}"])
        rock(m, c.lerp(tl, k, 0.45), (0.32, 0.3, 0.3), S.legs, f"thigh.{side}", 170 + len(side))
        c.limb(m, tuple(k), tuple(f), [(0, 0.36, 0.36), (1, 0.32, 0.32)], slot=S.legs, uv="wrap", bone=f"shin.{side}", segments=7, smooth=30)
        x, y, _ = f
        m.part("hull", 1, profile=[(x - 0.2, y + 0.14, 0), (x + 0.2, y + 0.14, 0), (x - 0.22, y - 0.32, 0), (x + 0.22, y - 0.32, 0), (x - 0.16, y + 0.1, 0.18), (x + 0.16, y + 0.1, 0.18), (x - 0.17, y - 0.26, 0.12), (x + 0.17, y - 0.26, 0.12)],
               slot=S.foot_hand, sub=u.FOOT, uv="top", tint=W, bone=f"foot.{side}", smooth=22)

    m.socket("core", (0, fy0 - 0.16, cz), "chest")
    m.socket("eyes", tuple(hc + Vector((0, -0.33, 0.03))), "head")
    m.socket("feet", (0, 0, 0.05), "root")
    humanoid.animations(m, style="melee", weight=1.6)
    m.scale_all(SIZE)
    return m
