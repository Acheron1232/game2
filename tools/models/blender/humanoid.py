"""Humanoid skeleton + standard animations, shared by most heroes, units and monsters.

Clip keys use this convention (kit.Model.action converts it to Blender's bone axes):
limbs (bones pointing down): +X swings them forward; spine bones (pointing up): +X leans back.
The model faces -Y in Blender (+Z in the game).
"""

from kit import Model

# Standard clip names. The game looks these up by name.
CLIPS = ["idle", "walk", "attack", "attack2", "cast", "hit", "death", "victory"]


def skeleton(m: Model, height=1.8, shoulders=0.24, hips=0.11, arm_len=1.0, leg_len=1.0, hunch=0.0, arm_spread=0.0, knee_bend=0.0, elbow_bend=0.0):
    """Adds the humanoid rig to model m. Proportions are for a 1.8 m figure, scaled by height.
    hunch 0..1: heroic forward lean (chest and head forward, head lower), like big RTS heroes.
    arm_spread 0..1: arms held away from the body (wide, strong stance).
    knee_bend 0..1: knees a bit bent and forward.
    elbow_bend 0..1: forearms come forward (ready to hold a weapon) instead of hanging straight."""
    k = height / 1.8
    hip_z = 0.95 * k * leg_len
    chest_top = hip_z + 0.6 * k - 0.05 * k * hunch
    sh = chest_top - 0.06 * k
    a = arm_len * k
    fwd = -0.1 * k * hunch  # forward is -Y

    def P(x, y, z):
        return (x, y, z)

    knee_z = hip_z * 0.52
    knee_y = -0.06 * k * knee_bend
    bones = {
        "root": (P(0, 0, 0), P(0, 0, 0.2 * k), None),
        "hips": (P(0, 0, hip_z), P(0, fwd * 0.2, hip_z + 0.15 * k), "root"),
        "spine": (P(0, fwd * 0.2, hip_z + 0.15 * k), P(0, fwd * 0.5, hip_z + 0.38 * k), "hips"),
        "chest": (P(0, fwd * 0.5, hip_z + 0.38 * k), P(0, fwd, chest_top), "spine"),
        "neck": (P(0, fwd, chest_top), P(0, fwd * 1.5, chest_top + 0.08 * k), "chest"),
        "head": (P(0, fwd * 1.5, chest_top + 0.08 * k), P(0, fwd * 1.7, chest_top + 0.33 * k), "neck"),
    }
    for side, sx in (("L", 1), ("R", -1)):
        x = shoulders * k * sx
        ex = x * (1.12 + 0.35 * arm_spread)
        hx = x * (1.2 + 0.55 * arm_spread)
        bones[f"upper_arm.{side}"] = (P(x, fwd, sh), P(ex, fwd - 0.02 * k, sh - 0.3 * a), "chest")
        ey, ez = fwd - 0.02 * k, sh - 0.3 * a
        wy = ey - (0.06 + 0.2 * elbow_bend) * k
        wz = ez - (0.26 - 0.1 * elbow_bend) * a
        bones[f"forearm.{side}"] = (P(ex, ey, ez), P(hx, wy, wz), f"upper_arm.{side}")
        # The hand continues the forearm direction a little
        bones[f"hand.{side}"] = (P(hx, wy, wz), P(hx + (hx - ex) * 0.35, wy + (wy - ey) * 0.45, wz + (wz - ez) * 0.45), f"forearm.{side}")
        hpx = hips * k * sx
        bones[f"thigh.{side}"] = (P(hpx, 0, hip_z), P(hpx * 1.15, knee_y, knee_z), "hips")
        bones[f"shin.{side}"] = (P(hpx * 1.15, knee_y, knee_z), P(hpx * 1.2, 0.01 * k, 0.09 * k), f"thigh.{side}")
        bones[f"foot.{side}"] = (P(hpx * 1.2, 0.01 * k, 0.09 * k), P(hpx * 1.2, -0.16 * k, 0.03 * k), f"shin.{side}")
    # Weapon bone sits in the right hand, so weapons can be swapped or swung with the hand.
    hand = bones["hand.R"][0]
    bones["weapon"] = (hand, (hand[0], hand[1] - 0.2 * k, hand[2]), "hand.R")
    m.skeleton(bones)
    m.joints = {name: head for name, (head, tail, parent) in bones.items()}
    m.tails = {name: tail for name, (head, tail, parent) in bones.items()}
    m.height = height
    return bones


