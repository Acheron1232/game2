"""Tavern mercenaries. Each one has its own 8-cell skin (<id>_skin): the cells are painted by
Codex on top of a guide picture of this model's UV layout (tools/art/uv-guide.ts), so the
pictures fit the parts: the face cell lands on the head front, the body cell on the torso..."""

import math

import chunky as c
import humanoid
import unitkit as u
from kit import Model
from mathutils import Vector

W = "#ffffff"


def ratling_cutthroat():
    m = Model("ratling_cutthroat", skin="ratling_cutthroat_skin")
    s = u.Slots("ratling_cutthroat")
    u.body(m, s, height=1.3, build=0.85, hunch=1.0, team_shoulders=False, team_belt=False, style="melee")
    j = m.joints
    hx, hy, hz = j["head"]
    # Snout, big round ears and a bandana (team color).
    m.part("loft", 1, profile=[(0, hy - 0.12, hz + 0.08, 0.16, 0.14), (0, hy - 0.3, hz + 0.04, 0.06, 0.05)], slot=s.face, uv="front", tint=W, bone="head", segments=6, smooth=c.FACET)
    for sx in (1, -1):
        c.blob(m, (sx * 0.15, hy + 0.02, hz + 0.3), 0.09, s.foot_hand, "head", sub=u.HAND, squash=(1.0, 0.35, 1.2))
    m.part("loft", 1, profile=[(0, hy, hz + 0.18, 0.27, 0.27), (0, hy + 0.02, hz + 0.28, 0.28, 0.28), (0, hy + 0.05, hz + 0.33, 0.2, 0.2)], slot=s.team, uv="wrap", tint=W, bone="head", segments=6, smooth=c.FACET)
    # Team sash and a long tail.
    hipz = j["hips"][2]
    m.part("loft", 1, profile=[(0, 0, hipz + 0.02, 0.36, 0.28), (0, 0, hipz + 0.1, 0.37, 0.29)], slot=s.team, uv="wrap", tint=W, bone="hips", segments=8, smooth=c.FACET)
    c.limb(m, (0, 0.12, hipz), (0, 0.75, 0.12), [(0, 0.06, 0.06), (0.6, 0.035, 0.035), (1, 0.01, 0.01)], slot=s.weapon_b, uv="wrap", sub=(0.5, 1.0, 0, 1), bone="hips", segments=5)
    # Two curved daggers.
    for side in ("R", "L"):
        g = Vector(c.grip_point(m, side))
        ax = Vector((0, -0.6, 0.7)).normalized()
        c.limb(m, tuple(g - ax * 0.06), tuple(g + ax * 0.42), [(0, 0.04, 0.02), (0.25, 0.07, 0.015), (1, 0.008, 0.008)], slot=s.weapon_a, sub=(0.2, 0.8, 0, 1), bone="weapon" if side == "R" else "hand.L", segments=4)
    return m


def toadfolk_mystic():
    m = Model("toadfolk_mystic", skin="toadfolk_mystic_skin")
    s = u.Slots("toadfolk_mystic")
    u.body(m, s, height=1.45, build=1.45, hunch=0.3, team_shoulders=False, team_belt=False, robe=True, style="caster")
    j = m.joints
    hx, hy, hz = j["head"]
    # A wide flat toad head with big eyes on top.
    c.blob(m, (0, hy - 0.02, hz + 0.12), 0.36, s.face, "head", squash=(1.2, 1.0, 0.8), uv="front")
    for sx in (1, -1):
        c.blob(m, (sx * 0.17, hy - 0.12, hz + 0.27), 0.1, s.weapon_b, "head", sub=(0.0, 0.5, 0.5, 1.0))
    # Team cape on the back.
    c.cape(m, slot=s.team, length=0.85, width=0.75)
    # A tall crooked staff with a lantern.
    g = Vector(c.grip_point(m, "R"))
    ax = Vector((0, -0.15, 1)).normalized()
    c.limb(m, tuple(g - ax * 0.75), tuple(g + ax * 0.95), [(0, 0.05, 0.05), (0.5, 0.06, 0.06), (1, 0.045, 0.045)], slot=s.weapon_a, uv="wrap", sub=(0.0, 0.5, 0, 1), bone="weapon", segments=5)
    top = g + ax * 1.05
    c.blob(m, tuple(top + Vector((0, -0.08, 0.02))), 0.13, s.weapon_b, "weapon", sub=(0.5, 1.0, 0.0, 1.0), squash=(1, 1, 1.3))
    return m


