"""Shared builders for neutral monsters. Each monster file calls one of these with its own size."""

import math

import chunky as c
import humanoid
import rigs
import unitkit as u
from kit import Model
from mathutils import Vector

W = "#ffffff"
UP = Vector((0, 0, 1))


def wolf(mid, skin, scale=1.0, mane=False):
    m = Model(mid, skin=skin)
    # Thick legs and a heavy chest: thin wolves vanish on the grass from the RTS camera.
    c.set_bulk(1.35)
    s = u.Slots("grey_wolf")
    rigs.quadruped(m, length=1.2 * scale, height=0.75 * scale, neck=0.4 * scale, tail=0.6 * scale, leg_spread=0.15 * scale)
    j, t = m.joints, m.tails
    k = scale
    z = j["body"][2]
    # Round body (2026-10-31): two smooth lofts with a deep chest, a tucked belly and a narrow
    # rump, not two six-sided boxes. They meet at y = 0, one on each spine bone.
    rear = [(0.82, 0.03, 0.2, 0.2), (0.7, 0.02, 0.46, 0.5), (0.45, 0.03, 0.5, 0.52), (0.2, 0.06, 0.46, 0.42), (-0.04, 0.05, 0.54, 0.56)]
    front = [(0.04, 0.05, 0.54, 0.56), (-0.28, 0.03, 0.64, 0.72), (-0.56, 0.06, 0.64, 0.74), (-0.74, 0.08, 0.48, 0.56), (-0.82, 0.1, 0.18, 0.2)]
    for prof, bone in ((rear, "body"), (front, "chest")):
        m.part("loft", 1, profile=[(0, y * k, z + dz * k, w * k, d * k) for y, dz, w, d in prof], slot=s.body, uv="tube", tint=W, bone=bone, segments=10, smooth=60)
    n0, n1 = Vector(j["neck"]), Vector(t["neck"])
    if mane:
        # Thick ruff of pale fur around the neck (a ball here hid the alpha's face).
        ruff = [(-0.12, 0.66, 0.74), (0.35, 0.62, 0.68), (0.7, 0.44, 0.48)]
        m.part("loft", 1, profile=[(*(n0 + (n1 - n0) * a), w * k, d * k) for a, w, d in ruff], slot=s.team, uv="wrap", tint=W, bone="neck", segments=9, smooth=55)
    c.limb(m, tuple(n0 + (n0 - n1) * 0.15), tuple(n1), [(0, 0.38 * k, 0.44 * k), (1, 0.26 * k, 0.3 * k)], slot=s.body, uv="wrap", bone="neck", segments=8, smooth=55)
    # Head: skull, brow, muzzle and nose along the head bone, smooth, painted face in front.
    h0, h1 = Vector(j["head"]), Vector(t["head"])
    fwd = Vector((0, -1, 0))
    hk = 1.15 * k
    head = [(-0.1, 0.03, 0.2, 0.2), (0.0, 0.04, 0.32, 0.28), (0.12, 0.02, 0.26, 0.22), (0.24, -0.03, 0.15, 0.14), (0.34, -0.05, 0.1, 0.09), (0.38, -0.05, 0.03, 0.03)]
    prof = [tuple(h0 + fwd * (a * hk) + UP * (dz * hk)) + (w * hk, d * hk) for a, dz, w, d in head]
    hz = h0.z
    m.part("loft", 1, profile=prof, slot=s.face, uv="front", back=s.body, frame=(-0.17 * hk, 0.17 * hk, hz - 0.12 * hk, hz + 0.2 * hk), tint=W, bone="head", segments=10, smooth=60)
    for sx in (1, -1):
        e0 = h0 + Vector((sx * 0.1 * hk, 0.02 * hk, 0.12 * hk))
        m.part("hull", 1, profile=[tuple(e0 + Vector((-sx * 0.05 * hk, 0, 0))), tuple(e0 + Vector((sx * 0.04 * hk, 0, 0))), tuple(e0 + Vector((0, 0.03 * hk, 0))), tuple(e0 + Vector((0, -0.01 * hk, 0))), tuple(e0 + Vector((sx * 0.01 * hk, 0.02 * hk, 0.15 * hk)))], slot=s.body, tint=W, bone="head", smooth=c.FACET)
    # Bushy tail, thick in the middle.
    c.limb(m, j["tail"], t["tail"], [(0, 0.12 * k, 0.12 * k), (0.45, 0.2 * k, 0.2 * k), (0.8, 0.14 * k, 0.14 * k), (1, 0.03, 0.03)], slot=s.weapon_b, uv="wrap", bone="tail", segments=7, smooth=55)
    for sd in ("L", "R"):
        for part in ("front", "back"):
            u0, u1, l1 = Vector(j[f"{part}_upper.{sd}"]), Vector(t[f"{part}_upper.{sd}"]), Vector(t[f"{part}_lower.{sd}"])
            top = 0.26 if part == "back" else 0.22
            c.limb(m, tuple(u0 + Vector((0, 0, 0.06 * k))), tuple(u1), [(0, top * k, 0.28 * k), (0.6, 0.15 * k, 0.17 * k), (1, 0.1 * k, 0.11 * k)], slot=s.arm, uv="wrap", bone=f"{part}_upper.{sd}", segments=7, smooth=50)
            c.limb(m, tuple(u1), tuple(l1), [(0, 0.1 * k, 0.11 * k), (1, 0.075 * k, 0.08 * k)], slot=s.arm, uv="wrap", bone=f"{part}_lower.{sd}", segments=6, smooth=50)
            c.blob(m, tuple(l1 + Vector((0, -0.04 * k, 0))), 0.07 * k, s.foot_hand, f"{part}_lower.{sd}", sub=u.FOOT, squash=(1, 1.4, 0.6))
    rigs.quadruped_animations(m)
    return m


