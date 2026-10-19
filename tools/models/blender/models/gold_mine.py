"""Gold Mine: a rock hill with a timber-framed cave mouth and glittering gold. Static."""

from kit import Model

ROCK = "#8d8578"
WOOD = "#7a5634"


def build():
    m = Model("gold_mine")
    # Rock hill made of a few big rounded rocks
    for x, y, z, sx, sy, sz, t in [
        (0, 0.4, 0.9, 3.2, 2.4, 2.0, ROCK),
        (-1.2, 0.2, 0.6, 1.8, 1.8, 1.3, "#968e80"),
        (1.25, 0.3, 0.55, 1.7, 1.7, 1.2, "#857d70"),
        (0.2, 0.9, 1.5, 1.8, 1.4, 1.2, "#9a9284"),
    ]:
        m.part("sphere", (sx, sy, sz), at=(x, y, z), slot="rock_mossy" if z > 1 else "rock_grey", tint=t, segments=9, rings=6)
    # Dark cave mouth
    m.part("sphere", (1.0, 0.5, 1.15), at=(0, -0.72, 0.55), slot="flat_black", tint="#120d0a", segments=10, rings=6, light=False)
    # Timber frame: two posts and a beam
    for x in (-0.55, 0.55):
        m.part("box", (0.16, 0.16, 1.25), at=(x, -0.95, 0.62), slot="timber_dark", tint=WOOD, bevel=0.15)
    m.part("box", (1.45, 0.2, 0.18), at=(0, -0.95, 1.3), slot="timber_dark", tint=WOOD, bevel=0.15)
    # Gold piles and nuggets in front
    for x, y, s in [(-0.8, -1.25, 0.45), (0.85, -1.2, 0.38), (0.1, -1.45, 0.3), (-0.35, -1.5, 0.22), (0.5, -1.55, 0.2)]:
        m.part("sphere", (s, s, s * 0.6), at=(x, y, s * 0.2), slot="gold", tint="#f2c040", segments=6, rings=4)
    # Small cart rails leading in
    for x in (-0.18, 0.18):
        m.part("box", (0.05, 1.2, 0.05), at=(x, -1.3, 0.03), slot="dark_iron", tint="#5a5a5a", bevel=0)
    return m
