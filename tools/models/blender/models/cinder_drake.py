"""Cinder Drake — the two guards of the Elder Colossus: a magma salamander-drake as long as a
cart, low and wide on four splayed legs, a heavy crocodile head with swept-back horns and a
glowing mouth, a row of spines down the back and the tail, lava glowing through cracks in its
black scales. It walks the ground and spits fire.
Own 8-cell skin, painted by Codex over the model's UV guide (model-first textures):
face = head (snout and jaws seen from the front), body = black scaled back and flanks (the left
and right edges of the cell are the pale belly underneath), arm = legs, legs = tail,
foot_hand = hind claws (left half) and front claws (right half), team = back spines (neutral:
plain red), weapon_a = horns and teeth (dark bone), weapon_b = lava and fire (cracks, mouth, eyes)."""

import chunky as c
import rigs
import unitkit as u
from kit import Model
from mathutils import Vector

W = "#ffffff"
UP = Vector((0, 0, 1))
S = u.Slots("cinder_drake")


def glow(m, points, widths, bone):
    m.part("loft", 1, profile=[(*p, w, w * 0.6) for p, w in zip(points, widths)], slot=S.weapon_b, uv="wrap", tint=W, bone=bone, segments=5, smooth=30)
    m._material(m.parts[-1][0], "glow")
    m.parts[-1][0].data.materials.pop(index=0)


def spine(m, base, height, lean, width, bone):
    tip = base + Vector((0, lean, height))
    m.part("loft", 1, profile=[(*base, width, width * 0.45), (*c.lerp(base, tip, 0.55), width * 0.7, width * 0.3), (*tip, 0.005, 0.005)], slot=S.team, uv="side", tint=W, bone=bone, segments=4, smooth=12)