def humanoid_monster(mid, skin, prefix, height=1.75, build=1.0, hunch=0.6, weapon="blade", hood=False, extra=None):
    m = Model(mid, skin=skin)
    c.set_bulk(1.1)
    s = u.Slots(prefix)
    u.body(m, s, height=height, build=build, hunch=hunch, team_shoulders=False, team_belt=False, hood=False, style="ranged" if weapon == "bow" else "melee", round_torso=build >= 1.5)
    j = m.joints
    g = Vector(c.grip_point(m, "R"))
    if weapon == "blade":
        ax = Vector((0, -0.5, 0.85)).normalized()
        c.limb(m, tuple(g - ax * 0.1), tuple(g + ax * 0.6), [(0, 0.05, 0.03), (0.2, 0.08, 0.02), (1, 0.01, 0.01)], slot=s.weapon_a, sub=(0.3, 0.7, 0, 1), bone="weapon", segments=4)
    elif weapon == "club":
        ax = Vector((0, -0.3, 1)).normalized()
        c.limb(m, tuple(g - ax * 0.15), tuple(g + ax * 1.1 * build), [(0, 0.08 * build, 0.08 * build), (0.7, 0.2 * build, 0.2 * build), (1, 0.24 * build, 0.24 * build)], slot=s.weapon_a, uv="wrap", sub=(0.3, 0.7, 0, 1), bone="weapon", segments=6)
    elif weapon == "spear":
        ax = Vector((0, -0.3, 1)).normalized()
        c.limb(m, tuple(g - ax * 0.7), tuple(g + ax * 0.9), [(0, 0.05, 0.05), (0.85, 0.05, 0.05), (0.9, 0.1, 0.05), (1, 0.005, 0.005)], slot=s.weapon_a, uv="wrap", sub=(0.35, 0.65, 0, 1), bone="weapon", segments=5)
    elif weapon == "halberd":
        ax = Vector((0, -0.15, 1)).normalized()
        c.limb(m, tuple(g - ax * 0.9), tuple(g + ax * 1.2), [(0, 0.07, 0.07), (1, 0.06, 0.06)], slot=s.weapon_a, uv="wrap", sub=(0.35, 0.65, 0, 0.8), bone="weapon", segments=5)
        top = g + ax * 1.0
        c.frame_hull(m, top, (Vector((0, -1, 0)), Vector((1, 0, 0)), ax), [(0, 0, -0.1), (0, 0, 0.35), (0.35, 0, 0.05), (0.3, 0, 0.25), (0.05, 0.03, 0.1), (0.05, -0.03, 0.1)], slot=s.weapon_a, sub=(0.1, 0.9, 0.8, 1.0), bone="weapon")
    elif weapon == "bow":
        gl = Vector(c.grip_point(m, "L"))
        upv = Vector((0, -0.05, 1)).normalized()
        for sign in (1, -1):
            pts = [gl + upv * sign * math.sin(tt * 1.1) * 0.6 + Vector((0, 1, 0)) * (1 - math.cos(tt * 1.1)) * 0.22 for tt in (q / 4 for q in range(5))]
            m.part("loft", 1, profile=[(*p, w, w) for p, w in zip(pts, (0.05, 0.05, 0.045, 0.04, 0.02))], slot=s.weapon_b, uv="wrap", sub=(0.3, 0.7, 0, 1), tint=W, bone="hand.L", segments=5, smooth=c.FACET)
    if hood:
        hx, hy, hz = j["head"]
        m.part("loft", 1, profile=[(0, hy + 0.03, hz - 0.06, 0.3, 0.3), (0, hy + 0.03, hz + 0.1, 0.32, 0.32), (0, hy + 0.12, hz + 0.3, 0.02, 0.02)], slot=s.team, uv="front", back=s.team, tint=W, bone="head", segments=6, smooth=c.FACET)
    if extra:
        extra(m, s)
    return m


