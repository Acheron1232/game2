"""Stronghold — the Town Hall with stone walls, a second floor and two towers."""
import _buildings as b


def build():
    m = b.start("stronghold", "buildings_1_skin", 8.5)
    b.base_stones(m, 4.6, 3.8)
    b.walls(m, 4.2, 3.4, 2.4, "m2a", z0=0.3)
    b.walls(m, 3.6, 2.8, 1.6, "m0a", z0=2.7)
    b.gable_roof(m, 3.6, 2.8, 1.8, 4.3, "m1a")
    for x in (-1.9, 1.9):
        b.tower(m, 0.75, 4.0, (x, -1.4), "m2b", "m1b", roof_h=1.6, z0=0.3, battlements="m7a")
    b.door(m, (0, -1.73), w=1.1, h=1.6)
    for x in (-0.9, 0.9):
        b.banner(m, (x, -1.78, 2.5), h=1.5)
    b.flag(m, (1.9, -1.4, 6.3))
    return b.finish(m)
