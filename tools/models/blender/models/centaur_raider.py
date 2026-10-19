"""Centaur Raider — strong human upper body with war paint and braids on a powerful chestnut
horse body. Spear in the right fist, a round team shield on the back, bone ornaments, team
shoulder pads, team saddle cloth, white socks above dark hooves.
Skin cells: face, head_back, chest, back, arm, forearm, hand, legs=horse hide, shin=horse leg,
foot=hoof, belt, cloth=saddle cloth (team), shoulder=pad (team), trim=team band,
weapon_a=spear shaft, weapon_b=spear head, extra_1=shield face (team), extra_2=mane/tail hair,
extra_3=bone, extra_4=horse rump."""

import chunky as c
import humanoid
from kit import Model
from mathutils import Vector

W = "#ffffff"
UP = Vector((0, 0, 1))
WITHERS = 1.15  # horse back height at the front


def rig(m, hy=-0.45, rider=False):
    """Human bones use humanoid names (so humanoid clips work); horse bones have their own names.
    hy = where the human waist sits along the horse (-0.45 = on the front, centaur).
    rider=True adds the horse neck and head (a knight riding a horse)."""
    hip_z = WITHERS + (0.22 if rider else 0.12)
    bones = {
        "root": ((0, 0, 0), (0, 0, 0.2), None),
        "horse": ((0, 0.55, WITHERS - 0.05), (0, -0.2, WITHERS), "root"),
        "withers": ((0, -0.2, WITHERS), (0, hy, hip_z), "horse"),
        "hips": ((0, hy, hip_z), (0, hy - 0.02, hip_z + 0.15), "withers"),
        "spine": ((0, hy - 0.02, hip_z + 0.15), (0, hy - 0.05, hip_z + 0.38), "hips"),
        "chest": ((0, hy - 0.05, hip_z + 0.38), (0, hy - 0.1, hip_z + 0.62), "spine"),
        "neck": ((0, hy - 0.1, hip_z + 0.62), (0, hy - 0.14, hip_z + 0.7), "chest"),
        "head": ((0, hy - 0.14, hip_z + 0.7), (0, hy - 0.16, hip_z + 0.95), "neck"),
        "tail": ((0, 0.75, WITHERS - 0.05), (0, 1.15, WITHERS - 0.45), "horse"),
    }
    if rider:
        bones["horse_neck"] = ((0, -0.5, WITHERS - 0.05), (0, -0.8, WITHERS + 0.45), "horse")
        bones["horse_head"] = ((0, -0.8, WITHERS + 0.45), (0, -1.25, WITHERS + 0.15), "horse_neck")
    sh = hip_z + 0.56
    for s, x in (("L", 0.3), ("R", -0.3)):
        bones[f"upper_arm.{s}"] = ((x, hy - 0.1, sh), (x * 1.3, hy - 0.14, sh - 0.33), "chest")
        bones[f"forearm.{s}"] = ((x * 1.3, hy - 0.14, sh - 0.33), (x * 1.45, hy - 0.4, sh - 0.48), f"upper_arm.{s}")
        bones[f"hand.{s}"] = ((x * 1.45, hy - 0.4, sh - 0.48), (x * 1.5, hy - 0.52, sh - 0.52), f"forearm.{s}")
        lx = 0.2 if s == "L" else -0.2
        # Front leg: shoulder -> knee (straight down), knee -> hoof.
        bones[f"front_upper.{s}"] = ((lx, -0.38, WITHERS - 0.25), (lx, -0.36, 0.52), "withers")
        bones[f"front_lower.{s}"] = ((lx, -0.36, 0.52), (lx, -0.4, 0.08), f"front_upper.{s}")
        # Hind leg: hip -> hock (down and back), hock -> hoof (down and a bit forward), like a real horse
        bones[f"back_upper.{s}"] = ((lx, 0.62, WITHERS - 0.2), (lx, 0.82, 0.5), "horse")
        bones[f"back_lower.{s}"] = ((lx, 0.82, 0.5), (lx, 0.72, 0.08), f"back_upper.{s}")
    hand = bones["hand.R"][0]
    bones["weapon"] = (hand, (hand[0], hand[1] - 0.2, hand[2]), "hand.R")
    m.skeleton(bones)
    m.joints = {n: h for n, (h, t, p) in bones.items()}
    m.tails = {n: t for n, (h, t, p) in bones.items()}
    m.height = hip_z + 0.95


