"""Citadel — small castle: pale stone keep-like central tower, four corner towers with golden roofs."""
import _buildings as b


def build():
    m = b.start("citadel", "buildings_1_skin", 10)
    b.base_stones(m, 4.8, 4.8, slot="m3b")
    b.walls(m, 4.4, 4.4, 2.6, "m3a", z0=0.3)
    b.walls(m, 2.4, 2.4, 3.2, "m3a", z0=2.9)
    b.tower(m, 0.4, 0.1, (0, 0), "m7a", "m4a", roof_h=2.6, z0=6.1, sides=4)
    b.gable_roof(m, 2.4, 2.4, 0.01, 6.1, "m7a", overhang=0.2)
    for x in (-2.1, 2.1):
        for y in (-2.1, 2.1):
            b.tower(m, 0.7, 4.0, (x, y), "m3b", "m4a", roof_h=1.8, z0=0.3, battlements="m7a")
    b.door(m, (0, -2.23), w=1.2, h=1.8)
    for x in (-1.0, 1.0):
        b.banner(m, (x, -2.28, 2.6), h=1.6)
    b.flag(m, (0, 0, 8.6))
    return b.finish(m)
