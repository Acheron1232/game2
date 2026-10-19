"""Stone Golem — huge rock tank. Boulders held by moss and blue runes, a small head sunk between
massive shoulders, very long arms with boulder fists dragging low, short thick legs,
team-color crystals growing from the shoulders and back, glowing core in the chest.
Skin cells: face=stone face, head_back, chest=rune chest, back=mossy back, arm=boulder arm,
forearm=rune forearm, hand=stone fist, legs=mossy leg, shin=vine shin, foot=stone foot,
belt=moss band, cloth=team crystal surface, shoulder=team crystal cluster, trim=team rune band,
weapon_a=dark rune stone, weapon_b=pale stone, extra_1=rune symbols, extra_2=moss,
extra_3=pebbles, extra_4=blue core."""

import math
import random

import chunky as c
import humanoid
from kit import Model
from mathutils import Vector

W = "#ffffff"


def rock(m, center, size, slot, bone, seed, sub=None, uv="box", material="palette"):
    """A rough boulder: a hull of jittered points on a squashed ball."""
    rnd = random.Random(seed)
    cx, cy, cz = center
    sx, sy, sz = size
    pts = []
    for k in range(14):
        z = -1 + 2 * (k + 0.5) / 14
        r = math.sqrt(max(0, 1 - z * z))
        a = k * 2.399 + rnd.random() * 0.4
        j = 0.85 + rnd.random() * 0.3
        pts.append((cx + math.cos(a) * r * sx * j, cy + math.sin(a) * r * sy * j, cz + z * sz * j))
    m.part("hull", 1, profile=pts, slot=slot, sub=sub, uv=uv, tint=W, bone=bone, smooth=22, material=material)