def spider(mid, skin, scale=1.0, crystals=False):
    m = Model(mid, skin=skin)
    s = u.Slots("rock_spider")
    k = scale
    z = 0.55 * k
    bones = {"root": ((0, 0, 0), (0, 0, 0.2), None), "body": ((0, 0.3 * k, z), (0, -0.3 * k, z), "root"), "head": ((0, -0.3 * k, z), (0, -0.6 * k, z - 0.05), "body")}
    for i in range(4):
        y = -0.3 * k + i * 0.2 * k
        for sd, sx in (("L", 1), ("R", -1)):
            bones[f"leg{i}_a.{sd}"] = ((sx * 0.25 * k, y, z), (sx * 0.65 * k, y + (i - 1.5) * 0.15 * k, z + 0.3 * k), "body")
            bones[f"leg{i}_b.{sd}"] = (bones[f"leg{i}_a.{sd}"][1], (sx * 0.95 * k, y + (i - 1.5) * 0.3 * k, 0.0), f"leg{i}_a.{sd}")
    m.skeleton(bones)
    m.joints = {n: h for n, (h, tl, p) in bones.items()}
    m.tails = {n: tl for n, (h, tl, p) in bones.items()}
    m.height = z + 0.5 * k
    c.blob(m, (0, 0.35 * k, z + 0.1 * k), 0.48 * k, s.body, "body", squash=(1.0, 1.25, 0.8), uv="top")
    c.blob(m, (0, -0.25 * k, z), 0.26 * k, s.legs, "body", squash=(1.1, 1.2, 0.8))
    c.blob(m, (0, -0.52 * k, z - 0.02 * k), 0.17 * k, s.face, "head", uv="front")
    for sx in (1, -1):
        c.limb(m, (sx * 0.06 * k, -0.62 * k, z - 0.05 * k), (sx * 0.04 * k, -0.72 * k, z - 0.25 * k), [(0, 0.06 * k, 0.06 * k), (1, 0.005, 0.005)], slot=s.foot_hand, sub=u.HAND, bone="head", segments=4)
    for i in range(4):
        for sd in ("L", "R"):
            a, b = bones[f"leg{i}_a.{sd}"][0], bones[f"leg{i}_a.{sd}"][1]
            cc = bones[f"leg{i}_b.{sd}"][1]
            c.limb(m, a, b, [(0, 0.11 * k, 0.11 * k), (1, 0.08 * k, 0.08 * k)], slot=s.arm, uv="wrap", bone=f"leg{i}_a.{sd}", segments=5)
            c.limb(m, b, cc, [(0, 0.08 * k, 0.08 * k), (1, 0.01, 0.01)], slot=s.arm, uv="wrap", bone=f"leg{i}_b.{sd}", segments=5)
    if crystals:
        for q in range(5):
            a = q * 1.3
            base = Vector((math.cos(a) * 0.25 * k, 0.35 * k + math.sin(a) * 0.25 * k, z + 0.35 * k))
            tip = base + Vector((math.cos(a) * 0.1, math.sin(a) * 0.1, 0.4 * k))
            m.part("loft", 1, profile=[(*base, 0.12 * k, 0.12 * k), (*tip, 0.005, 0.005)], slot=s.team, uv="wrap", tint=W, bone="body", segments=4, smooth=10)
    walk = {}
    for i in range(4):
        for sd, ph in (("L", i % 2), ("R", (i + 1) % 2)):
            a = 20 if ph == 0 else -20
            walk[f"leg{i}_a.{sd}"] = [(1, (0, 0, a)), (8, (0, 0, -a)), (16, (0, 0, a))]
    m.action("walk", 16, walk)
    m.action("idle", 40, {"body": [(1, (0, 0, 0), (0, 0, 0)), (20, (0, 0, 0), (0, 0, -0.03)), (40, (0, 0, 0), (0, 0, 0))]})
    m.action("attack", 20, {"head": [(1, (0, 0, 0)), (8, (20, 0, 0)), (12, (-25, 0, 0)), (20, (0, 0, 0))], "leg0_a.L": [(1, (0, 0, 0)), (8, (-40, 0, 0)), (20, (0, 0, 0))], "leg0_a.R": [(1, (0, 0, 0)), (8, (-40, 0, 0)), (20, (0, 0, 0))]}, loop=False)
    m.action("attack2", 20, {"body": [(1, (0, 0, 0)), (8, (-15, 0, 0)), (12, (10, 0, 0)), (20, (0, 0, 0))]}, loop=False)
    m.action("cast", 24, {"body": [(1, (0, 0, 0)), (12, (-20, 0, 0)), (24, (0, 0, 0))]}, loop=False)
    m.action("hit", 10, {"body": [(1, (0, 0, 0)), (4, (10, 0, 0)), (10, (0, 0, 0))]}, loop=False)
    m.action("death", 30, {"body": [(1, (0, 0, 0), (0, 0, 0)), (20, (0, 160, 0), (0, 0, 0.1)), (30, (0, 180, 0), (0, 0, -0.05))]}, loop=False)
    m.action("victory", 30, {"body": [(1, (0, 0, 0)), (15, (-25, 0, 0)), (30, (0, 0, 0))]}, loop=False)
    return m


