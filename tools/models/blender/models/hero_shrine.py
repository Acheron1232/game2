"""Hero Shrine — round stepped stone platform, four pillars with team banners, a gold crystal
floating over a small altar. The faction summons its own hero here."""
import _buildings as b


def build():
    m = b.start("hero_shrine", "buildings_1_skin", 3.6)
    # Two round steps of pale stone.
    m.part("cylinder", (3.0, 3.0, 0.3), at=(0, 0, 0.15), slot="m3b", uv="wrap", tint=b.W, bone="root", segments=12)
    m.part("cylinder", (2.3, 2.3, 0.25), at=(0, 0, 0.42), slot="m3a", uv="wrap", tint=b.W, bone="root", segments=12)
    # Four pillars on the corners of the lower step, each with a cap and a team banner on the front.
    for x in (-1.05, 1.05):
        for y in (-1.05, 1.05):
            m.part("cylinder", (0.32, 0.32, 2.1), at=(x, y, 1.35), slot="m3a", uv="wrap", tint=b.W, bone="root", segments=8)
            m.part("box", (0.46, 0.46, 0.16), at=(x, y, 2.48), slot="m4b", tint=b.W, bone="root", bevel=0.04)
            b.banner(m, (x, y - 0.18, 2.25), h=0.95, w=0.28, slot="m5a")
    # The altar block and the golden crystal above it (two cones = a long diamond). Not a glow
    # part: glow on skinned buildings draws black in the game for now.
    m.part("box", (0.7, 0.7, 0.55), at=(0, 0, 0.82), slot="m3b", tint=b.W, bone="root", bevel=0.08)
    m.part("cylinder", (0.6, 0.6, 0.06), at=(0, 0, 1.11), slot="m4a", uv="top", tint=b.W, bone="root", segments=8)
    m.part("cone", (0.5, 0.5, 0.7), at=(0, 0, 2.05), slot="m4a", uv="wrap", tint=b.W, bone="root", segments=6)
    m.part("cone", (0.5, 0.5, 0.45), at=(0, 0, 1.48), rot=(180, 0, 0), slot="m4a", uv="wrap", tint=b.W, bone="root", segments=6)
    return b.finish(m, (("crystal", (0, 0, 1.8)),))
