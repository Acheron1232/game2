"""Non-humanoid rigs and their animations: four-legged beasts (wolf, horse body, spider-like
crawlers use the same idea with more legs), the dragon (body + wings + neck + tail) and birds.

Clip names match the humanoid ones so the game can play "walk", "attack", "death" on anything.
"""

from kit import Model


def quadruped(m: Model, length=1.4, height=0.9, neck=0.45, tail=0.6, leg_spread=0.18):
    """Body along -Y (head at -Y). height = shoulder height."""
    hip_y, sh_y = length / 2, -length / 2
    z = height
    bones = {
        "root": ((0, 0, 0), (0, 0, 0.2), None),
        "body": ((0, hip_y, z), (0, 0, z + 0.03), "root"),
        "chest": ((0, 0, z + 0.03), (0, sh_y, z + 0.05), "body"),
        "neck": ((0, sh_y, z + 0.05), (0, sh_y - neck * 0.4, z + neck * 0.85), "chest"),
        "head": ((0, sh_y - neck * 0.4, z + neck * 0.85), (0, sh_y - neck * 0.4 - 0.32, z + neck * 0.75), "neck"),
        "tail": ((0, hip_y, z), (0, hip_y + tail, z - tail * 0.3), "body"),
    }
    for side, sx in (("L", 1), ("R", -1)):
        for part, y, parent in (("front", sh_y + 0.05, "chest"), ("back", hip_y - 0.05, "body")):
            x = leg_spread * sx
            bones[f"{part}_upper.{side}"] = ((x, y, z - 0.05), (x, y + (0.04 if part == "front" else -0.06), z * 0.5), parent)
            bones[f"{part}_lower.{side}"] = ((x, y + (0.04 if part == "front" else -0.06), z * 0.5), (x, y, 0.06), f"{part}_upper.{side}")
            bones[f"{part}_foot.{side}"] = ((x, y, 0.06), (x, y - 0.1, 0.0), f"{part}_lower.{side}")
    m.skeleton(bones)
    m.joints = {n: h for n, (h, t, p) in bones.items()}
    m.tails = {n: t for n, (h, t, p) in bones.items()}
    m.height = height + neck
    return bones


