"""House — small cottage: plaster walls, thatched roof, a chimney, team shutters. Footprint 2x2."""
import _buildings as b


def build():
    m = b.start("house", "buildings_2_skin", 3.2)
    b.base_stones(m, 1.8, 1.6, slot="m4b")
    b.walls(m, 1.7, 1.5, 1.3, "m0a", z0=0.25)
    b.gable_roof(m, 1.7, 1.5, 1.1, 1.55, "m1a", overhang=0.2)
    m.part("box", (0.3, 0.3, 1.2), at=(0.5, 0.3, 2.2), slot="m4a", tint=b.W, bone="root", bevel=0.1)
    b.door(m, (0, -0.77), w=0.5, h=0.8, slot="m6a")
    b.banner(m, (-0.55, -0.8, 1.25), h=0.6, w=0.3, slot="m2b")
    return b.finish(m, (("smoke", (0.5, 0.3, 2.9)),))
