"""Town Hall — big timber and stone hall, tall clay roof, bell tower, team banners. Footprint 5x5."""
import _buildings as b


def build():
    m = b.start("town_hall", "buildings_1_skin", 8)
    b.base_stones(m, 4.4, 3.6)
    b.walls(m, 4.0, 3.2, 2.6, "m0a", z0=0.3)
    b.gable_roof(m, 4.0, 3.2, 2.0, 2.9, "m1a")
    b.walls(m, 1.4, 1.4, 1.6, "m0b", z0=2.6)
    b.tower(m, 0.7, 2.6, (1.6, 1.2), "m2a", "m1b", roof_h=1.8, z0=0.3)
    b.tower(m, 0.85, 1.4, (0, 0.1), "m0b", "m1b", roof_h=1.4, z0=3.6, sides=4)
    b.door(m, (0, -1.63))
    for x in (-1.2, 1.2):
        b.banner(m, (x, -1.68, 2.4), h=1.3)
    b.flag(m, (0, 0.1, 6.4))
    return b.finish(m, (("smoke", (1.6, 1.2, 4.8)),))
