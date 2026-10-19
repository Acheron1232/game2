"""Decor models: rocks, stumps, logs, temple ruins, fences, crates, barrels. Static, cheap
(40-300 triangles), drawn as thin instances. They use the shared palette atlas."""

import math
import random

import chunky as c
from kit import Model

W = "#ffffff"


def start(mid):
    m = Model(mid)
    m.skeleton({"root": ((0, 0, 0), (0, 0, 0.3), None)})
    m.joints = {"root": (0, 0, 0)}
    m.height = 1
    return m


def finish(m):
    m.action("idle", 30, {"root": [(1, (0, 0, 0)), (30, (0, 0, 0))]})
    return m


def boulder(m, center, size, slot, seed, tint=W, sink=0.25):
    rnd = random.Random(seed)
    cx, cy, cz = center
    sx, sy, sz = size
    pts = []
    for k in range(16):
        z = -1 + 2 * (k + 0.5) / 16
        r = math.sqrt(max(0, 1 - z * z))
        a = k * 2.399 + rnd.random() * 0.5
        j = 0.8 + rnd.random() * 0.35
        pts.append((cx + math.cos(a) * r * sx * j, cy + math.sin(a) * r * sy * j, max(cz - sz * sink, cz + z * sz * j)))
    m.part("hull", 1, profile=pts, slot=slot, tint=tint, bone="root", smooth=24)


def rock_small():
    m = start("rock_small")
    boulder(m, (0, 0, 0.18), (0.4, 0.32, 0.26), "rock_grey", 1)
    boulder(m, (0.32, 0.12, 0.1), (0.18, 0.15, 0.13), "rock_mossy", 2)
    return finish(m)


def rock_big():
    m = start("rock_big")
    boulder(m, (0, 0, 0.7), (1.3, 1.0, 0.95), "rock_mossy", 3)
    boulder(m, (0.95, 0.35, 0.35), (0.6, 0.5, 0.45), "rock_grey", 4)
    boulder(m, (-0.8, -0.4, 0.25), (0.45, 0.4, 0.3), "rock_grey", 5)
    return finish(m)


def stump():
    m = start("stump")
    m.part("lathe", (1, 1, 1), profile=[(0.32, 0), (0.24, 0.12), (0.22, 0.38), (0.2, 0.42)], slot="bark_oak", tint=W, bone="root", segments=8, smooth=30)
    m.part("cylinder", (0.4, 0.4, 0.02), at=(0, 0, 0.42), slot="wood_planks", tint="#d8b080", bone="root", segments=8)
    for a in (0.3, 2.4, 4.3):
        c.limb(m, (math.cos(a) * 0.18, math.sin(a) * 0.18, 0.08), (math.cos(a) * 0.48, math.sin(a) * 0.48, 0.0), [(0, 0.11, 0.1), (1, 0.04, 0.04)], slot="bark_oak", bone="root", segments=5)
    return finish(m)


def log():
    m = start("log")
    c.limb(m, (-1.0, 0, 0.18), (1.0, 0.1, 0.16), [(0, 0.36, 0.34), (1, 0.3, 0.3)], slot="bark_oak", uv="wrap", bone="root", segments=7)
    c.limb(m, (0.2, 0.05, 0.3), (0.45, 0.4, 0.55), [(0, 0.08, 0.08), (1, 0.03, 0.03)], slot="bark_oak", bone="root", segments=4)
    m.part("cylinder", (0.3, 0.3, 0.02), at=(1.0, 0.1, 0.16), rot=(0, 90, 0), slot="wood_planks", tint="#d8b080", bone="root", segments=8)
    return finish(m)


def ruin_pillar():
    m = start("ruin_pillar")
    m.part("box", (0.9, 0.9, 0.3), at=(0, 0, 0.15), slot="stone_wall", tint="#d8d0c0", bone="root", bevel=0.15)
    m.part("cylinder", (0.6, 0.6, 1.9), at=(0, 0, 1.25), slot="cobblestone_wall", uv="wrap", tint="#e0d8c8", bone="root", segments=8, smooth=40)
    # Broken top: a slanted cut
    m.part("hull", 1, profile=[(x * 0.3, y * 0.3, 2.2 + 0.25 * x) for x in (-1, 1) for y in (-1, 1)] + [(x * 0.3, y * 0.3, 2.0) for x in (-1, 1) for y in (-1, 1)], slot="cobblestone_wall", tint="#d0c8b8", bone="root", smooth=20)
    boulder(m, (0.7, 0.4, 0.12), (0.3, 0.25, 0.18), "stone_wall", 7, tint="#d8d0c0")
    return finish(m)


def ruin_block():
    m = start("ruin_block")
    m.part("box", (1.2, 0.7, 0.6), at=(0, 0, 0.25), rot=(0, 6, 12), slot="stone_wall", tint="#d8d0c0", bone="root", bevel=0.18)
    m.part("box", (0.7, 0.6, 0.45), at=(0.6, 0.5, 0.2), rot=(8, 0, -20), slot="rock_mossy", tint=W, bone="root", bevel=0.2)
    return finish(m)


def statue():
    m = start("statue")
    m.part("box", (1.0, 1.0, 0.6), at=(0, 0, 0.3), slot="stone_wall", tint="#d8d0c0", bone="root", bevel=0.12)
    c.limb(m, (0, 0, 0.6), (0, 0, 1.9), [(0, 0.55, 0.4), (0.7, 0.62, 0.42), (1, 0.4, 0.32)], slot="stone_skin", uv="wrap", bone="root", segments=6)
    c.blob(m, (0, -0.02, 2.1), 0.2, "stone_skin", "root")
    c.limb(m, (0.32, -0.05, 1.75), (0.45, -0.3, 1.3), [(0, 0.15, 0.15), (1, 0.12, 0.12)], slot="stone_skin", bone="root", segments=5)
    c.limb(m, (0.5, -0.32, 0.6), (0.5, -0.32, 2.4), [(0, 0.06, 0.06), (1, 0.06, 0.06)], slot="stone_wall", bone="root", segments=5)
    return finish(m)


def fence():
    m = start("fence")
    for x in (-0.9, 0.9):
        m.part("box", (0.12, 0.12, 1.0), at=(x, 0, 0.5), slot="timber_dark", tint=W, bone="root", bevel=0.2)
    for z in (0.35, 0.75):
        m.part("box", (1.95, 0.06, 0.12), at=(0, 0, z), rot=(0, 2 if z > 0.5 else -2, 0), slot="wood_planks", tint=W, bone="root", bevel=0.2)
    return finish(m)


def crate():
    m = start("crate")
    m.part("box", (0.75, 0.75, 0.75), at=(0, 0, 0.375), slot="wood_planks", tint=W, bone="root", bevel=0.08)
    m.part("box", (0.5, 0.5, 0.5), at=(0.15, 0.05, 1.0), rot=(0, 0, 20), slot="wood_planks", tint="#c8a070", bone="root", bevel=0.08)
    return finish(m)


def barrel():
    m = start("barrel")
    m.part("lathe", (1, 1, 1), profile=[(0.3, 0), (0.37, 0.25), (0.38, 0.45), (0.35, 0.7), (0.3, 0.85)], slot="timber_dark", uv="wrap", tint=W, bone="root", segments=10, smooth=40)
    for z in (0.15, 0.7):
        m.part("cylinder", (0.78, 0.78, 0.06), at=(0, 0, z), slot="iron_rivets", tint=W, bone="root", segments=10)
    return finish(m)