def animations(m, style="melee"):
    """Humanoid upper-body clips merged with horse leg cycles."""
    clips = {}
    real_action = m.action
    m.action = lambda name, length, keys, loop=True: clips.setdefault(name, [length, {}, loop])[1].update(keys)
    humanoid.animations(m, style=style)
    m.action = real_action
    L = 24
    trot = {}
    for name, ph in (("front_upper.L", 0), ("back_upper.R", 0), ("front_upper.R", 1), ("back_upper.L", 1)):
        a, b = (24, -22) if ph == 0 else (-22, 24)
        trot[name] = [(1, (a, 0, 0)), (12, (b, 0, 0)), (L, (a, 0, 0))]
    for name, ph in (("front_lower.L", 0), ("back_lower.R", 0), ("front_lower.R", 1), ("back_lower.L", 1)):
        k = 6 if ph == 0 else 18
        trot[name] = [(1, (0, 0, 0)), (k, (-45 if name.startswith("front") else 35, 0, 0)), (L, (0, 0, 0))]
    trot["horse"] = [(1, (0, 0, 0), (0, 0, 0)), (6, (0, 0, 0), (0, 0, 0.05)), (12, (0, 0, 0), (0, 0, 0)), (18, (0, 0, 0), (0, 0, 0.05)), (L, (0, 0, 0), (0, 0, 0))]
    trot["tail"] = [(1, (0, 0, 12)), (12, (0, 0, -12)), (L, (0, 0, 12))]
    clips["walk"][0] = L
    # Human walk keys move the legs we do not have; keep only the upper body ones and add the trot
    clips["walk"][1] = {k: v for k, v in clips["walk"][1].items() if k in ("spine", "chest", "upper_arm.L", "upper_arm.R", "forearm.L", "forearm.R", "head")} | trot
    clips["idle"][1]["tail"] = [(1, (0, 0, 10)), (30, (0, 0, -10)), (60, (0, 0, 10))]
    clips["idle"][1]["horse_neck"] = [(1, (0, 0, 0)), (30, (6, 0, 4)), (60, (0, 0, 0))]
    trot["horse_neck"] = [(1, (4, 0, 0)), (12, (-4, 0, 0)), (L, (4, 0, 0))]
    clips["victory"][1]["withers"] = [(1, (0, 0, 0)), (12, (-25, 0, 0)), (36, (-25, 0, 0)), (48, (0, 0, 0))]
    clips["victory"][1]["front_upper.L"] = [(1, (0, 0, 0)), (12, (-60, 0, 0)), (36, (-60, 0, 0)), (48, (0, 0, 0))]
    clips["victory"][1]["front_upper.R"] = [(1, (0, 0, 0)), (12, (-50, 0, 0)), (36, (-50, 0, 0)), (48, (0, 0, 0))]
    z = WITHERS
    clips["death"][1] = {"horse": [(1, (0, 0, 0), (0, 0, 0)), (16, (0, 25, 0), (0, 0, -z * 0.3)), (34, (0, 85, 0), (0, 0, -z * 0.65)), (40, (0, 90, 0), (0, 0, -z * 0.68))],
                         "chest": [(1, (0, 0, 0)), (40, (30, 0, 20))], "upper_arm.L": [(1, (0, 0, 0)), (40, (-70, 0, 50))]}
    for name, (length, keys, loop) in clips.items():
        m.action(name, length, keys, loop)


