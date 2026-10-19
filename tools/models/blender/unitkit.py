"""Units and monsters: same chunky look as heroes, a bit simpler (fewer parts, ~500-1200 tris).
They use compact skin sheets: 8 cells per model, named <model>__face, __body, __arm, __legs,
__foot_hand (left half foot, right half hand), __team, __weapon_a, __weapon_b."""

import chunky as c
import humanoid

FOOT = (0.0, 0.5, 0.0, 1.0)
HAND = (0.5, 1.0, 0.0, 1.0)


class Slots:
    def __init__(self, prefix):
        self.p = prefix

    def __getattr__(self, name):
        return f"{self.p}__{name}"


def body(m, s, height=1.75, build=1.0, hunch=0.4, team_shoulders=True, team_belt=True, hood=False, robe=False, fists=("R", "L"), style="melee"):
    """A standard soldier body. build scales the bulk (1 = normal soldier, 1.4 = brute)."""
    humanoid.skeleton(m, height=height, shoulders=0.25 * build, hips=0.12 * build, leg_len=0.95, arm_len=1.05, hunch=hunch, arm_spread=0.35, knee_bend=0.25, elbow_bend=0.6)
    b = build
    c.torso(m, front=s.body, back=s.body, waist=(0.36 * b, 0.26 * b), belly=(0.42 * b, 0.3 * b), chest=(0.56 * b, 0.36 * b), shoulders=(0.62 * b, 0.36 * b), neck=(0.24, 0.2), hump=b > 1.1)
    c.head(m, face=s.face, back=s.face, size=(0.23, 0.23, 0.26), ears=None)
    for side in ("L", "R"):
        c.arm(m, side, skin=s.arm, fore=s.arm, band=s.team if team_belt else None, upper=(0.24 * b, 0.21 * b, 0.16 * b, 0.13 * b), forearm=(0.13 * b, 0.17 * b, 0.15 * b, 0.12 * b), bracer=False)
        if not robe:
            c.leg(m, side, thigh_slot=s.legs, shin_slot=s.legs, foot_slot=s.foot_hand, thigh=(0.2 * b, 0.21 * b, 0.14 * b), shin=(0.13 * b, 0.14 * b, 0.1 * b), band=None, foot_sub=FOOT)
    for side in fists:
        c.fist(m, side, slot=s.foot_hand, size=0.065 * b, sub=HAND)
    if team_shoulders:
        for side in ("L", "R"):
            c.shoulder_pad(m, side, slot=s.team, size=0.6 * b, spikes=0)
    c.belt(m, slot=s.body, size=(0.4 * b, 0.3 * b), height=0.08)
    if robe:
        hz = m.joints["hips"][2]
        m.part("loft", 1, profile=[(0, 0.0, hz + 0.02, 0.4 * b, 0.3 * b), (0, 0.01, hz - 0.35, 0.5 * b, 0.42 * b), (0, 0.02, 0.02, 0.66 * b, 0.56 * b)], slot=s.legs, uv="wrap", tint=c.W, bone="hips", segments=8, smooth=c.FACET)
    if hood:
        hx, hy, hz2 = m.joints["head"]
        m.part("loft", 1, profile=[(0, hy + 0.03, hz2 - 0.06, 0.3, 0.3), (0, hy + 0.03, hz2 + 0.1, 0.32, 0.32), (0, hy + 0.07, hz2 + 0.26, 0.2, 0.2), (0, hy + 0.16, hz2 + 0.3, 0.02, 0.02)],
               slot=s.team, uv="front", back=s.team, tint=c.W, bone="head", segments=6, smooth=c.FACET)
    humanoid.animations(m, style=style, weight=1.0 + (b - 1) * 0.8)