def animations(m: Model, style="melee", weight=1.0):
    """Standard clips. style: melee (big swings), caster (spell poses), ranged (bow pull).
    weight > 1 makes moves slower and heavier."""
    h = m.height
    bob = 0.025 * h

    def T(f):  # stretch timing for heavy figures
        return max(1, round(f * weight))

    # idle: slow breathing, arms sway a little
    m.action("idle", T(60), {
        "chest": [(1, (0, 0, 0)), (T(30), (-3, 0, 0)), (T(60), (0, 0, 0))],
        "upper_arm.L": [(1, (0, 0, 4)), (T(30), (3, 0, 6)), (T(60), (0, 0, 4))],
        "upper_arm.R": [(1, (0, 0, -4)), (T(30), (3, 0, -6)), (T(60), (0, 0, -4))],
        "head": [(1, (0, 0, 0)), (T(30), (3, 0, 2)), (T(60), (0, 0, 0))],
    })

    # walk: one full step cycle
    L = T(28)
    q = [1, T(8), T(15), T(22), L]
    m.action("walk", L, {
        "hips": [(q[0], (0, 0, 4), (0, 0, 0)), (q[1], (0, 0, 0), (0, 0, bob)), (q[2], (0, 0, -4), (0, 0, 0)), (q[3], (0, 0, 0), (0, 0, bob)), (q[4], (0, 0, 4), (0, 0, 0))],
        "spine": [(1, (-6, 0, 0)), (L, (-6, 0, 0))],
        "thigh.L": [(q[0], (28, 0, 0)), (q[2], (-26, 0, 0)), (q[4], (28, 0, 0))],
        "thigh.R": [(q[0], (-26, 0, 0)), (q[2], (28, 0, 0)), (q[4], (-26, 0, 0))],
        "shin.L": [(q[0], (-10, 0, 0)), (q[1], (-45, 0, 0)), (q[2], (-6, 0, 0)), (q[3], (-12, 0, 0)), (q[4], (-10, 0, 0))],
        "shin.R": [(q[0], (-6, 0, 0)), (q[1], (-12, 0, 0)), (q[2], (-10, 0, 0)), (q[3], (-45, 0, 0)), (q[4], (-6, 0, 0))],
        "upper_arm.L": [(q[0], (-24, 0, 5)), (q[2], (24, 0, 5)), (q[4], (-24, 0, 5))],
        "upper_arm.R": [(q[0], (24, 0, -5)), (q[2], (-24, 0, -5)), (q[4], (24, 0, -5))],
        "forearm.L": [(1, (20, 0, 0)), (L, (20, 0, 0))],
        "forearm.R": [(1, (20, 0, 0)), (L, (20, 0, 0))],
    })

    if style == "ranged":
        # Bow: left arm forward holding the bow, right arm pulls back and releases.
        atk = {
            "chest": [(1, (0, 0, 0)), (T(10), (0, 0, 30)), (T(18), (0, 0, 30)), (T(28), (0, 0, 0))],
            "upper_arm.L": [(1, (0, 0, 0)), (T(10), (85, 0, 20)), (T(20), (85, 0, 20)), (T(28), (0, 0, 0))],
            "upper_arm.R": [(1, (0, 0, 0)), (T(10), (80, 0, -10)), (T(16), (85, 0, -40)), (T(18), (80, 0, -5)), (T(28), (0, 0, 0))],
            "forearm.R": [(1, (0, 0, 0)), (T(16), (100, 0, 0)), (T(18), (20, 0, 0)), (T(28), (0, 0, 0))],
        }
        atk2 = atk
    elif style == "caster":
        # Staff thrust forward, then a two-handed push.
        atk = {
            "chest": [(1, (0, 0, 0)), (T(8), (6, 0, -12)), (T(14), (-10, 0, 10)), (T(26), (0, 0, 0))],
            "upper_arm.R": [(1, (0, 0, 0)), (T(8), (40, 0, 10)), (T(14), (80, 0, -10)), (T(26), (0, 0, 0))],
            "forearm.R": [(1, (0, 0, 0)), (T(8), (60, 0, 0)), (T(14), (10, 0, 0)), (T(26), (0, 0, 0))],
        }
        atk2 = {
            "chest": [(1, (0, 0, 0)), (T(10), (8, 0, 0)), (T(16), (-12, 0, 0)), (T(28), (0, 0, 0))],
            "upper_arm.L": [(1, (0, 0, 0)), (T(10), (40, 0, 20)), (T(16), (85, 0, 10)), (T(28), (0, 0, 0))],
            "upper_arm.R": [(1, (0, 0, 0)), (T(10), (40, 0, -20)), (T(16), (85, 0, -10)), (T(28), (0, 0, 0))],
        }
    else:
        # Melee: big overhead chop with the right arm, then a side sweep.
        atk = {
            "chest": [(1, (0, 0, 0)), (T(10), (10, 0, -25)), (T(15), (-18, 0, 20)), (T(28), (0, 0, 0))],
            "upper_arm.R": [(1, (0, 0, 0)), (T(10), (150, 0, -10)), (T(15), (40, 0, 10)), (T(28), (0, 0, 0))],
            "forearm.R": [(1, (0, 0, 0)), (T(10), (40, 0, 0)), (T(15), (5, 0, 0)), (T(28), (0, 0, 0))],
            "upper_arm.L": [(1, (0, 0, 0)), (T(10), (30, 0, 15)), (T(15), (-20, 0, 10)), (T(28), (0, 0, 0))],
        }
        atk2 = {
            "chest": [(1, (0, 0, 0)), (T(10), (0, 0, 40)), (T(16), (0, 0, -45)), (T(28), (0, 0, 0))],
            "upper_arm.R": [(1, (0, 0, 0)), (T(10), (70, 0, -60)), (T(16), (75, 0, 30)), (T(28), (0, 0, 0))],
            "upper_arm.L": [(1, (0, 0, 0)), (T(10), (40, 0, 30)), (T(16), (60, 0, 0)), (T(28), (0, 0, 0))],
            "thigh.L": [(1, (0, 0, 0)), (T(16), (15, 0, 0)), (T(28), (0, 0, 0))],
        }
    m.action("attack", T(28), atk, loop=False)
    m.action("attack2", T(28), atk2, loop=False)

    # cast: both arms up and forward, hold, release
    m.action("cast", T(36), {
        "chest": [(1, (0, 0, 0)), (T(12), (12, 0, 0)), (T(24), (-8, 0, 0)), (T(36), (0, 0, 0))],
        "upper_arm.L": [(1, (0, 0, 0)), (T(12), (130, 0, 25)), (T(24), (100, 0, 30)), (T(36), (0, 0, 0))],
        "upper_arm.R": [(1, (0, 0, 0)), (T(12), (130, 0, -25)), (T(24), (100, 0, -30)), (T(36), (0, 0, 0))],
        "head": [(1, (0, 0, 0)), (T(12), (12, 0, 0)), (T(36), (0, 0, 0))],
    }, loop=False)

    # hit: knocked back a little
    m.action("hit", T(12), {
        "spine": [(1, (0, 0, 0)), (T(4), (16, 0, 0)), (T(12), (0, 0, 0))],
        "head": [(1, (0, 0, 0)), (T(4), (14, 0, 0)), (T(12), (0, 0, 0))],
        "upper_arm.L": [(1, (0, 0, 0)), (T(4), (-15, 0, 25)), (T(12), (0, 0, 0))],
        "upper_arm.R": [(1, (0, 0, 0)), (T(4), (-15, 0, -25)), (T(12), (0, 0, 0))],
    }, loop=False)

    # death: knees give way, fall on the back, stay down
    hz = m.joints["hips"][2]
    m.action("death", T(40), {
        "hips": [(1, (0, 0, 0), (0, 0, 0)), (T(14), (20, 0, 0), (0, 0, -0.25 * hz)), (T(30), (85, 0, 0), (0, 0, -0.8 * hz)), (T(40), (90, 0, 0), (0, 0, -0.85 * hz))],
        "thigh.L": [(1, (0, 0, 0)), (T(14), (50, 0, 0)), (T(30), (20, 0, 0)), (T(40), (15, 0, 0))],
        "thigh.R": [(1, (0, 0, 0)), (T(14), (40, 0, 0)), (T(30), (30, 0, 0)), (T(40), (25, 0, 0))],
        "shin.L": [(1, (0, 0, 0)), (T(14), (-80, 0, 0)), (T(40), (-20, 0, 0))],
        "shin.R": [(1, (0, 0, 0)), (T(14), (-70, 0, 0)), (T(40), (-30, 0, 0))],
        "upper_arm.L": [(1, (0, 0, 0)), (T(20), (-60, 0, 40)), (T(40), (-80, 0, 60))],
        "upper_arm.R": [(1, (0, 0, 0)), (T(20), (-60, 0, -40)), (T(40), (-80, 0, -60))],
        "head": [(1, (0, 0, 0)), (T(30), (20, 0, 10)), (T(40), (25, 0, 15))],
    }, loop=False)

    # victory: raise the weapon arm, other fist pumps
    m.action("victory", T(48), {
        "upper_arm.R": [(1, (0, 0, 0)), (T(12), (170, 0, -10)), (T(36), (170, 0, -10)), (T(48), (0, 0, 0))],
        "upper_arm.L": [(1, (0, 0, 0)), (T(12), (40, 0, 30)), (T(24), (60, 0, 30)), (T(36), (40, 0, 30)), (T(48), (0, 0, 0))],
        "chest": [(1, (0, 0, 0)), (T(12), (10, 0, 0)), (T(48), (0, 0, 0))],
        "head": [(1, (0, 0, 0)), (T(12), (18, 0, 0)), (T(48), (0, 0, 0))],
    }, loop=False)