def build():
    m = Model("centaur_raider", skin="centaur_raider_skin")
    rig(m)
    j, t = m.joints, m.tails

    # ---- Horse body: deep round chest, slimmer belly, big round rump
    Z = WITHERS
    hb = [(0, 1.0, Z - 0.2, 0.3, 0.32), (0, 0.88, Z - 0.05, 0.56, 0.62), (0, 0.62, Z - 0.02, 0.68, 0.72), (0, 0.3, Z - 0.1, 0.6, 0.62),
          (0, -0.05, Z - 0.12, 0.62, 0.66), (0, -0.38, Z - 0.05, 0.66, 0.78), (0, -0.58, Z + 0.05, 0.5, 0.62)]
    m.part("loft", 1, profile=hb, slot="legs", uv="wrap", tint=W, bone="horse", segments=8, smooth=36)
    # Haunches: rounded muscle over the hind legs
    for sx in (1, -1):
        c.blob(m, (sx * 0.24, 0.66, Z - 0.12), 0.26, "extra_4", "horse", squash=(0.75, 1.2, 1.1), uv="front")
        c.blob(m, (sx * 0.23, -0.35, Z - 0.2), 0.2, "legs", "withers", squash=(0.75, 1.0, 1.2))
    # Saddle cloth (team) hanging over the back, with a fringe line
    m.part("loft", 1, profile=[(0, 0.45, Z + 0.32, 0.62, 0.04), (0, 0.1, Z + 0.27, 0.66, 0.04), (0, -0.2, Z + 0.3, 0.6, 0.04)], slot="cloth", uv="top", tint=W, bone="horse", segments=4, smooth=c.FACET)
    for sx in (1, -1):
        m.part("loft", 1, profile=[(sx * 0.33, 0.4, Z + 0.25, 0.03, 0.42), (sx * 0.36, 0.1, Z - 0.1, 0.03, 0.46), (sx * 0.34, -0.15, Z + 0.22, 0.03, 0.3)], slot="cloth", uv="front", tint=W, bone="horse", segments=4, smooth=c.FACET)

    # ---- Horse legs: thick upper, knee / hock, thin cannon with a white sock, fetlock, hoof
    for sd in ("L", "R"):
        for part, r in (("front", 0.15), ("back", 0.17)):
            u0, u1, l1 = Vector(j[f"{part}_upper.{sd}"]), Vector(t[f"{part}_upper.{sd}"]), Vector(t[f"{part}_lower.{sd}"])
            upper = [(0, r * 2.0, r * 2.4), (0.45, r * 1.35, r * 1.6), (1, r * 0.75, r * 0.95)] if part == "back" else [(0, r * 1.7, r * 2.0), (0.6, r * 1.1, r * 1.25), (1, r * 0.8, r * 0.9)]
            c.limb(m, tuple(u0), tuple(u1), upper, slot="legs", uv="wrap", bone=f"{part}_upper.{sd}", segments=6)
            c.blob(m, tuple(u1), r * 0.55, "legs", f"{part}_lower.{sd}")
            c.limb(m, tuple(u1), tuple(l1), [(0, r * 0.7, r * 0.8), (0.55, r * 0.55, r * 0.62), (0.85, r * 0.72, r * 0.8), (1, r * 0.66, r * 0.72)], slot="shin", uv="wrap", bone=f"{part}_lower.{sd}", segments=6)
            x, y, _ = l1
            m.part("hull", 1, profile=[(x - 0.08, y + 0.06, 0), (x + 0.08, y + 0.06, 0), (x - 0.09, y - 0.11, 0), (x + 0.09, y - 0.11, 0), (x - 0.065, y + 0.05, 0.12), (x + 0.065, y + 0.05, 0.12), (x - 0.07, y - 0.05, 0.11), (x + 0.07, y - 0.05, 0.11)],
                   slot="foot", uv="front", tint=W, bone=f"{part}_lower.{sd}", smooth=c.FACET)
    # Long flowing tail
    tb, te = Vector(j["tail"]), Vector(t["tail"])
    c.limb(m, tuple(tb + Vector((0, 0.05, 0.05))), tuple(te + Vector((0, 0.05, -0.15))), [(0, 0.12, 0.1), (0.4, 0.24, 0.18), (1, 0.06, 0.05)], slot="extra_2", uv="wrap", bone="tail", segments=5)

    # ---- Human upper body (humanoid kit pieces)
    c.torso(m, waist=(0.52, 0.5), belly=(0.56, 0.46), chest=(0.78, 0.46), shoulders=(0.9, 0.44), neck=(0.34, 0.28), hump=True)
    c.head(m, size=(0.25, 0.25, 0.27))
    hx, hy, hzz = j["head"]
    for sx in (1, -1):  # braids hanging down the front
        c.limb(m, (sx * 0.12, hy - 0.02, hzz + 0.08), (sx * 0.16, hy - 0.06, hzz - 0.35), [(0, 0.06, 0.06), (1, 0.04, 0.04)], slot="extra_2", sub=(0.75, 0.95, 0, 1), uv="wrap", bone="head", segments=4)
    for side in ("L", "R"):
        c.arm(m, side, upper=(0.32, 0.28, 0.2, 0.15), forearm=(0.15, 0.22, 0.19, 0.14))
    c.shoulder_pad(m, "L", slot="shoulder", size=0.85, spikes=2, spike_slot="extra_3")
    c.shoulder_pad(m, "R", slot="shoulder", size=0.75, spikes=1, spike_slot="extra_3")
    c.beads(m, count=7, slot="extra_3", sub=(0.2, 0.8, 0.2, 0.8), tint=W, width=0.42, drop=0.24, r=0.04)
    c.belt(m, slot="belt", size=(0.56, 0.46), height=0.1)
    # Round team shield on the back
    top, fy = j["neck"][2], j["neck"][1]
    m.part("cylinder", (0.62, 0.62, 0.07), at=(0, fy + 0.27, top - 0.3), rot=(80, 0, 0), slot="extra_1", uv="front", back="extra_1", tint=W, bone="chest", segments=12, smooth=c.FACET)

    # ---- Spear through the right fist, pointing forward and up; left fist closed
    g = Vector(c.grip_point(m, "R"))
    axis = Vector((0, -0.45, 1)).normalized()
    c.fist(m, "R", grip_axis=tuple(axis))
    c.fist(m, "L")
    a, b = g - axis * 1.0, g + axis * 1.3
    c.limb(m, tuple(a), tuple(b), [(0, 0.07, 0.07), (1, 0.065, 0.065)], slot="weapon_a", uv="wrap", sub=(0.35, 0.65, 0, 1), bone="weapon", segments=5)
    side_ax = axis.cross(Vector((1, 0, 0))).normalized()
    c.frame_hull(m, b, (Vector((1, 0, 0)), side_ax, axis), [(-0.11, 0, 0), (0.11, 0, 0), (0, 0.02, 0.38), (-0.06, 0, 0.12), (0.06, 0, 0.12), (0, 0.03, 0.05), (0, -0.03, 0.05)], slot="weapon_b", uv="front", bone="weapon")
    m.part("loft", 1, profile=[(*(b - axis * 0.12), 0.1, 0.02), (*(b - axis * 0.3 + Vector((0.08, 0, 0))), 0.08, 0.02)], slot="weapon_a", sub=(0.0, 0.3, 0.3, 0.9), tint=W, bone="weapon", segments=4, smooth=c.FACET)

    m.socket("hooves", (0, 0.1, 0.05), "root")
    m.socket("spear", tuple(b + axis * 0.25), "weapon")
    m.socket("chest", (0, j["chest"][1] - 0.2, j["chest"][2] + 0.05), "chest")
    animations(m)
    return m
