"""Fountain of Life — round carved stone basin with glowing blue-green water and a center spout."""
import _buildings as b


def build():
    m = b.start("fountain_of_life", "buildings_3_skin", 2.6)
    m.part("cylinder", (3.0, 3.0, 0.6), at=(0, 0, 0.3), slot="m4a", uv="wrap", tint=b.W, bone="root", segments=12)
    m.part("cylinder", (2.6, 2.6, 0.08), at=(0, 0, 0.58), slot="m5a", uv="top", tint=b.W, bone="root", segments=12, material="glow", light=False)
    m.part("cylinder", (0.6, 0.6, 1.4), at=(0, 0, 1.0), slot="m4b", uv="wrap", tint=b.W, bone="root", segments=8)
    m.part("cylinder", (1.2, 1.2, 0.25), at=(0, 0, 1.75), slot="m4a", uv="wrap", tint=b.W, bone="root", segments=10)
    m.part("cylinder", (1.0, 1.0, 0.06), at=(0, 0, 1.86), slot="m5a", uv="top", tint=b.W, bone="root", segments=10, material="glow", light=False)
    return b.finish(m, (("water", (0, 0, 1.9)),))
