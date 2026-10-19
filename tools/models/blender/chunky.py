"""Chunky body kit: the shared parts for heroes and units in the classic RTS hero look
(angular, faceted, heroic proportions, lots of team-color bands).

Standard skin cell names (every humanoid skin sheet uses these, so parts and prompts match):
    face, head_back, chest, back, arm, forearm, hand, legs, shin, foot,
    belt, cloth (team), shoulder (team), trim (team band), weapon_a, weapon_b
Heroes also have extra_1 .. extra_4 for their own special pieces.

All sizes are in meters for a ~1.8 m figure. Every function takes the model `m` built with
humanoid.skeleton(), so joint positions come from m.joints / m.tails.
"""

import math

from mathutils import Vector

W = "#ffffff"
FACET = 28


def v(p):
    return Vector(p)


def lerp(a, b, t):
    a, b = v(a), v(b)
    return tuple(a + (b - a) * t)


def limb(m, a, b, sections, **kw):
    """Loft along a -> b. sections: [(t, width, depth)] with t from 0 (at a) to 1 (at b)."""
    prof = [(*lerp(a, b, t), w, d) for t, w, d in sections]
    kw.setdefault("smooth", FACET)
    kw.setdefault("tint", W)
    m.part("loft", 1, profile=prof, **kw)


def blob(m, center, r, slot, bone, sub=None, tint=W, squash=(1, 1, 1), uv="box"):
    """A rough low-poly ball (8-12 faces): elbows, knees, knuckles, beads."""
    cx, cy, cz = center
    pts = []
    for zc, rr, n, off in ((0.0, 1.0, 8, 0.0), (0.7, 0.68, 5, 0.3), (-0.7, 0.68, 5, 0.6)):
        for i in range(n):
            a = math.pi * 2 * (i + off) / n
            pts.append((cx + math.cos(a) * r * rr * squash[0], cy + math.sin(a) * r * rr * squash[1], cz + zc * r * squash[2]))
    pts += [(cx, cy, cz + r * squash[2]), (cx, cy, cz - r * squash[2])]
    m.part("hull", 1, profile=pts, slot=slot, sub=sub, tint=tint, bone=bone, smooth=FACET, uv=uv)


def frame_hull(m, origin, axes, points, **kw):
    """Hull from points given in a local frame (axes = (ax, ay, az) world vectors)."""
    o = v(origin)
    ax, ay, az = (v(a) for a in axes)
    pts = [tuple(o + ax * p[0] + ay * p[1] + az * p[2]) for p in points]
    kw.setdefault("smooth", FACET)
    kw.setdefault("tint", W)
    m.part("hull", 1, profile=pts, **kw)


# ---------------------------------------------------------------- body


def torso(m, front="chest", back="back", waist=(0.4, 0.3), belly=(0.5, 0.35), chest=(0.82, 0.45), shoulders=(0.96, 0.44), neck=(0.42, 0.3), hump=True):
    """Belly on the spine bone, chest on the chest bone, one front/back picture over both."""
    j = m.joints
    hz, top = j["hips"][2], j["neck"][2]
    y0 = j["hips"][1]  # the body may not stand at y = 0 (centaur, riders)
    fy = j["neck"][1]
    rel = fy - y0
    fr = (-shoulders[0] / 2, shoulders[0] / 2, hz - 0.04, top + 0.06)
    m.part("loft", 1, profile=[(0, y0, hz - 0.04, *waist), (0, y0 - 0.01, hz + 0.12, (waist[0] + belly[0]) / 2, (waist[1] + belly[1]) / 2), (0, y0 - 0.03, hz + 0.3, *belly)],
           slot=front, back=back, uv="front", frame=fr, tint=W, bone="spine", segments=6, smooth=FACET)
    m.part("loft", 1, profile=[(0, y0 - 0.03, hz + 0.28, *belly), (0, y0 + rel * 0.6, hz + 0.43, *chest), (0, y0 + rel * 0.9, top - 0.04, *shoulders), (0, fy, top + 0.06, *neck)],
           slot=front, back=back, uv="front", frame=fr, tint=W, bone="chest", segments=6, smooth=FACET)
    if hump:
        w = shoulders[0] * 0.27
        m.part("hull", 1, profile=[(-w, fy + 0.06, top - 0.02), (w, fy + 0.06, top - 0.02), (-w / 2, fy + 0.04, top + 0.12), (w / 2, fy + 0.04, top + 0.12), (0, fy + 0.15, top + 0.04), (0, fy - 0.08, top + 0.02)],
               slot=back, sub=(0.3, 0.7, 0.7, 0.95), tint=W, bone="chest", smooth=FACET)