def shellback_beetle():
    m = Model("shellback_beetle", skin="shellback_beetle_skin")
    s = u.Slots("shellback_beetle")
    k = 1.25
    z = 0.62 * k
    bones = {"root": ((0, 0, 0), (0, 0, 0.2), None), "body": ((0, 0.45 * k, z), (0, -0.35 * k, z), "root"), "head": ((0, -0.35 * k, z), (0, -0.75 * k, z), "body")}
    legs = 3
    for i in range(legs):
        y = -0.25 * k + i * 0.35 * k
        for sd, sx in (("L", 1), ("R", -1)):
            bones[f"leg{i}_a.{sd}"] = ((sx * 0.35 * k, y, z - 0.1 * k), (sx * 0.85 * k, y + (i - 1) * 0.2 * k, z + 0.15 * k), "body")
            bones[f"leg{i}_b.{sd}"] = (bones[f"leg{i}_a.{sd}"][1], (sx * 1.1 * k, y + (i - 1) * 0.4 * k, 0.0), f"leg{i}_a.{sd}")
    m.skeleton(bones)
    m.joints = {n: h for n, (h, tl, p) in bones.items()}
    m.tails = {n: tl for n, (h, tl, p) in bones.items()}
    m.height = z + 0.6 * k
    # Domed shell (seen from above), belly, head with a big horn and jaws.
    c.blob(m, (0, 0.12 * k, z + 0.12 * k), 0.68 * k, s.body, "body", squash=(1.0, 1.35, 0.72), uv="top")
    c.blob(m, (0, 0.1 * k, z - 0.12 * k), 0.55 * k, s.legs, "body", squash=(1.0, 1.3, 0.5))
    c.blob(m, (0, -0.62 * k, z - 0.02 * k), 0.3 * k, s.face, "head", uv="front", squash=(1.1, 1.0, 0.9))
    c.limb(m, (0, -0.75 * k, z + 0.08 * k), (0, -1.15 * k, z + 0.55 * k), [(0, 0.13 * k, 0.11 * k), (0.6, 0.08 * k, 0.07 * k), (1, 0.01, 0.01)], slot=s.weapon_a, uv="wrap", bone="head", segments=6)
    for sx in (1, -1):
        c.limb(m, (sx * 0.14 * k, -0.82 * k, z - 0.12 * k), (sx * 0.06 * k, -1.02 * k, z - 0.2 * k), [(0, 0.06 * k, 0.05 * k), (1, 0.01, 0.01)], slot=s.foot_hand, sub=u.HAND, bone="head", segments=4)
    # Team war cloth over the shell and a small banner pole.
    m.part("loft", 1, profile=[(0, 0.0, z + 0.62 * k, 0.9 * k, 0.05), (0, 0.05, z + 0.45 * k, 1.25 * k, 0.05), (0, 0.1, z + 0.12 * k, 1.4 * k, 0.04)], slot=s.team, uv="front", back=s.team, tint=W, bone="body", segments=4, smooth=c.FACET)
    c.limb(m, (0, 0.55 * k, z + 0.45 * k), (0, 0.6 * k, z + 1.3 * k), [(0, 0.03, 0.03), (1, 0.025, 0.025)], slot=s.weapon_b, uv="wrap", sub=(0, 0.5, 0, 1), bone="body", segments=4)
    m.part("loft", 1, profile=[(0, 0.62 * k, z + 1.25 * k, 0.03, 0.45), (0, 0.85 * k, z + 1.2 * k, 0.02, 0.38)], slot=s.team, uv="front", back=s.team, tint=W, bone="body", segments=4, smooth=c.FACET)
    for i in range(legs):
        for sd in ("L", "R"):
            a, b = bones[f"leg{i}_a.{sd}"][0], bones[f"leg{i}_a.{sd}"][1]
            cc = bones[f"leg{i}_b.{sd}"][1]
            c.limb(m, a, b, [(0, 0.2 * k, 0.2 * k), (1, 0.15 * k, 0.15 * k)], slot=s.arm, uv="wrap", bone=f"leg{i}_a.{sd}", segments=5)
            c.limb(m, b, cc, [(0, 0.15 * k, 0.15 * k), (0.7, 0.12 * k, 0.12 * k), (1, 0.04, 0.04)], slot=s.arm, uv="wrap", bone=f"leg{i}_b.{sd}", segments=5)
    walk = {}
    for i in range(legs):
        for sd, ph in (("L", i % 2), ("R", (i + 1) % 2)):
            a = 18 if ph == 0 else -18
            walk[f"leg{i}_a.{sd}"] = [(1, (0, 0, a)), (12, (0, 0, -a)), (24, (0, 0, a))]
    walk["body"] = [(1, (0, 0, 0), (0, 0, 0)), (6, (0, 0, 0), (0, 0, 0.03)), (12, (0, 0, 0), (0, 0, 0)), (18, (0, 0, 0), (0, 0, 0.03)), (24, (0, 0, 0), (0, 0, 0))]
    m.action("walk", 24, walk)
    m.action("idle", 50, {"body": [(1, (0, 0, 0), (0, 0, 0)), (25, (0, 0, 0), (0, 0, -0.03)), (50, (0, 0, 0), (0, 0, 0))], "head": [(1, (0, 0, 0)), (25, (0, 0, 6)), (50, (0, 0, 0))]})
    m.action("attack", 22, {"head": [(1, (0, 0, 0)), (9, (-25, 0, 0)), (13, (30, 0, 0)), (22, (0, 0, 0))], "body": [(1, (0, 0, 0)), (9, (-8, 0, 0)), (13, (6, 0, 0)), (22, (0, 0, 0))]}, loop=False)
    m.action("attack2", 22, {"head": [(1, (0, 0, 0)), (8, (0, 0, 25)), (13, (0, 0, -30)), (22, (0, 0, 0))]}, loop=False)
    m.action("cast", 24, {"body": [(1, (0, 0, 0)), (12, (-15, 0, 0)), (24, (0, 0, 0))]}, loop=False)
    m.action("hit", 10, {"body": [(1, (0, 0, 0)), (4, (8, 0, 0)), (10, (0, 0, 0))]}, loop=False)
    m.action("death", 30, {"body": [(1, (0, 0, 0), (0, 0, 0)), (20, (0, 150, 0), (0, 0, 0.15)), (30, (0, 180, 0), (0, 0, -0.1))]}, loop=False)
    m.action("victory", 30, {"head": [(1, (0, 0, 0)), (15, (-30, 0, 0)), (30, (0, 0, 0))]}, loop=False)
    return m


