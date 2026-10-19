"""Catapult — wooden siege engine. Bones: root (rolls), arm (throws)."""

import chunky as c
import unitkit as u
from kit import Model

W = "#ffffff"


def build():
    m = Model("catapult", skin="units_4_skin")
    s = u.Slots("catapult")
    m.skeleton({"root": ((0, 0, 0), (0, 0, 0.3), None), "arm": ((0, 0.25, 0.85), (0, -0.9, 1.35), "root")})
    m.joints = {"root": (0, 0, 0), "arm": (0, 0.25, 0.85)}
    m.height = 2.0
    # Base frame: two long beams and cross beams
    for sx in (1, -1):
        m.part("box", (0.16, 1.9, 0.18), at=(sx * 0.42, 0, 0.42), slot=s.body, uv="box", tint=W, bone="root", bevel=0.1)
        m.part("box", (0.14, 0.14, 0.9), at=(sx * 0.42, 0.25, 0.85), rot=(-15, 0, 0), slot=s.face, tint=W, bone="root", bevel=0.1)
        for y in (-0.65, 0.65):
            m.part("cylinder", (0.62, 0.62, 0.12), at=(sx * 0.58, y, 0.31), rot=(0, 90, 0), slot=s.legs, uv="front", back=s.legs, tint=W, bone="root", segments=10)
    for y in (-0.8, 0.0, 0.8):
        m.part("box", (0.95, 0.14, 0.14), at=(0, y, 0.45), slot=s.body, tint=W, bone="root", bevel=0.1)
    m.part("box", (1.0, 0.18, 0.18), at=(0, 0.25, 1.28), slot=s.face, tint=W, bone="root", bevel=0.1)
    # Winch with rope, iron plates, team banner
    m.part("cylinder", (0.18, 0.7, 0.18), at=(0, 0.7, 0.62), rot=(0, 0, 90), slot=s.foot_hand, uv="wrap", tint=W, bone="root", segments=8)
    m.part("box", (0.04, 0.32, 0.5), at=(0.5, 0.75, 1.05), slot=s.team, uv="front", tint=W, bone="root", bevel=0.05)
    m.part("box", (0.04, 0.04, 0.9), at=(0.5, 0.9, 0.9), slot=s.body, tint=W, bone="root", bevel=0.1)
    # Throwing arm with the stone cup and a stone
    c.limb(m, (0, 0.25, 0.85), (0, -0.9, 1.35), [(0, 0.16, 0.16), (1, 0.12, 0.12)], slot=s.arm, uv="wrap", bone="arm", segments=6)
    m.part("cylinder", (0.4, 0.4, 0.14), at=(0, -0.95, 1.4), slot=s.weapon_b, tint=W, bone="arm", segments=8)
    c.blob(m, (0, -0.95, 1.55), 0.17, s.weapon_a, "arm")
    m.action("idle", 30, {"arm": [(1, (0, 0, 0)), (30, (0, 0, 0))]})
    m.action("walk", 24, {"root": [(1, (0, 0, 0), (0, 0, 0)), (6, (1.5, 0, 0), (0, 0, 0.02)), (12, (0, 0, 0), (0, 0, 0)), (18, (-1.5, 0, 0), (0, 0, 0.02)), (24, (0, 0, 0), (0, 0, 0))]})
    m.action("attack", 36, {"arm": [(1, (0, 0, 0)), (14, (0, 0, 0)), (18, (-95, 0, 0)), (26, (-90, 0, 0)), (36, (0, 0, 0))]}, loop=False)
    m.action("attack2", 36, {"arm": [(1, (0, 0, 0)), (14, (0, 0, 0)), (18, (-95, 0, 0)), (26, (-90, 0, 0)), (36, (0, 0, 0))]}, loop=False)
    m.action("hit", 10, {"root": [(1, (0, 0, 0)), (4, (0, 3, 0)), (10, (0, 0, 0))]}, loop=False)
    m.action("death", 30, {"root": [(1, (0, 0, 0), (0, 0, 0)), (20, (0, 25, 8), (0, 0, -0.1)), (30, (0, 30, 10), (0, 0, -0.2))], "arm": [(1, (0, 0, 0)), (30, (40, 0, 20))]}, loop=False)
    m.action("cast", 30, {"arm": [(1, (0, 0, 0)), (30, (0, 0, 0))]}, loop=False)
    m.action("victory", 30, {"arm": [(1, (0, 0, 0)), (15, (-30, 0, 0)), (30, (0, 0, 0))]}, loop=False)
    m.socket("stone", (0, -0.95, 1.55), "arm")
    return m
