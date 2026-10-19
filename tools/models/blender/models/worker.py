"""Worker — small sturdy villager with a pickaxe and a bundle of logs on the back."""

import chunky as c
import unitkit as u
from kit import Model
from mathutils import Vector


def build():
    m = Model("worker", skin="units_2_skin")
    s = u.Slots("worker")
    u.body(m, s, height=1.4, build=1.1, hunch=0.5, team_shoulders=False)
    j = m.joints
    hx, hy, hz = j["head"]
    m.part("loft", 1, profile=[(0, hy, hz + 0.16, 0.26, 0.26), (0, hy + 0.02, hz + 0.26, 0.22, 0.22), (0, hy + 0.04, hz + 0.3, 0.04, 0.04)], slot=s.team, uv="wrap", tint=c.W, bone="head", segments=6, smooth=c.FACET)
    g = Vector(c.grip_point(m, "R"))
    ax = Vector((0, -0.2, 1)).normalized()
    c.limb(m, tuple(g - ax * 0.15), tuple(g + ax * 0.55), [(0, 0.05, 0.05), (1, 0.05, 0.05)], slot=s.weapon_a, uv="wrap", sub=(0.45, 0.6, 0.0, 0.7), bone="weapon", segments=5)
    head = g + ax * 0.55
    c.limb(m, tuple(head + Vector((0, 0.25, -0.05))), tuple(head + Vector((0, -0.28, -0.08))), [(0, 0.04, 0.04), (0.5, 0.07, 0.06), (1, 0.01, 0.01)], slot=s.weapon_a, sub=(0.1, 0.9, 0.7, 1.0), bone="weapon", segments=4)
    top, fy = j["neck"][2], j["neck"][1]
    for k in range(3):
        y = fy + 0.24 + k * 0.02
        z = top - 0.15 - k * 0.1
        c.limb(m, (-0.24, y, z), (0.24, y + 0.02, z + 0.02), [(0, 0.1, 0.1), (1, 0.1, 0.1)], slot=s.weapon_b, uv="wrap", bone="chest", segments=6)
    return m