def ember_wisp():
    m = Model("ember_wisp", skin="ember_wisp_skin")
    s = u.Slots("ember_wisp")
    z = 0.95
    bones = {
        "root": ((0, 0, 0), (0, 0, 0.2), None),
        "body": ((0, 0, z - 0.5), (0, 0, z + 0.3), "root"),
        "head": ((0, 0, z + 0.3), (0, 0, z + 0.7), "body"),
        "tail": ((0, 0, z - 0.5), (0, 0.15, 0.1), "body"),
    }
    for sd, sx in (("L", 1), ("R", -1)):
        bones[f"arm.{sd}"] = ((sx * 0.3, 0, z + 0.15), (sx * 0.65, -0.15, z - 0.05), "body")
    m.skeleton(bones)
    m.joints = {n: h for n, (h, tl, p) in bones.items()}
    m.tails = {n: tl for n, (h, tl, p) in bones.items()}
    m.height = z + 0.85
    # A flame body that narrows into a tail, the coal core, the stone mask, flame arms.
    m.part("loft", 1, profile=[(0, 0, z - 0.45, 0.42, 0.38), (0, 0, z, 0.66, 0.58), (0, 0, z + 0.32, 0.56, 0.5), (0, 0, z + 0.45, 0.3, 0.28)], slot=s.body, uv="wrap", tint=W, bone="body", segments=8, smooth=c.FACET)
    m.part("loft", 1, profile=[(0, 0, z - 0.42, 0.42, 0.38), (0, 0.05, z - 0.8, 0.22, 0.2), (0, 0.15, 0.12, 0.02, 0.02)], slot=s.legs, uv="wrap", tint=W, bone="tail", segments=7, smooth=c.FACET)
    c.blob(m, (0, -0.26, z + 0.02), 0.16, s.weapon_a, "body", uv="front")
    c.blob(m, (0, -0.06, z + 0.55), 0.25, s.face, "head", uv="front", squash=(0.95, 0.8, 1.1))
    for q in range(3):
        a = q * 2.1
        base = (math.cos(a) * 0.12, math.sin(a) * 0.1 + 0.05, z + 0.72)
        m.part("loft", 1, profile=[(*base, 0.12, 0.12), (base[0] * 1.5, base[1] * 1.5, z + 1.0, 0.02, 0.02)], slot=s.body, uv="wrap", tint=W, bone="head", segments=5, smooth=c.FACET)
    for sd, sx in (("L", 1), ("R", -1)):
        a0, a1 = bones[f"arm.{sd}"][0], bones[f"arm.{sd}"][1]
        c.limb(m, a0, a1, [(0, 0.16, 0.16), (0.7, 0.12, 0.12), (1, 0.03, 0.03)], slot=s.arm, uv="wrap", bone=f"arm.{sd}", segments=6)
        c.blob(m, (a1[0], a1[1], a1[2]), 0.08, s.foot_hand, f"arm.{sd}", sub=u.HAND)
    # Three team crystal shards floating around the body.
    for q in range(3):
        a = q * 2.1 + 0.5
        cx, cy = math.cos(a) * 0.62, math.sin(a) * 0.62
        m.part("loft", 1, profile=[(cx, cy, z - 0.05, 0.005, 0.005), (cx, cy, z + 0.15, 0.13, 0.13), (cx, cy, z + 0.4, 0.005, 0.005)], slot=s.team, uv="wrap", tint=W, bone="body", segments=4, smooth=10)
    bob = [(1, (0, 0, 0), (0, 0, 0)), (20, (0, 0, 0), (0, 0, 0.08)), (40, (0, 0, 0), (0, 0, 0))]
    m.action("idle", 40, {"body": bob, "tail": [(1, (0, 0, 0)), (20, (8, 0, 6)), (40, (0, 0, 0))]})
    m.action("walk", 24, {"body": [(1, (10, 0, 0), (0, 0, 0)), (12, (12, 0, 0), (0, 0, 0.06)), (24, (10, 0, 0), (0, 0, 0))], "tail": [(1, (15, 0, 0)), (12, (25, 0, 8)), (24, (15, 0, 0))]})
    m.action("attack", 20, {"arm.R": [(1, (0, 0, 0)), (8, (-50, 0, 0)), (12, (40, 0, 0)), (20, (0, 0, 0))], "body": [(1, (0, 0, 0)), (8, (-8, 0, 0)), (12, (10, 0, 0)), (20, (0, 0, 0))]}, loop=False)
    m.action("attack2", 20, {"arm.L": [(1, (0, 0, 0)), (8, (-50, 0, 0)), (12, (40, 0, 0)), (20, (0, 0, 0))]}, loop=False)
    m.action("cast", 24, {"arm.L": [(1, (0, 0, 0)), (12, (-70, 0, 0)), (24, (0, 0, 0))], "arm.R": [(1, (0, 0, 0)), (12, (-70, 0, 0)), (24, (0, 0, 0))]}, loop=False)
    m.action("hit", 10, {"body": [(1, (0, 0, 0)), (4, (12, 0, 0)), (10, (0, 0, 0))]}, loop=False)
    m.action("death", 30, {"body": [(1, (0, 0, 0), (0, 0, 0)), (20, (0, 0, 90), (0, 0, -0.4)), (30, (0, 0, 120), (0, 0, -0.85))]}, loop=False)
    m.action("victory", 30, {"body": [(1, (0, 0, 0), (0, 0, 0)), (15, (0, 0, 180), (0, 0, 0.2)), (30, (0, 0, 360), (0, 0, 0))]}, loop=False)
    return m
