"""Workshop — plank workshop with a wooden crane, gears and stacked logs."""
import _buildings as b


def build():
    m = b.start("workshop", "buildings_2_skin", 5)
    b.base_stones(m, 3.2, 3.0, slot="m4b")
    b.walls(m, 3.0, 2.8, 1.9, "m6a", z0=0.25)
    b.gable_roof(m, 3.0, 2.8, 1.1, 2.15, "m1b")
    m.part("box", (0.25, 0.25, 3.6), at=(1.7, -1.2, 1.8), slot="m2a", tint=b.W, bone="root", bevel=0.1)
    m.part("box", (0.2, 2.0, 0.2), at=(1.7, -1.9, 3.5), rot=(-15, 0, 0), slot="m2a", tint=b.W, bone="root", bevel=0.1)
    m.part("cylinder", (0.9, 0.9, 0.15), at=(-1.55, -0.6, 1.1), rot=(0, 90, 0), slot="m6b", uv="front", tint=b.W, bone="root", segments=10)
    for k in range(3):
        m.part("cylinder", (0.25, 0.25, 1.5), at=(0.2 * k - 0.4, -1.8, 0.15 + 0.22 * (k % 2)), rot=(0, 90, 0), slot="m2b", tint=b.W, bone="root", segments=6)
    b.flag(m, (-1.3, 1.2, 2.2))
    return b.finish(m)
