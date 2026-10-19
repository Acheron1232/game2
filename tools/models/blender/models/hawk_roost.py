"""Hawk Roost — tall stone tower with a big nest of branches on top."""
import math

import _buildings as b


def build():
    m = b.start("hawk_roost", "buildings_2_skin", 7)
    b.base_stones(m, 2.6, 2.6, slot="m5b")
    b.tower(m, 1.1, 5.0, (0, 0), "m7a", "m1b", z0=0.25)
    for k in range(10):
        a = 2 * math.pi * k / 10
        m.part("cylinder", (0.18, 0.18, 2.0), at=(math.cos(a) * 1.15, math.sin(a) * 1.15, 5.45), rot=(0, 75, math.degrees(a) + 90), slot="m6b", tint=b.W, bone="root", segments=5)
    m.part("cylinder", (2.6, 2.6, 0.4), at=(0, 0, 5.3), slot="m7a", uv="top", tint=b.W, bone="root", segments=10)
    for k in range(4):
        a = 2 * math.pi * k / 4 + 0.4
        b.flag(m, (math.cos(a) * 1.3, math.sin(a) * 1.3, 5.5))
    return b.finish(m)
