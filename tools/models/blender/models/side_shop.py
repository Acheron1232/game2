"""Trader's Tent — colorful striped tent with crates and barrels."""
import _buildings as b


def build():
    m = b.start("side_shop", "buildings_3_skin", 3.4)
    m.part("cylinder", (2.6, 2.6, 1.2), at=(0, 0, 0.6), slot="m2a", uv="wrap", tint=b.W, bone="root", segments=8, smooth=10)
    m.part("cone", (3.2, 3.2, 1.8), at=(0, 0, 2.1), slot="m2a", uv="wrap", tint=b.W, bone="root", segments=8, smooth=10)
    m.part("cylinder", (0.1, 0.1, 0.8), at=(0, 0, 3.3), slot="m0a", tint=b.W, bone="root", segments=5)
    for x, y, s in ((-1.3, -1.3, 0.55), (-0.7, -1.5, 0.45), (1.3, -1.2, 0.5)):
        m.part("box", (s, s, s), at=(x, y, s / 2), slot="m0b", tint=b.W, bone="root", bevel=0.08)
    m.part("cylinder", (0.5, 0.5, 0.7), at=(1.4, -0.5, 0.35), slot="m0a", uv="wrap", tint=b.W, bone="root", segments=8)
    return b.finish(m)