def build():
    m = Model("stone_golem", skin="stone_golem_skin")
    humanoid.skeleton(m, height=2.2, shoulders=0.46, hips=0.2, leg_len=0.62, arm_len=1.45, hunch=1.0, arm_spread=0.7, knee_bend=0.5, elbow_bend=0.35)
    j, t = m.joints, m.tails
    hz = j["hips"][2]
    top, fy = j["neck"][2], j["neck"][1]

    # Body: a huge chest boulder over a smaller belly stone
    rock(m, (0, -0.02, hz + 0.18), (0.42, 0.34, 0.3), "weapon_b", "spine", 1)
    rock(m, (0, fy * 0.7, (hz + top) / 2 + 0.12), (0.72, 0.5, 0.52), "back", "chest", 2, uv="front")
    # Rune chest plate in front, with the glowing core
    cz = (hz + top) / 2 + 0.1
    m.part("hull", 1, profile=[(-0.38, fy * 0.7 - 0.42, cz - 0.3), (0.38, fy * 0.7 - 0.42, cz - 0.3), (-0.42, fy * 0.7 - 0.45, cz + 0.32), (0.42, fy * 0.7 - 0.45, cz + 0.32), (-0.3, fy * 0.7 - 0.25, cz - 0.38), (0.3, fy * 0.7 - 0.25, cz - 0.38), (-0.35, fy * 0.7 - 0.25, cz + 0.42), (0.35, fy * 0.7 - 0.25, cz + 0.42)],
           slot="chest", uv="front", tint=W, bone="chest", smooth=22)
    c.blob(m, (0, fy * 0.7 - 0.47, cz + 0.02), 0.11, "extra_4", "chest", uv="front")
    m._material(m.parts[-1][0], "glow")
    m.parts[-1][0].data.materials.pop(index=0)

    # Head: a carved stone block pushed forward out of the chest, heavy brow, jaw, glowing eyes,
    # a team crystal horn on top. Sits in front of the shoulder line so it reads from the RTS camera.
    hx, hy, hzz = j["head"]
    hc = Vector((0, fy * 0.7 - 0.38, hzz - 0.02))
    c.frame_hull(m, hc, (Vector((1, 0, 0)), Vector((0, -1, 0)), Vector((0, 0, 1))),
                 [(-0.2, -0.16, -0.16), (0.2, -0.16, -0.16), (-0.22, -0.16, 0.16), (0.22, -0.16, 0.16), (-0.17, 0.18, -0.14), (0.17, 0.18, -0.14), (-0.19, 0.2, 0.12), (0.19, 0.2, 0.12), (0, 0.24, 0.0), (0, -0.05, 0.24)],
                 slot="face", uv="front", back="head_back", bone="head", smooth=22)
    # Heavy brow ridge
    c.frame_hull(m, hc, (Vector((1, 0, 0)), Vector((0, -1, 0)), Vector((0, 0, 1))),
                 [(-0.25, 0.1, 0.06), (0.25, 0.1, 0.06), (-0.25, 0.26, 0.08), (0.25, 0.26, 0.08), (-0.22, 0.1, 0.17), (0.22, 0.1, 0.17), (-0.2, 0.24, 0.15), (0.2, 0.24, 0.15)],
                 slot="weapon_b", bone="head", smooth=22)
    # Jaw block
    c.frame_hull(m, hc, (Vector((1, 0, 0)), Vector((0, -1, 0)), Vector((0, 0, 1))),
                 [(-0.22, -0.1, -0.12), (0.22, -0.1, -0.12), (-0.24, 0.24, -0.1), (0.24, 0.24, -0.1), (-0.2, -0.05, -0.28), (0.2, -0.05, -0.28), (-0.2, 0.2, -0.27), (0.2, 0.2, -0.27)],
                 slot="weapon_b", sub=(0.0, 1.0, 0.0, 0.6), bone="head", smooth=22)
    for sx in (1, -1):
        c.blob(m, (sx * 0.09, hc.y - 0.215, hc.z + 0.04), 0.045, "extra_4", "head", squash=(1.2, 0.6, 0.7))
        m._material(m.parts[-1][0], "glow")
        m.parts[-1][0].data.materials.pop(index=0)
    base = hc + Vector((0.06, 0.02, 0.2))
    m.part("loft", 1, profile=[(*base, 0.12, 0.12), (*(base + Vector((0.04, 0.05, 0.22))), 0.1, 0.1), (*(base + Vector((0.07, 0.1, 0.4))), 0.005, 0.005)], slot="shoulder", uv="wrap", tint=W, bone="head", segments=4, smooth=10)

    # Shoulders: two big boulders with team crystals growing out of them
    for side, sx in (("L", 1), ("R", -1)):
        s = Vector(j[f"upper_arm.{side}"])
        rock(m, tuple(s + Vector((sx * 0.05, 0, 0.08))), (0.36, 0.34, 0.32), "arm", f"upper_arm.{side}", 10 + sx)
        rnd = random.Random(20 + sx)
        for k in range(4):
            base = s + Vector((sx * (0.05 + rnd.random() * 0.2), (rnd.random() - 0.5) * 0.3, 0.3))
            tip = base + Vector((sx * rnd.uniform(0.05, 0.2), rnd.uniform(-0.1, 0.1), rnd.uniform(0.25, 0.5)))
            w = rnd.uniform(0.09, 0.14)
            m.part("loft", 1, profile=[(*base, w, w), (*c.lerp(base, tip, 0.7), w * 0.9, w * 0.9), (*tip, 0.005, 0.005)], slot="shoulder", uv="wrap", tint=W, bone=f"upper_arm.{side}", segments=4, smooth=10)
        # Long arms made of stacked rocks, rune band on the forearm, a huge fist
        e, w_ = Vector(j[f"forearm.{side}"]), Vector(j[f"hand.{side}"])
        for k, tt in enumerate((0.35, 0.75)):
            rock(m, c.lerp(s, e, tt), (0.22, 0.21, 0.24), "arm", f"upper_arm.{side}", 30 + k * 2 + sx)
        rock(m, tuple(e), (0.2, 0.2, 0.2), "weapon_b", f"forearm.{side}", 40 + sx)
        c.limb(m, tuple(e), tuple(w_), [(0.15, 0.36, 0.34), (0.6, 0.4, 0.38), (1.0, 0.3, 0.3)], slot="forearm", uv="wrap", bone=f"forearm.{side}", segments=6)
        rock(m, tuple(Vector(c.grip_point(m, side)) + Vector((0, 0, -0.05))), (0.3, 0.28, 0.27), "hand", f"hand.{side}", 50 + sx, uv="front")

    # Back crystals and moss
    for k, (x, z) in enumerate(((-0.25, 0.25), (0.05, 0.42), (0.3, 0.2))):
        base = Vector((x, fy * 0.7 + 0.35, cz + z))
        tip = base + Vector((x * 0.4, 0.3, 0.35))
        m.part("loft", 1, profile=[(*base, 0.14, 0.14), (*c.lerp(base, tip, 0.65), 0.12, 0.12), (*tip, 0.005, 0.005)], slot="cloth", uv="wrap", tint=W, bone="chest", segments=4, smooth=10)

    # Short thick legs: rock thighs, vine shins, flat stone feet
    for side in ("L", "R"):
        tl, k, f = Vector(j[f"thigh.{side}"]), Vector(j[f"shin.{side}"]), Vector(j[f"foot.{side}"])
        rock(m, c.lerp(tl, k, 0.45), (0.27, 0.26, 0.26), "legs", f"thigh.{side}", 60 + len(side))
        c.limb(m, tuple(k), tuple(f), [(0, 0.3, 0.3), (1, 0.27, 0.27)], slot="shin", uv="wrap", bone=f"shin.{side}", segments=6)
        x, y, _ = f
        m.part("hull", 1, profile=[(x - 0.17, y + 0.12, 0), (x + 0.17, y + 0.12, 0), (x - 0.19, y - 0.3, 0), (x + 0.19, y - 0.3, 0), (x - 0.14, y + 0.08, 0.16), (x + 0.14, y + 0.08, 0.16), (x - 0.15, y - 0.24, 0.1), (x + 0.15, y - 0.24, 0.1)],
               slot="foot", uv="top", tint=W, bone=f"foot.{side}", smooth=22)
    # Moss band around the waist
    c.limb(m, (0, -0.02, hz + 0.02), (0, -0.02, hz + 0.16), [(0, 0.66, 0.5), (1, 0.7, 0.52)], slot="belt", uv="wrap", bone="hips", segments=7)

    m.socket("core", (0, fy * 0.7 - 0.5, cz), "chest")
    for side, sx in (("L", 1), ("R", -1)):
        sp = j[f"upper_arm.{side}"]
        m.socket(f"crystals_{side.lower()}", (sp[0] + sx * 0.12, sp[1], sp[2] + 0.5), f"upper_arm.{side}")
    m.socket("feet", (0, 0, 0.05), "root")
    m.socket("eyes", tuple(hc + Vector((0, -0.24, 0.04))), "head")
    humanoid.animations(m, style="melee", weight=1.35)
    return m
