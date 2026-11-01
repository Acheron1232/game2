"""Finds parts whose texture is smeared into stripes: faces that get almost no picture (a thin
line of the cell stretched over a big face). That happens when a part is projected from the
wrong side, for example a shield facing +X with uv="front" (seen from -Y it is only a line).

    blender -b --factory-startup -P tools/models/blender/uv_check.py -- <model_id> [model_id...]

Prints one line per bad part: model, where the part is made (file:line), slot, uv mode and how
much of its surface is smeared. Some smear is normal on the sides of round parts painted from
the front; look at the parts with the biggest share first.
"""

import importlib
import os
import sys
import traceback

import bpy
import bmesh

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(HERE, "models"))

import kit  # noqa: E402

# A face is smeared when it gets less than this share of the part's usual picture per m².
SMEAR = 0.08
# Report a part when this share of its surface is smeared (and the part is not tiny).
REPORT = 0.3
MIN_AREA = 0.01

_part = kit.Model.part


def _traced_part(self, kind, size, *args, **kw):
    obj = _part(self, kind, size, *args, **kw)
    where = "?"
    for fr in reversed(traceback.extract_stack()[:-1]):
        if os.path.basename(fr.filename) not in ("kit.py", "uv_check.py"):
            where = f"{os.path.basename(fr.filename)}:{fr.lineno}"
            break
    obj["where"] = where
    obj["slot"] = kw.get("slot", args[3] if len(args) > 3 else "?")
    obj["uv"] = kw.get("uv", "box")
    return obj


kit.Model.part = _traced_part


def check(model_id):
    kit.reset()
    model = importlib.import_module(model_id).build()
    bad = []
    for obj, _bone in model.parts:
        bm = bmesh.new()
        bm.from_mesh(obj.data)
        uv = bm.loops.layers.uv.active
        rows = []
        for f in bm.faces:
            area = f.calc_area()
            if area <= 1e-8:
                continue
            pts = [lp[uv].uv for lp in f.loops]
            uv_area = 0.0
            for i in range(1, len(pts) - 1):
                a, b = pts[i] - pts[0], pts[i + 1] - pts[0]
                uv_area += abs(a.x * b.y - a.y * b.x) / 2
            rows.append((area, uv_area / area))
        bm.free()
        total = sum(a for a, _ in rows)
        if total < MIN_AREA or not rows:
            continue
        # Area-weighted median density of the part.
        acc, median = 0.0, 0.0
        for a, d in sorted(rows, key=lambda r: r[1]):
            acc += a
            if acc >= total / 2:
                median = d
                break
        if median <= 0:
            smeared = 1.0
        else:
            smeared = sum(a for a, d in rows if d < median * SMEAR) / total
        if smeared >= REPORT:
            bad.append((smeared, total, obj["where"], obj["slot"], obj["uv"]))
    for smeared, total, where, slot, mode in sorted(bad, reverse=True):
        print(f"UVCHECK {model_id} {where} slot={slot} uv={mode} smeared={smeared:.0%} area={total:.2f}")
    print(f"UVDONE {model_id} parts={len(model.parts)} bad={len(bad)}")


for mid in sys.argv[sys.argv.index("--") + 1 :]:
    try:
        check(mid)
    except Exception as e:  # keep checking the rest
        print(f"UVFAIL {mid} {e}")
