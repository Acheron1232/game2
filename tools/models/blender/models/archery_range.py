"""Archery Range — open wooden shed with straw targets and a fence."""
import _buildings as b


def build():
    m = b.start("archery_range", "buildings_2_skin", 3.6)
    for x in (-1.4, 1.4):
        for y in (-0.9, 0.9):
            m.part("box", (0.2, 0.2, 2.0), at=(x, y, 1.0), slot="m6a", tint=b.W, bone="root", bevel=0.1)
    b.walls(m, 3.0, 0.15, 1.8, "m6a", z0=0.0)
    m.parts[-1][0].location.y = 0.9
    b.gable_roof(m, 3.0, 1.9, 0.9, 2.0, "m1a", overhang=0.3)
    for k, x in enumerate((-1.0, 0.0, 1.0)):
        m.part("cylinder", (0.8, 0.8, 0.12), at=(x, -1.6, 0.7), rot=(90, 0, 0), slot="m3a", uv="front", back="m3b", tint=b.W, bone="root", segments=10)
        m.part("box", (0.08, 0.3, 0.8), at=(x, -1.5, 0.3), rot=(20, 0, 0), slot="m6a", tint=b.W, bone="root", bevel=0)
    b.flag(m, (1.4, 0.9, 2.0))
    return b.finish(m)