def head(m, face="face", back="head_back", size=(0.25, 0.25, 0.27), jaw=1.0, ears="arm"):
    """Faceted head pushed forward; painted face in front, back of the head behind."""
    hx, hy, hz = m.joints["head"]
    w, d, h = size
    fr = (-w / 2 - 0.01, w / 2 + 0.01, hz - 0.05, hz - 0.05 + h)
    m.part("loft", 1, profile=[(0, hy - 0.03, hz - 0.05, w * 0.8 * jaw, d * 0.72), (0, hy - 0.02, hz + 0.03, w * 0.96, d * 0.96), (0, hy, hz + 0.13, w, d), (0, hy + 0.01, hz + 0.2, w * 0.8, d * 0.8), (0, hy + 0.01, hz - 0.05 + h, w * 0.36, d * 0.36)],
           slot=face, back=back, uv="front", frame=fr, tint=W, bone="head", segments=7, smooth=40)
    if ears:
        x = w / 2
        m.part("hull", 1, profile=[(x - 0.02, hy, hz + 0.08), (x + 0.03, hy + 0.02, hz + 0.1), (x + 0.02, hy + 0.03, hz + 0.04), (x - 0.02, hy + 0.03, hz + 0.03)],
               slot=ears, tint="#e2c0a2", bone="head", mirror=True, smooth=FACET)


def arm(m, side, skin="arm", fore="forearm", band="trim", upper=(0.34, 0.3, 0.22, 0.17), forearm=(0.17, 0.25, 0.21, 0.15), bracer=True):
    """Upper arm with a big deltoid and bicep, elbow knob, thick forearm with a bracer and a team band."""
    s, e, w = m.joints[f"upper_arm.{side}"], m.joints[f"forearm.{side}"], m.joints[f"hand.{side}"]
    u0, u1, u2, u3 = upper
    # Deltoid: a separate rounded cap makes the shoulder read big from the RTS camera
    blob(m, lerp(s, e, 0.02), u0 * 0.55, skin, f"upper_arm.{side}", squash=(1.05, 1.0, 0.85))
    limb(m, s, e, [(0.05, u0 * 0.85, u0 * 0.8), (0.3, u1, u1 * 0.92), (0.65, u2, u2 * 0.95), (1.0, u3, u3)], slot=skin, uv="wrap", bone=f"upper_arm.{side}", segments=6)
    blob(m, e, u3 * 0.62, skin, f"upper_arm.{side}")  # elbow
    f0, f1, f2, f3 = forearm
    limb(m, e, w, [(0.0, f0, f0), (0.3, f1, f1 * 0.92), (0.75, f2, f2 * 0.9), (1.0, f3, f3 * 0.9)], slot=skin if bracer else fore, uv="wrap", bone=f"forearm.{side}", segments=6)
    if bracer:
        limb(m, e, w, [(0.32, f1 * 1.08, f1), (0.55, f1 * 1.12, f1 * 1.04), (0.88, f2 * 1.12, f2 * 1.05)], slot=fore, uv="wrap", bone=f"forearm.{side}", segments=6)
    if band:
        limb(m, e, w, [(0.9, f3 * 1.25, f3 * 1.2), (1.0, f3 * 1.25, f3 * 1.2)], slot=band, uv="wrap", sub=(0, 0.6, 0.25, 0.75), bone=f"forearm.{side}", segments=6)


def grip_point(m, side):
    """Where the fist closes: a weapon held in this hand passes through this point."""
    a, b = v(m.joints[f"hand.{side}"]), v(m.tails[f"hand.{side}"])
    return tuple(a + (b - a) * 0.55)


