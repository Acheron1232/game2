"""Chapel — white stone chapel with a round window, a small bell tower and a team banner."""
import _buildings as b


def build():
    m = b.start("chapel", "buildings_2_skin", 6)
    b.base_stones(m, 2.4, 3.2, slot="m5b")
    b.walls(m, 2.2, 3.0, 2.2, "m5a", z0=0.25)
    b.gable_roof(m, 2.2, 3.0, 1.6, 2.45, "m1a")
    b.tower(m, 0.55, 2.0, (0, 1.2), "m5a", "m1b", roof_h=1.4, z0=2.45, sides=4)
    m.part("cylinder", (0.8, 0.8, 0.12), at=(0, -1.52, 2.0), rot=(90, 0, 0), slot="m5a", uv="front", tint=b.W, bone="root", segments=10, material="glow", light=False)
    b.door(m, (0, -1.53), w=0.7, h=1.1)
    b.banner(m, (0.75, -1.58, 2.2), h=1.1, w=0.4, slot="m2b")
    return b.finish(m, (("window", (0, -1.6, 2.0)),))