def quadruped_animations(m: Model, weight=1.0):
    def T(f):
        return max(1, round(f * weight))

    L = T(24)
    q = [1, T(6), T(12), T(18), L]
    legs = {}
    # Diagonal pairs move together (trot): front L + back R, front R + back L
    for name, phase in (("front_upper.L", 0), ("back_upper.R", 0), ("front_upper.R", 1), ("back_upper.L", 1)):
        a, b = (24, -22) if phase == 0 else (-22, 24)
        legs[name] = [(q[0], (a, 0, 0)), (q[2], (b, 0, 0)), (q[4], (a, 0, 0))]
    for name, phase in (("front_lower.L", 0), ("back_lower.R", 0), ("front_lower.R", 1), ("back_lower.L", 1)):
        k = q[1] if phase == 0 else q[3]
        legs[name] = [(1, (0, 0, 0)), (k, (-40 if name.startswith("front") else 35, 0, 0)), (L, (0, 0, 0))]
    m.action("walk", L, {**legs, "body": [(1, (0, 0, 0), (0, 0, 0)), (q[1], (0, 0, 0), (0, 0, 0.03)), (q[2], (0, 0, 0), (0, 0, 0)), (q[3], (0, 0, 0), (0, 0, 0.03)), (L, (0, 0, 0), (0, 0, 0))],
                         "tail": [(1, (0, 0, 10)), (q[2], (0, 0, -10)), (L, (0, 0, 10))], "head": [(1, (4, 0, 0)), (q[2], (-4, 0, 0)), (L, (4, 0, 0))]})
    m.action("idle", T(60), {"chest": [(1, (0, 0, 0)), (T(30), (-2, 0, 0)), (T(60), (0, 0, 0))], "head": [(1, (0, 0, 0)), (T(20), (-8, 0, 12)), (T(40), (-8, 0, -12)), (T(60), (0, 0, 0))],
                             "tail": [(1, (0, 0, 8)), (T(30), (0, 0, -8)), (T(60), (0, 0, 8))]})
    m.action("attack", T(24), {"chest": [(1, (0, 0, 0)), (T(8), (12, 0, 0)), (T(13), (-10, 0, 0)), (T(24), (0, 0, 0))], "neck": [(1, (0, 0, 0)), (T(8), (20, 0, 0)), (T(13), (-35, 0, 0)), (T(24), (0, 0, 0))],
                               "head": [(1, (0, 0, 0)), (T(13), (-20, 0, 0)), (T(24), (0, 0, 0))], "front_upper.L": [(1, (0, 0, 0)), (T(8), (-30, 0, 0)), (T(13), (30, 0, 0)), (T(24), (0, 0, 0))],
                               "front_upper.R": [(1, (0, 0, 0)), (T(8), (-25, 0, 0)), (T(13), (25, 0, 0)), (T(24), (0, 0, 0))]}, loop=False)
    m.action("attack2", T(24), {"neck": [(1, (0, 0, 0)), (T(8), (0, 0, 30)), (T(14), (-20, 0, -25)), (T(24), (0, 0, 0))], "head": [(1, (0, 0, 0)), (T(14), (-25, 0, -10)), (T(24), (0, 0, 0))]}, loop=False)
    m.action("cast", T(30), {"neck": [(1, (0, 0, 0)), (T(12), (25, 0, 0)), (T(22), (-15, 0, 0)), (T(30), (0, 0, 0))], "chest": [(1, (0, 0, 0)), (T(12), (-10, 0, 0)), (T(30), (0, 0, 0))]}, loop=False)
    m.action("hit", T(12), {"body": [(1, (0, 0, 0)), (T(4), (0, 8, 0)), (T(12), (0, 0, 0))], "head": [(1, (0, 0, 0)), (T(4), (15, 0, 0)), (T(12), (0, 0, 0))]}, loop=False)
    z = m.joints["body"][2]
    m.action("death", T(36), {"body": [(1, (0, 0, 0), (0, 0, 0)), (T(14), (0, 25, 0), (0, 0, -z * 0.3)), (T(30), (0, 85, 0), (0, 0, -z * 0.7)), (T(36), (0, 90, 0), (0, 0, -z * 0.72))],
                              "neck": [(1, (0, 0, 0)), (T(30), (10, 0, 20)), (T(36), (12, 0, 25))]}, loop=False)
    m.action("victory", T(40), {"chest": [(1, (0, 0, 0)), (T(12), (-25, 0, 0)), (T(28), (-25, 0, 0)), (T(40), (0, 0, 0))], "front_upper.L": [(1, (0, 0, 0)), (T(12), (-60, 0, 0)), (T(28), (-60, 0, 0)), (T(40), (0, 0, 0))],
                                "front_upper.R": [(1, (0, 0, 0)), (T(12), (-55, 0, 0)), (T(28), (-55, 0, 0)), (T(40), (0, 0, 0))], "neck": [(1, (0, 0, 0)), (T(12), (-30, 0, 0)), (T(40), (0, 0, 0))]}, loop=False)


def dragon(m: Model, height=1.1, length=1.8, wing=1.6, neck=1.0, tail=1.6, hover=0.9):
    """Flying dragon: body hovers `hover` m above the ground, wings out to the sides."""
    z = height + hover
    by, cy = length * 0.45, -length * 0.4
    bones = {
        "root": ((0, 0, 0), (0, 0, 0.2), None),
        "body": ((0, by, z), (0, 0, z + 0.05), "root"),
        "chest": ((0, 0, z + 0.05), (0, cy, z + 0.15), "body"),
        "neck": ((0, cy, z + 0.15), (0, cy - neck * 0.45, z + neck * 0.75), "chest"),
        "head": ((0, cy - neck * 0.45, z + neck * 0.75), (0, cy - neck * 0.45 - 0.55, z + neck * 0.7), "neck"),
        "jaw": ((0, cy - neck * 0.45 - 0.08, z + neck * 0.68), (0, cy - neck * 0.45 - 0.5, z + neck * 0.6), "head"),
        "tail1": ((0, by, z), (0, by + tail * 0.5, z - 0.15), "body"),
        "tail2": ((0, by + tail * 0.5, z - 0.15), (0, by + tail, z - 0.1), "tail1"),
    }
    for side, sx in (("L", 1), ("R", -1)):
        bones[f"wing1.{side}"] = ((sx * 0.25, cy * 0.3, z + 0.25), (sx * wing * 0.45, cy * 0.2, z + 0.55), "chest")
        bones[f"wing2.{side}"] = ((sx * wing * 0.45, cy * 0.2, z + 0.55), (sx * wing, 0.2, z + 0.35), f"wing1.{side}")
        for part, y in (("front", cy + 0.1), ("back", by - 0.1)):
            x = 0.28 * sx
            parent = "chest" if part == "front" else "body"
            # Legs tucked under the body while flying: short, knees forward, claws back
            bones[f"{part}_upper.{side}"] = ((x, y, z - 0.1), (x * 1.15, y - 0.22, z - 0.42), parent)
            bones[f"{part}_lower.{side}"] = ((x * 1.15, y - 0.22, z - 0.42), (x * 1.15, y + 0.08, z - 0.62), f"{part}_upper.{side}")
    m.skeleton(bones)
    m.joints = {n: h for n, (h, t, p) in bones.items()}
    m.tails = {n: t for n, (h, t, p) in bones.items()}
    m.height = z + neck
    return bones