def fist(m, side, slot="hand", size=0.11, grip_axis=(0, 0, 1), sub=None):
    """A big closed fist around the grip point. grip_axis = direction of the held shaft:
    the fingers wrap around it, the knuckles face forward and out."""
    g = v(grip_point(m, side))
    up = v(grip_axis).normalized()
    sx = 1 if side == "L" else -1
    out = Vector((sx, -0.6, 0)).normalized()  # knuckles: forward and to the outside
    out = (out - up * out.dot(up)).normalized()
    third = up.cross(out).normalized()
    s = size
    pts = []
    # Rounded main block: three rings of 8 points (fingers wrapped around the shaft)
    for zc, rr in ((-0.85, 0.78), (0.0, 1.0), (0.85, 0.82)):
        for i in range(8):
            a = 2 * math.pi * (i + 0.5) / 8
            pts.append((math.cos(a) * s * rr, math.sin(a) * s * rr * (1.12 if math.sin(a) > 0 else 0.78), zc * s))
    frame_hull(m, g, (third, out, up), pts, slot=slot, sub=sub, uv="front", back=slot, bone=f"hand.{side}")
    # Knuckles: four bumps along the front
    for k in range(4):
        z = (k - 1.5) * s * 0.42
        kp = g + out * s * 1.08 + up * z
        blob(m, tuple(kp), s * 0.24, slot, f"hand.{side}", sub=sub or (0.3, 0.7, 0.6, 0.95))
    # Thumb across the front
    frame_hull(m, g, (third, out, up), [(-s * 0.2, s * 0.9, s * 0.9), (s * 0.7, s * 0.9, s * 0.95), (s * 0.7, s * 0.5, s * 1.1), (-s * 0.1, s * 0.4, s * 1.05), (s * 0.3, s * 0.8, s * 1.2)],
               slot=slot, sub=sub or (0.4, 0.9, 0.4, 0.9), bone=f"hand.{side}")


def open_hand(m, side, slot="hand", size=0.1):
    """An open spell hand: palm block and four chunky fingers spread a little, plus a thumb."""
    a, b = v(m.joints[f"hand.{side}"]), v(m.tails[f"hand.{side}"])
    d = (b - a).normalized()
    sx = 1 if side == "L" else -1
    side_ax = Vector((sx, 0, 0))
    side_ax = (side_ax - d * side_ax.dot(d)).normalized()
    normal = d.cross(side_ax).normalized()
    s = size
    frame_hull(m, a, (side_ax, normal, d), [(x * s * 0.8, y * s * 0.35, z * s) for x in (-1, 1) for y in (-1, 1) for z in (0.1, 1.0)], slot=slot, bone=f"hand.{side}")
    for i, off in enumerate((-0.6, -0.2, 0.2, 0.6)):
        ln = s * (0.9 if i in (1, 2) else 0.75)
        spread = off * 0.35
        base = a + d * s * 1.0 + side_ax * off * s
        tip_dir = (d + side_ax * spread).normalized()
        limb(m, tuple(base), tuple(base + tip_dir * ln), [(0, s * 0.3, s * 0.28), (0.6, s * 0.27, s * 0.25), (1, s * 0.14, s * 0.14)], slot=slot, bone=f"hand.{side}", segments=4)
    tb = a + d * s * 0.4 - side_ax * s * 0.8
    limb(m, tuple(tb), tuple(tb - side_ax * s * 0.5 + d * s * 0.4), [(0, s * 0.32, s * 0.3), (1, s * 0.16, s * 0.16)], slot=slot, bone=f"hand.{side}", segments=4)


def leg(m, side, thigh_slot="legs", shin_slot="shin", foot_slot="foot", thigh=(0.27, 0.29, 0.18), shin=(0.17, 0.18, 0.12), band="trim", boot=1.0, foot_sub=None):
    """Thick thigh, knee knob, shin with an optional team band, big angular foot or boot."""
    t, k, f = m.joints[f"thigh.{side}"], m.joints[f"shin.{side}"], m.joints[f"foot.{side}"]
    a0, a1, a2 = thigh
    limb(m, t, k, [(-0.05, a0, a0), (0.4, a1, a1 * 0.97), (1.0, a2, a2)], slot=thigh_slot, uv="wrap", bone=f"thigh.{side}", segments=6)
    blob(m, k, a2 * 0.6, thigh_slot, f"shin.{side}")
    b0, b1, b2 = shin
    limb(m, k, f, [(0.0, b0, b0), (0.3, b1, b1 * 0.95), (1.0, b2 * boot, b2 * boot)], slot=shin_slot, uv="wrap", bone=f"shin.{side}", segments=6)
    if band:
        limb(m, k, f, [(0.04, b0 * 1.2, b0 * 1.2), (0.16, b0 * 1.2, b0 * 1.2)], slot=band, uv="wrap", sub=(0, 0.6, 0.3, 0.7), bone=f"shin.{side}", segments=6)
    x, y, z = f
    w = 0.1 * boot
    m.part("hull", 1, profile=[(x - w * 0.9, y + 0.09, 0.0), (x + w * 0.9, y + 0.09, 0.0), (x - w * 1.1, y - 0.25, 0.0), (x + w * 1.1, y - 0.25, 0.0),
                               (x - w * 0.75, y + 0.06, z + 0.05), (x + w * 0.75, y + 0.06, z + 0.05), (x - w * 0.8, y - 0.2, 0.08), (x + w * 0.8, y - 0.2, 0.08)],
           slot=foot_slot, sub=foot_sub, uv="top", tint=W, bone=f"foot.{side}", smooth=FACET)


