import chunky as c
from _monsters import humanoid_monster


def mask(m, s):
    hx, hy, hz = m.joints["head"]
    c.frame_hull(m, (0, hy - 0.13, hz + 0.12), ((1, 0, 0), (0, -1, 0), (0, 0, 1)), [(-0.13, 0, -0.15), (0.13, 0, -0.15), (-0.15, 0, 0.14), (0.15, 0, 0.14), (0, 0.05, 0), (0, -0.04, 0.2)], slot=s.team, uv="front", bone="head")
    for sx in (1, -1):
        c.limb(m, (sx * 0.08, hy, hz + 0.25), (sx * 0.2, hy + 0.1, hz + 0.6), [(0, 0.08, 0.02), (1, 0.12, 0.01)], slot=s.weapon_b, bone="head", segments=4)


def build():
    return humanoid_monster("troll_shaman", "monsters_2_skin", "forest_troll", height=1.9, build=0.95, hunch=1.0, weapon="spear", extra=mask)