def dragon_animations(m: Model):
    flap = lambda a, b: {  # noqa: E731
        "wing1.L": [(1, (0, a, 0)), (10, (0, b, 0)), (20, (0, a, 0))],
        "wing1.R": [(1, (0, -a, 0)), (10, (0, -b, 0)), (20, (0, -a, 0))],
        "wing2.L": [(1, (0, a * 0.6, 0)), (12, (0, b * 0.8, 0)), (20, (0, a * 0.6, 0))],
        "wing2.R": [(1, (0, -a * 0.6, 0)), (12, (0, -b * 0.8, 0)), (20, (0, -a * 0.6, 0))],
        "body": [(1, (0, 0, 0), (0, 0, 0.12)), (10, (0, 0, 0), (0, 0, -0.08)), (20, (0, 0, 0), (0, 0, 0.12))],
    }
    tail = {"tail1": [(1, (0, 0, 8)), (10, (0, 0, -8)), (20, (0, 0, 8))], "tail2": [(1, (0, 0, 12)), (10, (0, 0, -12)), (20, (0, 0, 12))]}
    m.action("idle", 20, {**flap(-30, 30), **tail, "neck": [(1, (0, 0, 0)), (10, (-4, 0, 0)), (20, (0, 0, 0))]})
    m.action("walk", 20, {**flap(-40, 45), **tail, "chest": [(1, (8, 0, 0)), (20, (8, 0, 0))], "neck": [(1, (-10, 0, 0)), (20, (-10, 0, 0))]})
    m.action("attack", 24, {**flap(-20, 20), "neck": [(1, (0, 0, 0)), (8, (25, 0, 0)), (13, (-30, 0, 0)), (24, (0, 0, 0))], "jaw": [(1, (0, 0, 0)), (11, (0, 0, 0)), (13, (35, 0, 0)), (20, (0, 0, 0))]}, loop=False)
    m.action("attack2", 24, {**flap(-20, 20), "neck": [(1, (0, 0, 0)), (8, (10, 0, 30)), (14, (-20, 0, -30)), (24, (0, 0, 0))], "tail1": [(1, (0, 0, 0)), (14, (0, 0, 40)), (24, (0, 0, 0))]}, loop=False)
    m.action("cast", 36, {**flap(-50, 60), "neck": [(1, (0, 0, 0)), (14, (-30, 0, 0)), (24, (20, 0, 0)), (36, (0, 0, 0))], "jaw": [(1, (0, 0, 0)), (14, (40, 0, 0)), (30, (40, 0, 0)), (36, (0, 0, 0))]}, loop=False)
    m.action("hit", 12, {"body": [(1, (0, 0, 0), (0, 0, 0)), (4, (10, 0, 0), (0, 0.15, 0.1)), (12, (0, 0, 0), (0, 0, 0))], "neck": [(1, (0, 0, 0)), (4, (20, 0, 0)), (12, (0, 0, 0))]}, loop=False)
    z = m.joints["body"][2]
    m.action("death", 40, {"body": [(1, (0, 0, 0), (0, 0, 0)), (20, (0, 40, 0), (0, 0, -z * 0.5)), (36, (0, 85, 0), (0, 0, -z * 0.82)), (40, (0, 90, 0), (0, 0, -z * 0.82))],
                           "wing1.L": [(1, (0, 0, 0)), (30, (0, -60, 0)), (40, (0, -70, 0))], "wing1.R": [(1, (0, 0, 0)), (30, (0, 40, 0)), (40, (0, 50, 0))], "neck": [(1, (0, 0, 0)), (40, (30, 0, 20))]}, loop=False)
    m.action("victory", 40, {**flap(-60, 60), "neck": [(1, (0, 0, 0)), (12, (-40, 0, 0)), (30, (-40, 0, 0)), (40, (0, 0, 0))], "jaw": [(1, (0, 0, 0)), (12, (35, 0, 0)), (30, (35, 0, 0)), (40, (0, 0, 0))]}, loop=False)
