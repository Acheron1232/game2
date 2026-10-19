"""Watchtower — thin wooden tower on a stone base with a roofed lookout and a team flag."""
import _buildings as b


def build():
    m = b.start("watchtower", "buildings_3_skin", 6.5)
    b.walls(m, 1.6, 1.6, 0.9, "m6a", z0=0.0)
    for x in (-0.55, 0.55):
        for y in (-0.55, 0.55):
            m.part("box", (0.22, 0.22, 3.6), at=(x, y, 2.6), slot="m0a", tint=b.W, bone="root", bevel=0.1)
    b.walls(m, 1.8, 1.8, 0.9, "m0b", z0=4.1)
    m.part("cone", (2.6, 2.6, 1.3), at=(0, 0, 5.65), rot=(0, 0, 45), slot="m0a", uv="wrap", tint=b.W, bone="root", segments=4, smooth=10)
    b.flag(m, (0, 0, 6.2))
    return b.finish(m, (("lookout", (0, 0, 4.6)),))
