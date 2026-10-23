"""Verify front/back isolation and continuous limb coordinates in a saved painted model."""
import json
import math
import os
import sys
import bpy
from mathutils import Vector

model_id=sys.argv[sys.argv.index("--")+1]
root=os.path.abspath(os.path.join(os.path.dirname(__file__),"../../.."))
atlas=json.load(open(os.path.join(root,"client/public/assets/models",model_id+"_skin.json")))
body=bpy.data.objects[model_id]
arm=body.parent
uv=body.data.uv_layers.active
counts={"face_front":0,"face_back":0,"body_front":0,"body_back":0,"limb_loops":0}

def region(role):
    r=atlas["rects"][model_id+"__"+role]
    return r["x"],1-r["y"]-r["h"],r["w"],r["h"]

def inside(p,r):
    x,y,w,h=r
    return x-1e-6<=p.x<=x+w+1e-6 and y-1e-6<=p.y<=y+h+1e-6

for polygon in body.data.polygons:
    values=[uv.data[li].uv for li in polygon.loop_indices]
    assert all(-1e-6<=p.x<=1.000001 and -1e-6<=p.y<=1.000001 for p in values)
    for role in ("face","body"):
        r=region(role)
        if not all(inside(p,r) for p in values) or abs(polygon.normal.z)>.8:
            continue
        us=[(p.x-r[0])/r[2] for p in values]
        if polygon.normal.y<-.15:
            assert max(us)<=.50001, role+" front crosses into back painting"
            counts[role+"_front"]+=1
        if polygon.normal.y>.15:
            assert min(us)>=.49999, role+" back samples front decoration"
            counts[role+"_back"]+=1
    r=region("arm")
    if not all(inside(p,r) for p in values):
        continue
    for li in polygon.loop_indices:
        vertex=body.data.vertices[body.data.loops[li].vertex_index]
        group=body.vertex_groups[vertex.groups[0].group].name
        if not group.startswith(("upper_arm.","forearm.")):
            continue
        bone=arm.data.bones[group]
        a,b=bone.head_local,bone.tail_local
        t=(vertex.co-a).dot((b-a).normalized())/(b-a).length
        expected=(1-.5*t) if group.startswith("upper_arm.") else (.5-.5*t)
        expected=min(1,max(0,expected))
        actual=(uv.data[li].uv.y-r[1])/r[3]
        assert abs(expected-actual)<.00002, f"{group}: discontinuous sleeve UV {actual} vs {expected}"
        counts["limb_loops"]+=1
assert all(counts.values()), "A required UV region was not checked"
print("PAINTED_UV",model_id,counts,"PASS")
