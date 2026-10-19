"""Hawk Rider — rider with a war hammer on a giant flying hawk."""

import math

import chunky as c
import unitkit as u
from kit import Model
from mathutils import Vector

W = "#ffffff"
UP = Vector((0, 0, 1))


def rig(m):
    z = 1.7
    b = {
        "root": ((0, 0, 0), (0, 0, 0.2), None),
        "body": ((0, 0.5, z), (0, -0.3, z + 0.1), "root"),
        "neck": ((0, -0.3, z + 0.1), (0, -0.55, z + 0.4), "body"),
        "head": ((0, -0.55, z + 0.4), (0, -0.85, z + 0.35), "neck"),
        "tail": ((0, 0.5, z), (0, 1.0, z - 0.05), "body"),
        "spine": ((0, 0.0, z + 0.25), (0, -0.02, z + 0.5), "body"),
        "chest": ((0, -0.02, z + 0.5), (0, -0.04, z + 0.75), "spine"),
        "hips": ((0, 0.0, z + 0.25), (0, 0.0, z + 0.3), "body"),
    }
    for s, x in (("L", 1), ("R", -1)):
        b[f"wing1.{s}"] = ((x * 0.25, -0.1, z + 0.2), (x * 1.0, 0.0, z + 0.55), "body")
        b[f"wing2.{s}"] = ((x * 1.0, 0.0, z + 0.55), (x * 1.9, 0.3, z + 0.4), f"wing1.{s}")
        b[f"leg.{s}"] = ((x * 0.18, 0.2, z - 0.15), (x * 0.2, 0.35, z - 0.6), "body")
        b[f"upper_arm.{s}"] = ((x * 0.24, -0.04, z + 0.7), (x * 0.33, -0.1, z + 0.45), "chest")
        b[f"forearm.{s}"] = ((x * 0.33, -0.1, z + 0.45), (x * 0.38, -0.35, z + 0.35), f"upper_arm.{s}")
        b[f"hand.{s}"] = ((x * 0.38, -0.35, z + 0.35), (x * 0.4, -0.45, z + 0.33), f"forearm.{s}")
    b["neck_r"] = ((0, -0.04, z + 0.75), (0, -0.06, z + 0.82), "chest")
    b["head_r"] = ((0, -0.06, z + 0.82), (0, -0.07, z + 1.05), "neck_r")
    hand = b["hand.R"][0]
    b["weapon"] = (hand, (hand[0], hand[1] - 0.2, hand[2]), "hand.R")
    m.skeleton(b)
    m.joints = {n: h for n, (h, t, p) in b.items()}
    m.tails = {n: t for n, (h, t, p) in b.items()}
    m.height = z + 1.1


def animations(m):
    def flap(a, b2, n=20):
        h = n // 2
        return {"wing1.L": [(1, (0, a, 0)), (h, (0, b2, 0)), (n, (0, a, 0))], "wing1.R": [(1, (0, -a, 0)), (h, (0, -b2, 0)), (n, (0, -a, 0))],
                "wing2.L": [(1, (0, a * 0.7, 0)), (h + 2, (0, b2 * 0.9, 0)), (n, (0, a * 0.7, 0))], "wing2.R": [(1, (0, -a * 0.7, 0)), (h + 2, (0, -b2 * 0.9, 0)), (n, (0, -a * 0.7, 0))],
                "body": [(1, (0, 0, 0), (0, 0, 0.1)), (h, (0, 0, 0), (0, 0, -0.08)), (n, (0, 0, 0), (0, 0, 0.1))]}
    m.action("idle", 20, flap(-35, 35))
    m.action("walk", 16, {**flap(-45, 45, 16), "body": [(1, (10, 0, 0)), (16, (10, 0, 0))]})
    m.action("attack", 24, {**flap(-25, 25), "upper_arm.R": [(1, (0, 0, 0)), (10, (150, 0, 0)), (15, (30, 0, 0)), (24, (0, 0, 0))], "neck": [(1, (0, 0, 0)), (12, (25, 0, 0)), (24, (0, 0, 0))]}, loop=False)
    m.action("attack2", 24, {**flap(-25, 25), "neck": [(1, (0, 0, 0)), (8, (-20, 0, 0)), (13, (30, 0, 0)), (24, (0, 0, 0))]}, loop=False)
    m.action("cast", 24, flap(-50, 50, 24), loop=False)
    m.action("hit", 12, {"body": [(1, (0, 0, 0)), (4, (-15, 0, 0)), (12, (0, 0, 0))]}, loop=False)
    m.action("death", 40, {"body": [(1, (0, 0, 0), (0, 0, 0)), (24, (30, 40, 0), (0, 0, -0.9)), (40, (20, 85, 0), (0, 0, -1.5))], "wing1.L": [(1, (0, 0, 0)), (40, (0, -60, 0))]}, loop=False)
    m.action("victory", 30, {**flap(-60, 60, 30), "upper_arm.R": [(1, (0, 0, 0)), (10, (160, 0, 0)), (24, (160, 0, 0)), (30, (0, 0, 0))]}, loop=False)


