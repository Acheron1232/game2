"""Lancer — knight on an armored horse with a long lance and a team pennant."""

import centaur_raider as cr
import chunky as c
import unitkit as u
from kit import Model
from mathutils import Vector

W = "#ffffff"


def build():
    m = Model("lancer", skin="units_3_skin")
    s = u.Slots("lancer")
    cr.rig(m, hy=0.05, rider=True)
    j, t = m.joints, m.tails
    Z = cr.WITHERS
    # Horse: barrel, team caparison, legs, neck and an armored head
    hb = [(0, 0.85, Z - 0.15, 0.46, 0.5), (0, 0.5, Z - 0.05, 0.6, 0.62), (0, 0.0, Z - 0.05, 0.62, 0.62), (0, -0.45, Z - 0.1, 0.56, 0.6)]
    m.part("loft", 1, profile=hb, slot=s.legs, uv="wrap", tint=W, bone="horse", segments=7, smooth=c.FACET)
    for sx in (1, -1):
        m.part("loft", 1, profile=[(sx * 0.33, 0.7, Z + 0.1, 0.03, 0.5), (sx * 0.37, -0.4, Z + 0.1, 0.03, 0.55), (sx * 0.4, -0.45, Z - 0.35, 0.03, 0.55), (sx * 0.38, 0.7, Z - 0.35, 0.03, 0.5)], slot=s.team, uv="front", tint=W, bone="horse", segments=4, smooth=c.FACET)
    c.limb(m, j["horse_neck"], t["horse_neck"], [(0, 0.42, 0.5), (1, 0.28, 0.32)], slot=s.legs, uv="wrap", bone="horse_neck", segments=6)
    h0, h1 = Vector(j["horse_head"]), Vector(t["horse_head"])
    c.limb(m, tuple(h0), tuple(h1), [(0, 0.26, 0.3), (0.6, 0.2, 0.24), (1, 0.15, 0.18)], slot=s.weapon_b, uv="wrap", bone="horse_head", segments=6)
    m.part("loft", 1, profile=[(*(h0 + Vector((0, 0.02, 0.15))), 0.05, 0.05), (*(h0 + Vector((0, -0.08, 0.32))), 0.005, 0.005)], slot=s.weapon_b, tint=W, bone="horse_head", segments=4, smooth=c.FACET)
    for sd in ("L", "R"):
        for part, r in (("front", 0.16), ("back", 0.2)):
            u0, u1, l1 = Vector(j[f"{part}_upper.{sd}"]), Vector(t[f"{part}_upper.{sd}"]), Vector(t[f"{part}_lower.{sd}"])
            c.limb(m, tuple(u0), tuple(u1), [(0, r * 1.7, r * 1.9), (1, r * 0.8, r * 0.85)], slot=s.legs, uv="wrap", bone=f"{part}_upper.{sd}", segments=6)
            c.limb(m, tuple(u1), tuple(l1), [(0, r * 0.8, r * 0.85), (1, r * 0.75, r * 0.8)], slot=s.foot_hand, sub=u.FOOT, uv="wrap", bone=f"{part}_lower.{sd}", segments=6)
    c.limb(m, j["tail"], t["tail"], [(0, 0.12, 0.1), (0.5, 0.17, 0.13), (1, 0.06, 0.05)], slot=s.legs, uv="wrap", bone="tail", segments=5)
    # Knight: torso, head in a closed helm, arms, legs hanging down the horse sides
    c.torso(m, front=s.body, back=s.body, waist=(0.38, 0.3), belly=(0.42, 0.32), chest=(0.56, 0.38), shoulders=(0.62, 0.38), neck=(0.24, 0.2), hump=False)
    c.head(m, face=s.face, back=s.face, size=(0.24, 0.24, 0.27), ears=None)
    hx, hy, hz = j["head"]
    m.part("loft", 1, profile=[(0, hy + 0.02, hz + 0.27, 0.05, 0.05), (0, hy + 0.12, hz + 0.42, 0.1, 0.16), (0, hy + 0.25, hz + 0.4, 0.04, 0.08)], slot=s.team, tint=W, bone="head", segments=4, smooth=c.FACET)
    for side in ("L", "R"):
        c.arm(m, side, skin=s.arm, fore=s.arm, band=None, upper=(0.24, 0.21, 0.16, 0.13), forearm=(0.13, 0.17, 0.15, 0.12), bracer=False)
        c.shoulder_pad(m, side, slot=s.arm, size=0.62, spikes=0)
        sx = 1 if side == "L" else -1
        c.limb(m, (sx * 0.16, 0.08, Z + 0.25), (sx * 0.38, -0.1, Z - 0.3), [(0, 0.17, 0.17), (1, 0.12, 0.12)], slot=s.arm, uv="wrap", bone="hips", segments=5)
    c.fist(m, "R", slot=s.foot_hand, size=0.065, sub=u.HAND)
    c.fist(m, "L", slot=s.foot_hand, size=0.065, sub=u.HAND)
    # Long lance pointing forward, with a team pennant
    g = Vector(c.grip_point(m, "R"))
    ax = Vector((0, -0.92, 0.38)).normalized()
    c.limb(m, tuple(g - ax * 0.5), tuple(g + ax * 2.0), [(0, 0.06, 0.06), (0.18, 0.14, 0.14), (0.22, 0.07, 0.07), (1, 0.01, 0.01)], slot=s.weapon_a, uv="wrap", sub=(0.35, 0.65, 0, 1), bone="weapon", segments=5)
    p0 = g + ax * 1.3
    m.part("loft", 1, profile=[(*p0, 0.01, 0.24), (*(p0 + Vector((0, 0.35, 0.02))), 0.01, 0.18), (*(p0 + Vector((0, 0.65, -0.03))), 0.01, 0.05)], slot=s.team, uv="front", tint=W, bone="weapon", segments=4, smooth=c.FACET)
    cr.animations(m)
    return m
