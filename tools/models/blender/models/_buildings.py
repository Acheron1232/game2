"""Building kit: chunky timber-and-stone RTS buildings from a few pieces.
Skins: buildings_1 (m0 hall wall, m1 clay roof, m2 stone wall, m3 citadel wall, m4 gold roof,
m5 team banner, m6 door, m7 tower top), buildings_2 (m0 plaster wall, m1 thatch, m2 dark timber,
m3 target, m4 forge stone, m5 chapel stone, m6 planks, m7 nest tower), buildings_3 (m0 watchtower
wood, m1 mine rock, m2 tent cloth, m3 altar stone, m4 fountain stone, m5 magic water, m6 pillar,
m7 temple floor). Each material has a clean 'a' and a worn 'b' cell.
Buildings have no skeleton; the root bone only exists so all models load the same way."""

import math

import chunky as c
from kit import Model
from mathutils import Vector

W = "#ffffff"


def start(mid, skin, height):
    m = Model(mid, skin=skin)
    m.skeleton({"root": ((0, 0, 0), (0, 0, 0.5), None)})
    m.joints = {"root": (0, 0, 0)}
    m.height = height
    return m


def walls(m, w, d, h, slot, z0=0.0, bevel=0.06, rot=0):
    """A box with walls on all sides (the texture repeats around)."""
    m.part("box", (w, d, h), at=(0, 0, z0 + h / 2), rot=(0, 0, rot), slot=slot, uv="box", tint=W, bone="root", bevel=bevel)


def gable_roof(m, w, d, h, z, slot, overhang=0.25, at=(0, 0)):
    """A pitched roof along Y, with a little overhang."""
    x0, y0 = at
    W2, D2 = w / 2 + overhang, d / 2 + overhang
    pts = [(x0 - W2, y0 - D2, z), (x0 + W2, y0 - D2, z), (x0 - W2, y0 + D2, z), (x0 + W2, y0 + D2, z), (x0, y0 - D2, z + h), (x0, y0 + D2, z + h),
           (x0 - W2, y0 - D2, z - 0.08), (x0 + W2, y0 - D2, z - 0.08), (x0 - W2, y0 + D2, z - 0.08), (x0 + W2, y0 + D2, z - 0.08)]
    m.part("hull", 1, profile=pts, slot=slot, uv="box", tint=W, bone="root", smooth=10)


def cone_roof(m, r, h, z, slot, at=(0, 0), sides=8):
    m.part("cone", (r * 2, r * 2, h), at=(at[0], at[1], z + h / 2), slot=slot, uv="wrap", tint=W, bone="root", segments=sides, smooth=10)


def tower(m, r, h, at, slot_wall, slot_roof, roof_h=None, z0=0.0, sides=8, battlements=None):
    x, y = at
    m.part("cylinder", (r * 2, r * 2, h), at=(x, y, z0 + h / 2), slot=slot_wall, uv="wrap", tint=W, bone="root", segments=sides, smooth=10)
    if battlements:
        m.part("cylinder", (r * 2.3, r * 2.3, 0.35), at=(x, y, z0 + h + 0.17), slot=battlements, uv="wrap", tint=W, bone="root", segments=sides, smooth=10)
        z0 += 0.35
    if roof_h:
        cone_roof(m, r * 1.25, roof_h, z0 + h, slot_roof, at=(x, y), sides=sides)


def banner(m, at, h=1.2, w=0.5, slot="m5a", facing=-1):
    """A hanging team banner on a pole sticking out of a wall. facing -1 = front (-Y)."""
    x, y, z = at
    m.part("box", (w + 0.15, 0.06, 0.06), at=(x, y + 0.04 * facing, z + 0.03), slot="m6a", tint="#a08060", bone="root", bevel=0)
    m.part("loft", 1, profile=[(x, y, z, w, 0.03), (x, y + 0.03 * facing, z - h * 0.6, w, 0.03), (x, y + 0.02 * facing, z - h, w * 0.4, 0.02)], slot=slot, uv="front", tint=W, bone="root", segments=4, smooth=c.FACET)


def flag(m, top, slot="m5a"):
    x, y, z = top
    m.part("cylinder", (0.06, 0.06, 1.2), at=(x, y, z + 0.6), slot="m6a", tint=W, bone="root", segments=5)
    m.part("loft", 1, profile=[(x + 0.02, y, z + 1.15, 0.03, 0.4), (x + 0.4, y, z + 1.1, 0.03, 0.34), (x + 0.75, y, z + 1.12, 0.03, 0.22)], slot=slot, uv="front", tint=W, bone="root", segments=4, smooth=c.FACET)


def door(m, at, w=0.9, h=1.4, slot="m6a"):
    x, y = at
    m.part("box", (w, 0.12, h), at=(x, y, h / 2), slot=slot, uv="front", tint=W, bone="root", bevel=0.05)
    m.part("cylinder", (w, 0.14, w), at=(x, y, h), rot=(90, 0, 0), slot=slot, uv="front", tint=W, bone="root", segments=8)


def base_stones(m, w, d, slot="m2a"):
    """A low stone foundation, a bit bigger than the walls."""
    m.part("box", (w + 0.3, d + 0.3, 0.3), at=(0, 0, 0.15), slot=slot, uv="box", tint=W, bone="root", bevel=0.15)


def finish(m, sockets=()):
    for name, at in sockets:
        m.socket(name, at, "root")
    m.action("idle", 30, {"root": [(1, (0, 0, 0)), (30, (0, 0, 0))]})
    return m