def build():
    m = Model("hawk_rider", skin="units_3_skin")
    s = u.Slots("hawk_rider")
    rig(m)
    j, t = m.joints, m.tails
    z = j["body"][2]
    # Hawk: feathered body, neck, head with a beak, tail fan, wings, talons
    c.limb(m, (0, 0.7, z - 0.02), (0, -0.4, z + 0.12), [(0, 0.3, 0.26), (0.4, 0.62, 0.58), (1, 0.4, 0.4)], slot=s.legs, uv="wrap", bone="body", segments=7)
    c.limb(m, j["neck"], t["neck"], [(0, 0.38, 0.38), (1, 0.26, 0.26)], slot=s.legs, uv="wrap", bone="neck", segments=6)
    h0 = Vector(j["head"])
    c.blob(m, tuple(h0), 0.17, s.foot_hand, "head", sub=u.HAND, uv="front")
    c.limb(m, tuple(h0 + Vector((0, -0.12, 0))), tuple(h0 + Vector((0, -0.36, -0.1))), [(0, 0.12, 0.12), (1, 0.01, 0.01)], slot=s.foot_hand, sub=(0.75, 0.95, 0.3, 0.6), bone="head", segments=4)
    for k in range(5):
        a = math.radians(-40 + 20 * k)
        tip = Vector((math.sin(a) * 0.45, 1.25, z - 0.05))
        c.limb(m, (0, 0.7, z), tuple(tip), [(0, 0.12, 0.03), (1, 0.18, 0.02)], slot=s.weapon_b, bone="tail", segments=4)
    for sd, sx in (("L", 1), ("R", -1)):
        w0, w1, w2 = Vector(j[f"wing1.{sd}"]), Vector(t[f"wing1.{sd}"]), Vector(t[f"wing2.{sd}"])
        for a, b2, bone, d0, d1 in ((w0, w1, f"wing1.{sd}", 0.75, 0.65), (w1, w2, f"wing2.{sd}", 0.65, 0.35)):
            pts = [a, b2, b2 + Vector((0, d1, -0.08)), a + Vector((0, d0, -0.05))]
            thick = [p + UP * 0.03 for p in pts] + [p - UP * 0.03 for p in pts]
            m.part("hull", 1, profile=[tuple(p) for p in thick], slot=s.weapon_b, uv="top", tint=W, bone=bone, smooth=10)
        l0, l1 = Vector(j[f"leg.{sd}"]), Vector(t[f"leg.{sd}"])
        c.limb(m, tuple(l0), tuple(l1), [(0, 0.12, 0.12), (1, 0.07, 0.07)], slot=s.foot_hand, sub=u.FOOT, bone=f"leg.{sd}", segments=5)
    # Saddle cloth (team)
    m.part("loft", 1, profile=[(0, 0.3, z + 0.27, 0.62, 0.04), (0, -0.15, z + 0.3, 0.6, 0.04)], slot=s.team, uv="top", tint=W, bone="body", segments=4, smooth=c.FACET)
    # Rider: torso, winged helm head, arms, war hammer
    c.limb(m, j["spine"], t["chest"], [(0, 0.4, 0.3), (0.6, 0.52, 0.34), (1, 0.4, 0.3)], slot=s.body, uv="front", back=s.body, bone="chest", segments=6)
    hr = Vector(j["head_r"])
    c.blob(m, tuple(hr + Vector((0, 0, 0.1))), 0.13, s.face, "head_r", uv="front")
    for sx in (1, -1):
        c.limb(m, tuple(hr + Vector((sx * 0.1, 0.02, 0.16))), tuple(hr + Vector((sx * 0.26, 0.12, 0.3))), [(0, 0.08, 0.02), (1, 0.12, 0.01)], slot=s.weapon_b, bone="head_r", segments=4)
    for side in ("L", "R"):
        c.limb(m, j[f"upper_arm.{side}"], j[f"forearm.{side}"], [(0, 0.16, 0.15), (1, 0.12, 0.12)], slot=s.arm, uv="wrap", bone=f"upper_arm.{side}", segments=6)
        c.limb(m, j[f"forearm.{side}"], j[f"hand.{side}"], [(0, 0.12, 0.12), (1, 0.1, 0.1)], slot=s.arm, uv="wrap", bone=f"forearm.{side}", segments=6)
    g = Vector(j["hand.R"])
    ax = Vector((0, -0.2, 1)).normalized()
    c.limb(m, tuple(g - ax * 0.15), tuple(g + ax * 0.65), [(0, 0.05, 0.05), (1, 0.05, 0.05)], slot=s.weapon_a, uv="wrap", sub=(0.4, 0.6, 0, 0.7), bone="weapon", segments=5)
    hh = g + ax * 0.7
    c.limb(m, tuple(hh + Vector((0.16, 0, 0))), tuple(hh - Vector((0.16, 0, 0))), [(0, 0.16, 0.16), (1, 0.16, 0.16)], slot=s.weapon_a, sub=(0.1, 0.9, 0.7, 1.0), bone="weapon", segments=4)
    animations(m)
    return m
