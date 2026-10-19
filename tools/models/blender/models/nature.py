"""Trees and bushes: static, very low poly (100-400 triangles), no skeleton.
The game sways them with wind in the vertex shader and draws them as thin instances."""

import math

from kit import Model

BARK = "#6b4a30"


def trunk(m, h, r, slot="bark_oak", tint=BARK, lean=0):
    m.part("lathe", (1, 1, 1), profile=[(r * 1.5, 0), (r * 1.1, 0.08), (r, h * 0.5), (r * 0.7, h)], rot=(lean, 0, 0), slot=slot, tint=tint, segments=6)


def pine():
    m = Model("tree_pine")
    trunk(m, 1.6, 0.13, "bark_pine", "#5a3e2a")
    for i, (r, z, hgt) in enumerate([(1.25, 0.9, 1.7), (1.0, 1.9, 1.5), (0.7, 2.8, 1.3)]):
        tint = ["#4a8a52", "#539558", "#5ea262"][i]
        m.part("cone", (r * 2, r * 2, hgt), at=(0, 0, z + hgt / 2), slot="moss_ground", tint=tint, segments=8)
    return m


def oak():
    m = Model("tree_oak")
    trunk(m, 1.9, 0.18)
    m.part("cylinder", (0.12, 0.12, 0.9), at=(0.35, 0, 1.6), rot=(0, 40, 0), slot="bark_oak", tint=BARK, segments=5)
    m.part("cylinder", (0.12, 0.12, 0.8), at=(-0.3, 0.1, 1.7), rot=(10, -35, 0), slot="bark_oak", tint=BARK, segments=5)
    for x, y, z, s, t in [(0, 0, 2.55, 1.55, "#7fb54a"), (0.6, 0.15, 2.2, 1.05, "#6fa63e"), (-0.55, -0.1, 2.25, 1.1, "#78ae44"), (0.05, -0.45, 2.1, 0.95, "#86bc52"), (0.1, 0.45, 2.15, 0.95, "#6a9f3a")]:
        m.part("sphere", (s * 1.1, s, s * 0.85), at=(x, y, z), slot="moss_ground", tint=t, segments=7, rings=5)
    return m


def dead():
    m = Model("tree_dead")
    trunk(m, 2.0, 0.14, "bark_dead", "#8a7c68", lean=4)
    for ang, z, ln, tilt in [(20, 1.4, 0.9, 50), (150, 1.7, 0.8, 45), (260, 1.15, 0.7, 60), (80, 2.0, 0.6, 35)]:
        a = math.radians(ang)
        m.part("cone", (0.12, 0.12, ln), at=(math.cos(a) * ln * 0.35, math.sin(a) * ln * 0.35, z + ln * 0.3), rot=(0, tilt, ang), slot="bark_dead", tint="#8a7c68", segments=5)
    return m


def bush():
    m = Model("bush")
    for x, y, z, s, t in [(0, 0, 0.35, 0.9, "#78ad46"), (0.35, 0.1, 0.28, 0.6, "#82b850"), (-0.3, -0.1, 0.25, 0.6, "#6c9f3c")]:
        m.part("sphere", (s, s, s * 0.8), at=(x, y, z), slot="moss_ground", tint=t, segments=8, rings=5)
    return m
