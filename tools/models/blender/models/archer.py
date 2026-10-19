"""Archer — hooded archer with a longbow (left fist) and a quiver on the back."""

import math

import chunky as c
import unitkit as u
from kit import Model
from mathutils import Vector


def build():
    m = Model("archer", skin="units_1_skin")
    s = u.Slots("archer")
    u.body(m, s, height=1.72, build=0.95, hunch=0.3, team_shoulders=False, hood=True, style="ranged")
    j = m.joints
    top, fy = j["neck"][2], j["neck"][1]
    c.cape(m, slot=s.team, length=0.75, width=0.45)
    qa, qb = Vector((0.12, fy + 0.2, top - 0.45)), Vector((-0.1, fy + 0.24, top + 0.08))
    c.limb(m, tuple(qa), tuple(qb), [(0, 0.13, 0.12), (1, 0.15, 0.14)], slot=s.weapon_b, uv="wrap", bone="chest", segments=6)
    g = Vector(c.grip_point(m, "L"))
    up = Vector((0, -0.05, 1)).normalized()
    out = Vector((0, -1, 0))
    for sign in (1, -1):
        pts = [g + up * sign * math.sin(t * 1.1) * 0.75 - out * (1 - math.cos(t * 1.1)) * 0.3 for t in (k / 4 for k in range(5))]
        m.part("loft", 1, profile=[(*p, w, w) for p, w in zip(pts, (0.06, 0.06, 0.055, 0.045, 0.025))], slot=s.weapon_a, uv="wrap", sub=(0.3, 0.7, 0, 1), tint=c.W, bone="hand.L", segments=5, smooth=c.FACET)
    return m