def build():
    m = Model("cinder_drake", skin="cinder_drake_skin")
    rigs.quadruped(m, length=2.0, height=0.78, neck=0.55, tail=1.6, leg_spread=0.5)
    j, t = m.joints, m.tails
    z = j["body"][2]

    # ---- body: low and wide (wider than tall), deep chest, narrow loins
    rear = [(1.12, 0.0, 0.3, 0.26), (0.95, 0.0, 0.7, 0.5), (0.55, 0.02, 0.86, 0.6), (0.15, 0.03, 0.9, 0.62), (-0.05, 0.03, 0.92, 0.64)]
    front = [(0.05, 0.03, 0.92, 0.64), (-0.4, 0.05, 1.02, 0.72), (-0.82, 0.08, 0.96, 0.7), (-1.05, 0.1, 0.7, 0.56), (-1.16, 0.12, 0.34, 0.3)]
    for prof, bone in ((rear, "body"), (front, "chest")):
        m.part("loft", 1, profile=[(0, y, z + dz, w, d) for y, dz, w, d in prof], slot=S.body, uv="tube", tint=W, bone=bone, segments=10, smooth=60)
    # Lava cracks along both flanks
    for sx in (1, -1):
        glow(m, [Vector((sx * 0.43, 0.6, z + 0.02)), Vector((sx * 0.47, 0.1, z + 0.06)), Vector((sx * 0.45, -0.35, z + 0.08))], (0.03, 0.06, 0.03), "body")
        glow(m, [Vector((sx * 0.48, -0.15, z + 0.1)), Vector((sx * 0.5, -0.55, z + 0.12)), Vector((sx * 0.42, -0.9, z + 0.14))], (0.03, 0.05, 0.02), "chest")

    # ---- spines down the back
    for k, (y, h, bone) in enumerate(((-0.85, 0.32, "chest"), (-0.55, 0.42, "chest"), (-0.2, 0.46, "chest"), (0.15, 0.4, "body"), (0.48, 0.34, "body"), (0.8, 0.26, "body"))):
        spine(m, Vector((0, y, z + 0.3 + 0.02 * (k < 3))), h, 0.18, 0.2, bone)

    # ---- neck and head: a heavy flat crocodile head with horns and a glowing mouth
    n0, n1 = Vector(j["neck"]), Vector(t["neck"])
    c.limb(m, tuple(n0 + (n0 - n1) * 0.2), tuple(n1), [(0, 0.66, 0.56), (1, 0.44, 0.4)], slot=S.body, uv="tube", bone="neck", segments=8, smooth=55)
    h0 = Vector(j["head"])
    fwd = Vector((0, -1, 0))
    skull = [(-0.12, 0.04, 0.42, 0.36), (0.05, 0.05, 0.5, 0.36), (0.25, 0.02, 0.42, 0.28), (0.48, -0.02, 0.34, 0.2), (0.66, -0.03, 0.26, 0.15), (0.74, -0.04, 0.12, 0.08)]
    prof = [tuple(h0 + fwd * a + UP * dz) + (w, d) for a, dz, w, d in skull]
    hz = h0.z
    m.part("loft", 1, profile=prof, slot=S.face, uv="front", back=S.body, frame=(-0.26, 0.26, hz - 0.24, hz + 0.26), tint=W, bone="head", segments=10, smooth=55)
    # Lower jaw, a little open, and the fire in the mouth
    jaw = [(0.0, -0.17, 0.4, 0.14), (0.3, -0.21, 0.32, 0.11), (0.6, -0.2, 0.2, 0.08), (0.7, -0.19, 0.08, 0.05)]
    m.part("loft", 1, profile=[tuple(h0 + fwd * a + UP * dz) + (w, d) for a, dz, w, d in jaw], slot=S.face, uv="front", back=S.body, frame=(-0.26, 0.26, hz - 0.24, hz + 0.26), tint=W, bone="head", segments=8, smooth=45)
    glow(m, [h0 + fwd * 0.1 + UP * -0.1, h0 + fwd * 0.4 + UP * -0.12, h0 + fwd * 0.62 + UP * -0.12], (0.24, 0.2, 0.08), "head")
    # Teeth along both jaws
    for sx in (1, -1):
        for k in range(4):
            a = 0.22 + k * 0.13
            b = h0 + fwd * a + Vector((sx * (0.16 - k * 0.025), 0, -0.07))
            m.part("loft", 1, profile=[(*b, 0.045, 0.045), (*(b + UP * -0.09), 0.005, 0.005)], slot=S.weapon_a, uv="wrap", tint=W, bone="head", segments=4, smooth=10)
    # Swept-back horns and glowing eyes
    for sx in (1, -1):
        base = h0 + Vector((sx * 0.17, 0.02, 0.18))
        pts = [base, base + Vector((sx * 0.1, 0.2, 0.12)), base + Vector((sx * 0.16, 0.45, 0.16)), base + Vector((sx * 0.14, 0.66, 0.08))]
        m.part("loft", 1, profile=[(*p, w, w) for p, w in zip(pts, (0.13, 0.1, 0.06, 0.01))], slot=S.weapon_a, uv="wrap", tint=W, bone="head", segments=6, smooth=30)
        e = h0 + Vector((sx * 0.17, -0.2, 0.13))
        glow(m, [e, e + Vector((sx * 0.02, -0.06, 0))], (0.07, 0.04), "head")

    # ---- legs: thick, splayed, with big claws
    for sd in ("L", "R"):
        sx = 1 if sd == "L" else -1
        for part in ("front", "back"):
            u0, u1, l1 = Vector(j[f"{part}_upper.{sd}"]), Vector(t[f"{part}_upper.{sd}"]), Vector(t[f"{part}_lower.{sd}"])
            out = Vector((sx * 0.22, 0, 0))
            c.limb(m, tuple(u0 + Vector((0, 0, 0.08))), tuple(u1 + out), [(0, 0.42, 0.44), (0.6, 0.3, 0.3), (1, 0.24, 0.24)], slot=S.arm, uv="wrap", bone=f"{part}_upper.{sd}", segments=7, smooth=50)
            c.limb(m, tuple(u1 + out), tuple(l1 + out * 0.6), [(0, 0.24, 0.24), (1, 0.19, 0.19)], slot=S.arm, uv="wrap", bone=f"{part}_lower.{sd}", segments=6, smooth=50)
            foot = l1 + out * 0.6
            c.blob(m, tuple(foot + Vector((0, -0.08, -0.02))), 0.15, S.foot_hand, f"{part}_lower.{sd}", sub=u.HAND if part == "front" else u.FOOT, squash=(1.3, 1.5, 0.55), uv="top")
            for k in (-1, 0, 1):
                cl = foot + Vector((k * 0.09, -0.24, -0.04))
                m.part("loft", 1, profile=[(*(cl + Vector((0, 0.08, 0.04))), 0.06, 0.05), (*cl, 0.005, 0.005)], slot=S.weapon_a, uv="wrap", tint=W, bone=f"{part}_lower.{sd}", segments=4, smooth=10)

    # ---- tail: long, thick at the root, with spines and a glowing tip crack
    t0, t1 = Vector(j["tail"]), Vector(t["tail"])
    mid = c.lerp(t0, t1, 0.5)
    tail = [t0 + Vector((0, -0.1, 0.02)), Vector(mid) + Vector((0, 0, 0.08)), t1 + Vector((0, 0.1, 0.02)), t1 + Vector((0, 0.55, -0.12))]
    m.part("loft", 1, profile=[(*p, w, w * 0.8) for p, w in zip(tail, (0.5, 0.36, 0.2, 0.04))], slot=S.legs, uv="wrap", tint=W, bone="tail", segments=8, smooth=50)
    for k, a in enumerate((0.2, 0.5, 0.8)):
        b = Vector(c.lerp(t0, t1, a)) + Vector((0, 0, 0.2 - a * 0.12))
        spine(m, b, 0.26 - k * 0.06, 0.15, 0.15, "tail")

    m.socket("mouth", tuple(h0 + fwd * 0.7 + UP * -0.1), "head")
    m.socket("feet", (0, 0, 0.05), "root")
    rigs.quadruped_animations(m, weight=1.3)
    return m