def harpy(mid, skin, scale=1.0, crown=False):
    m = Model(mid, skin=skin)
    c.set_bulk(1.2, head=1.1)
    s = u.Slots("harpy")
    humanoid.skeleton(m, height=1.6 * scale, shoulders=0.2, hips=0.1, leg_len=0.85, arm_len=1.15, hunch=0.6, arm_spread=0.7, knee_bend=0.6, elbow_bend=0.3)
    j = m.joints
    c.torso(m, front=s.body, back=s.body, waist=(0.26, 0.2), belly=(0.3, 0.22), chest=(0.4, 0.28), shoulders=(0.44, 0.28), neck=(0.18, 0.15), hump=False)
    c.head(m, face=s.face, back=s.face, size=(0.2, 0.21, 0.24), ears=None)
    for side, sx in (("L", 1), ("R", -1)):
        sh, e, w = Vector(j[f"upper_arm.{side}"]), Vector(j[f"forearm.{side}"]), Vector(j[f"hand.{side}"])
        c.limb(m, tuple(sh), tuple(e), [(0, 0.12, 0.11), (1, 0.09, 0.09)], slot=s.arm, uv="wrap", bone=f"upper_arm.{side}", segments=5)
        c.limb(m, tuple(e), tuple(w), [(0, 0.09, 0.09), (1, 0.07, 0.07)], slot=s.arm, uv="wrap", bone=f"forearm.{side}", segments=5)
        wing_feathers(m, s, sh, e, w, sx, side, scale)
        c.leg(m, side, thigh_slot=s.legs, shin_slot=s.legs, foot_slot=s.foot_hand, thigh=(0.16, 0.15, 0.09), shin=(0.08, 0.08, 0.06), band=None, foot_sub=u.FOOT, boot=0.9)
    if crown:
        hx, hy, hz = j["head"]
        for q in range(5):
            a = math.pi * (0.2 + 0.6 * q / 4)
            base = Vector((math.cos(a) * 0.1, hy + 0.02, hz + 0.2))
            m.part("loft", 1, profile=[(*base, 0.05, 0.02), (*(base + Vector((math.cos(a) * 0.08, 0.04, 0.22))), 0.03, 0.01)], slot=s.weapon_b, tint=W, bone="head", segments=4, smooth=10)
    humanoid.animations(m, style="caster")
    return m

