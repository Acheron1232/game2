"""Cleric — robed healer with a glowing short staff and a book."""

import chunky as c
import unitkit as u
from kit import Model
from mathutils import Vector


def build():
    m = Model("cleric", skin="units_2_skin")
    s = u.Slots("cleric")
    u.body(m, s, height=1.72, build=0.95, hunch=0.45, team_shoulders=False, robe=True, hood=True, style="caster")
    g = Vector(c.grip_point(m, "R"))
    ax = Vector((0, -0.1, 1)).normalized()
    c.limb(m, tuple(g - ax * 0.7), tuple(g + ax * 0.75), [(0, 0.05, 0.05), (1, 0.05, 0.05)], slot=s.weapon_a, uv="wrap", sub=(0.35, 0.65, 0, 0.8), bone="weapon", segments=5)
    c.blob(m, tuple(g + ax * 0.85), 0.09, s.weapon_a, "weapon", sub=(0.3, 0.7, 0.8, 1.0))
    m._material(m.parts[-1][0], "glow")
    m.parts[-1][0].data.materials.pop(index=0)
    hz = m.joints["hips"][2]
    m.part("hull", 1, profile=[(0.16 + dx, -0.12 + dy, hz - 0.15 + dz) for dx in (0, 0.09) for dy in (0, 0.14) for dz in (0, 0.18)], slot=s.weapon_b, uv="front", tint=c.W, bone="hips", smooth=c.FACET)
    m.socket("staff", tuple(g + ax * 0.85), "weapon")
    return m
