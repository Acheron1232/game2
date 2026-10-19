"""Forge — rough stone smithy with a big chimney, a glowing furnace mouth and an anvil."""
import _buildings as b


def build():
    m = b.start("forge", "buildings_2_skin", 4.6)
    b.base_stones(m, 2.6, 2.6, slot="m4b")
    b.walls(m, 2.4, 2.4, 1.8, "m4a", z0=0.25)
    b.gable_roof(m, 2.4, 2.4, 1.0, 2.05, "m1b")
    m.part("box", (0.7, 0.7, 2.6), at=(0.7, 0.6, 2.4), slot="m4b", tint=b.W, bone="root", bevel=0.1)
    m.part("box", (0.9, 0.1, 0.7), at=(0, -1.21, 0.8), slot="m4a", uv="front", tint=b.W, bone="root", bevel=0.05, material="glow", light=False)
    m.part("box", (0.5, 0.25, 0.25), at=(-0.9, -1.6, 0.55), slot="m6b", tint="#707070", bone="root", bevel=0.2)
    m.part("box", (0.25, 0.2, 0.45), at=(-0.9, -1.6, 0.22), slot="m6b", tint="#707070", bone="root", bevel=0.1)
    b.flag(m, (-0.9, 0.9, 2.2))
    return b.finish(m, (("furnace", (0, -1.3, 0.8)), ("smoke", (0.7, 0.6, 3.8))))