def feather(m, root, d, wd, nrm, length, width, slot, bone):
    """One long flat feather: narrow root, wide middle, pointed tip."""
    pts = []
    for a, half in ((0.0, 0.25), (0.35, 1.0), (0.75, 0.7), (1.0, 0.0)):
        p = root + d * (a * length)
        for sw in ((1, -1) if half else (0,)):
            for th in (1, -1):
                pts.append(tuple(p + wd * (sw * half * width / 2) + nrm * (th * 0.012)))
    m.part("hull", 1, profile=pts, slot=slot, uv="box", tint=W, bone=bone, smooth=10)


def wing_feathers(m, s, sh, e, w, sx, side, scale):
    """A fan of feathers on the arm (2026-10-31): long ones at the hand reach out to the side,
    short ones near the shoulder hang back. The fan does not follow the arm's rest angle (the arm
    hangs down; feathers along it reached the ground). Two flat planks read as cardboard."""
    k = scale
    tip = w + Vector((sx * 0.3, 0.05, 0.1))
    fan = [(1.0, (0.85, 0.3, -0.42), 0.62), (0.8, (0.62, 0.45, -0.6), 0.62), (0.55, (0.38, 0.55, -0.72), 0.56), (0.3, (0.18, 0.62, -0.76), 0.5), (0.05, (0.06, 0.7, -0.72), 0.44)]
    d_tip, d_root = Vector((sx * 0.85, 0.3, -0.42)).normalized(), Vector((sx * 0.06, 0.7, -0.72)).normalized()
    nrm = d_tip.cross(d_root).normalized()
    if nrm.z < 0:
        nrm = -nrm
    for i, (a, dv, ln) in enumerate(fan):
        root = e + (tip - e) * a
        d = Vector((sx * dv[0], dv[1], dv[2])).normalized()
        feather(m, root, d, d.cross(nrm).normalized(), nrm, ln * k, 0.2 * k, s.weapon_a if i % 2 else s.weapon_b, f"forearm.{side}")
    for a, ln in ((0.3, 0.36), (0.75, 0.42)):
        root = sh + (e - sh) * a
        d = Vector((sx * 0.1, 0.72, -0.68)).normalized()
        feather(m, root, d, d.cross(nrm).normalized(), nrm, ln * k, 0.22 * k, s.weapon_a, f"upper_arm.{side}")