def belt(m, slot="belt", size=(0.52, 0.38), height=0.12):
    _, y0, hz = m.joints["hips"]
    m.part("loft", 1, profile=[(0, y0, hz - 0.02, *size), (0, y0, hz - 0.02 + height, size[0] * 1.02, size[1])], slot=slot, uv="wrap", tint=W, bone="hips", segments=8)


def loincloth(m, slot="cloth", front=True, back=True, length=0.46, width=0.27):
    hz = m.joints["hips"][2]
    if front:
        m.part("loft", 1, profile=[(0, -0.2, hz + 0.02, width, 0.04), (0, -0.23, hz - length * 0.5, width * 1.08, 0.04), (0, -0.2, hz - length, width * 0.85, 0.03)], slot=slot, uv="front", tint=W, bone="hips", segments=4, smooth=FACET)
    if back:
        m.part("loft", 1, profile=[(0, 0.2, hz + 0.02, width * 1.1, 0.04), (0, 0.23, hz - length * 0.45, width * 1.1, 0.04), (0, 0.2, hz - length * 0.82, width * 0.9, 0.03)], slot=slot, uv="front", tint="#d8d8d8", bone="hips", segments=4, smooth=FACET)


def shoulder_pad(m, side, slot="shoulder", size=1.0, spikes=2, spike_slot="weapon_b", spike_sub=None):
    """Big angular pad over the shoulder with optional spikes."""
    x, y, z = m.joints[f"upper_arm.{side}"]
    sx = 1 if side == "L" else -1
    k = size
    pts = [(-0.1, -0.2, 0.02), (0.24, -0.18, -0.05), (-0.1, 0.2, 0.02), (0.24, 0.18, -0.05), (0.02, 0, 0.16), (0.16, 0, 0.1), (0.3, 0, -0.12), (-0.12, 0, -0.02)]
    m.part("hull", 1, profile=[(x + sx * px * k, y + py * k, z + pz * k) for px, py, pz in pts], slot=slot, uv="top", tint=W, bone=f"upper_arm.{side}", smooth=FACET)
    for i in range(spikes):
        dy = (i - (spikes - 1) / 2) * 0.16 * k
        bx, by, bz = x + sx * 0.06 * k, y + dy, z + 0.1 * k
        m.part("loft", 1, profile=[(bx, by, bz, 0.09 * k, 0.09 * k), (bx + sx * 0.06 * k, by, bz + 0.16 * k, 0.05 * k, 0.05 * k), (bx + sx * 0.09 * k, by, bz + 0.26 * k, 0.005, 0.005)],
               slot=spike_slot, sub=spike_sub, uv="wrap", tint=W, bone=f"upper_arm.{side}", segments=4, smooth=FACET)


def beads(m, count=11, slot="weapon_b", sub=(0.2, 0.8, 0.4, 0.6), tint="#8a5a30", width=0.56, drop=0.32, r=0.045):
    j = m.joints
    top, fy = j["neck"][2], j["neck"][1]
    for i in range(count):
        t = i / (count - 1)
        bx = -width / 2 + width * t
        bz = top - 0.02 - drop * math.sin(math.pi * t)
        by = fy * 0.9 - 0.2 - 0.02 * math.sin(math.pi * t)
        blob(m, (bx, by, bz), r, slot, "chest", sub=sub, tint=tint)


def cape(m, slot="cloth", length=1.0, width=0.7):
    """A stiff hanging cape from the shoulders (team color in most skins)."""
    j = m.joints
    top, fy = j["neck"][2], j["neck"][1]
    m.part("loft", 1, profile=[(0, fy + 0.2, top - 0.02, width * 0.9, 0.05), (0, fy + 0.3, top - length * 0.5, width, 0.05), (0, fy + 0.34, top - length, width * 1.05, 0.04)],
           slot=slot, uv="front", back=slot, tint=W, bone="chest", segments=4, smooth=FACET)
