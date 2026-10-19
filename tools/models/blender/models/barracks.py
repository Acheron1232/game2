"""Barracks — long dark timber hall with a clay roof, crossed-sword sign, training dummy."""
import _buildings as b


def build():
    m = b.start("barracks", "buildings_2_skin", 4.5)
    b.base_stones(m, 3.8, 2.4, slot="m4b")
    b.walls(m, 3.6, 2.2, 1.9, "m2a", z0=0.25)
    b.gable_roof(m, 2.2, 3.6, 1.3, 2.15, "m1a")
    m.part("box", (3.6, 2.2, 1.9), at=(0, 0, 1.2), rot=(0, 0, 90), slot="m2a", tint=b.W, bone="root", bevel=0.05)
    b.door(m, (0, -1.13), w=1.0, h=1.3, slot="m6a")
    for sx in (1, -1):
        m.part("box", (0.08, 0.05, 0.9), at=(sx * 0.2, -1.2, 1.9), rot=(0, sx * 40, 0), slot="m6b", tint="#d0d0d0", bone="root", bevel=0)
    m.part("cylinder", (0.12, 0.12, 1.3), at=(2.2, -0.8, 0.65), slot="m6a", tint=b.W, bone="root", segments=5)
    m.part("box", (0.7, 0.1, 0.1), at=(2.2, -0.8, 1.05), slot="m6a", tint=b.W, bone="root", bevel=0)
    b.flag(m, (-1.5, 0.8, 2.2))
    return b.finish(m)
