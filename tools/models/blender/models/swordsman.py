"""Swordsman — armored foot soldier: open helmet, kite shield (team face), short sword."""

import chunky as c
import unitkit as u
from kit import Model
from mathutils import Vector


def build():
    m = Model("swordsman", skin="units_1_skin")
    s = u.Slots("swordsman")
    u.body(m, s, height=1.75, build=1.05, hunch=0.4)
    j = m.joints
    # Sword through the right fist, held forward
    g = Vector(c.grip_point(m, "R"))
    ax = Vector((0, -0.55, 0.85)).normalized()
    c.limb(m, tuple(g - ax * 0.12), tuple(g + ax * 0.75), [(0, 0.05, 0.03), (0.18, 0.09, 0.025), (0.9, 0.08, 0.02), (1, 0.01, 0.01)], slot=s.weapon_a, uv="wrap", sub=(0.3, 0.7, 0, 1), bone="weapon", segments=4)
    c.limb(m, tuple(g + ax * 0.08), tuple(g + ax * 0.1), [(0, 0.24, 0.05), (1, 0.24, 0.05)], slot=s.weapon_b, bone="weapon", segments=4)
    # Kite shield on the left forearm
    e, w = Vector(j["forearm.L"]), Vector(j["hand.L"])
    cen = (e + w) / 2 + Vector((0.1, -0.06, 0))
    pts = [(-0.24, 0.0, 0.26), (0.24, 0.0, 0.26), (-0.27, 0.0, 0.05), (0.27, 0.0, 0.05), (0, 0.0, -0.5), (-0.24, 0.05, 0.26), (0.24, 0.05, 0.26), (-0.27, 0.05, 0.05), (0.27, 0.05, 0.05), (0, 0.05, -0.5), (0, -0.06, 0.0)]
    c.frame_hull(m, cen, (Vector((0, 1, 0)), Vector((1, 0, 0)), Vector((0, 0, 1))), pts, slot=s.team, uv="front", back=s.weapon_b, bone="forearm.L", smooth=12)
    m.socket("weapon", tuple(g + ax * 0.5), "weapon")
    return m
