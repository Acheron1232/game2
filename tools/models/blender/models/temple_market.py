"""Temple Market — old stone altar with lanterns and broken pillars."""
import math

import _buildings as b


def build():
    m = b.start("temple_market", "buildings_3_skin", 4.0)
    m.part("box", (3.4, 3.4, 0.4), at=(0, 0, 0.2), slot="m7a", uv="top", tint=b.W, bone="root", bevel=0.1)
    m.part("box", (1.6, 1.0, 1.0), at=(0, 0, 0.9), slot="m3a", uv="box", tint=b.W, bone="root", bevel=0.1)
    for k in range(4):
        a = 2 * math.pi * k / 4 + math.pi / 4
        h = 2.6 if k % 2 else 1.6
        m.part("cylinder", (0.45, 0.45, h), at=(math.cos(a) * 1.35, math.sin(a) * 1.35, 0.4 + h / 2), slot="m6a", uv="wrap", tint=b.W, bone="root", segments=8)
        m.part("box", (0.25, 0.25, 0.3), at=(math.cos(a) * 1.35, math.sin(a) * 1.35, 0.55 + h), slot="m5a", tint="#ffd080", bone="root", bevel=0.2, material="glow", light=False)
    return b.finish(m, (("lantern", (0.95, 0.95, 3.3)), ("lantern2", (-0.95, -0.95, 3.3))))
