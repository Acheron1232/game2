"""Tree Guardian — walking young tree: bark body, leafy crown, branch arms, root feet."""

import random

import chunky as c
import humanoid
import unitkit as u
from kit import Model
from mathutils import Vector


def build():
    m = Model("tree_guardian", skin="units_4_skin")
    s = u.Slots("tree_guardian")
    humanoid.skeleton(m, height=2.0, shoulders=0.3, hips=0.15, leg_len=0.75, arm_len=1.25, hunch=0.6, arm_spread=0.6, knee_bend=0.4, elbow_bend=0.4)
    j = m.joints
    c.torso(m, front=s.body, back=s.body, waist=(0.5, 0.42), belly=(0.56, 0.46), chest=(0.62, 0.5), shoulders=(0.66, 0.5), neck=(0.5, 0.42), hump=False)
    c.head(m, face=s.face, back=s.body, size=(0.32, 0.3, 0.3), ears=None)
    rnd = random.Random(5)
    hx, hy, hz = j["head"]
    for k in range(7):
        p = Vector((rnd.uniform(-0.32, 0.32), hy + rnd.uniform(0.0, 0.3), hz + rnd.uniform(0.38, 0.62)))
        r = rnd.uniform(0.17, 0.26)
        c.blob(m, tuple(p), r, s.weapon_a, "head")
    for side in ("L", "R"):
        c.arm(m, side, skin=s.arm, fore=s.arm, band=None, upper=(0.2, 0.17, 0.14, 0.11), forearm=(0.11, 0.13, 0.11, 0.08), bracer=False)
        w = Vector(j[f"hand.{side}"])
        for k in range(3):
            tip = w + Vector(((k - 1) * 0.1, -0.12, -0.25))
            c.limb(m, tuple(w), tuple(tip), [(0, 0.06, 0.06), (1, 0.01, 0.01)], slot=s.arm, bone=f"hand.{side}", segments=4)
        c.leg(m, side, thigh_slot=s.legs, shin_slot=s.legs, foot_slot=s.foot_hand, thigh=(0.24, 0.24, 0.18), shin=(0.18, 0.2, 0.2), band=None, foot_sub=u.FOOT, boot=1.4)
    m.socket("crown", (0, hy + 0.1, hz + 0.45), "head")
    humanoid.animations(m, style="melee", weight=1.25)
    return m
