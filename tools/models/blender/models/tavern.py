"""Tavern — a two-storey timber-and-stone tavern with a clay tile roof, a stone chimney, a hanging tankard
sign and barrels at the door. Neutral (no team color): heroes hire mercenaries here. Footprint 4x4."""
import _buildings as b


def build():
    m = b.start("tavern", "buildings_1_skin", 5.2)
    b.base_stones(m, 3.4, 3.0, slot="m3b")
    b.walls(m, 3.3, 2.9, 1.5, "m3a", z0=0.25)
    # Upper floor sticks out a little, timber posts on the corners.
    b.walls(m, 3.5, 3.1, 1.3, "m0a", z0=1.75)
    for x in (-1.72, 1.72):
        for y in (-1.52, 1.52):
            m.part("box", (0.18, 0.18, 2.9), at=(x, y, 1.6), slot="m6b", tint=b.W, bone="root", bevel=0.04)
    b.gable_roof(m, 3.5, 3.1, 1.6, 3.05, "m1a", overhang=0.3)
    m.part("box", (0.55, 0.55, 2.6), at=(-1.1, 0.9, 3.6), slot="m3b", tint=b.W, bone="root", bevel=0.08)
    b.door(m, (0, -1.47), w=0.85, h=1.25, slot="m6a")
    # Hanging sign: a plank on an arm, with a round tankard shape on it.
    m.part("box", (0.9, 0.08, 0.08), at=(1.0, -1.85, 2.4), slot="m6b", tint=b.W, bone="root", bevel=0)
    m.part("box", (0.6, 0.06, 0.45), at=(1.2, -1.85, 2.08), slot="m6a", uv="front", tint=b.W, bone="root", bevel=0.03)
    m.part("cylinder", (0.22, 0.22, 0.26), at=(1.2, -1.9, 2.08), rot=(90, 0, 0), slot="m6b", uv="wrap", tint="#e0b050", bone="root", segments=8)
    # Barrels and a crate by the door.
    for x, y in ((-1.0, -1.85), (-1.55, -1.7)):
        m.part("cylinder", (0.5, 0.5, 0.7), at=(x, y, 0.35), slot="m6b", uv="wrap", tint="#a07850", bone="root", segments=8)
    m.part("box", (0.5, 0.5, 0.5), at=(1.6, -1.8, 0.25), slot="m6a", tint=b.W, bone="root", bevel=0.05)
    return b.finish(m, (("smoke", (-1.1, 0.9, 4.95)),))
