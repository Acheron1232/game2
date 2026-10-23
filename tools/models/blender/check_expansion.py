"""Reopen packed sources and validate geometry, rig bindings and atlas isolation."""
import bpy, json, math, os
from pathlib import Path
ROOT=Path(__file__).resolve().parents[3]
IDS=['thorn_marshal','grave_bellkeeper','tidebreaker','lantern_monk','obsidian_heart','foundry_golem','golem_foundry']
report=[]
for mid in IDS:
    bpy.ops.wm.open_mainfile(filepath=str(ROOT/'art/source/blender'/f'{mid}.blend'))
    obj=bpy.data.objects.get(mid)
    assert obj is not None and obj.type=='MESH',mid+' mesh missing'
    uv=obj.data.uv_layers.active
    assert uv is not None,mid+' UV missing'
    cols,rows=4,2 if mid=='foundry_golem' else 4
    cells=set()
    for p in obj.data.polygons:
        face_cells=set()
        for li in p.loop_indices:
            s,t=uv.data[li].uv
            assert math.isfinite(s) and math.isfinite(t) and 0<=s<=1 and 0<=t<=1,mid+' invalid UV'
            face_cells.add((min(cols-1,int(s*cols)),min(rows-1,int((1-t)*rows))))
        assert len(face_cells)==1,mid+' polygon crosses painted cells'
        cells.update(face_cells)
    tris=sum(len(p.vertices)-2 for p in obj.data.polygons)
    assert tris<=(2000 if mid=='golem_foundry' else 1500 if mid=='foundry_golem' else 5000),mid+' geometry over budget'
    arm=next(o for o in bpy.data.objects if o.type=='ARMATURE')
    assert len(arm.data.bones)==(2 if mid=='golem_foundry' else 19),mid+' rig changed'
    clips={tr.name for tr in arm.animation_data.nla_tracks}
    assert (set(['idle']) if mid=='golem_foundry' else set(['idle','walk','attack','attack2','cast','hit','death','victory']))<=clips,mid+' clips missing'
    for v in obj.data.vertices:
        assert len(v.groups)==1 and abs(v.groups[0].weight-1)<1e-4,mid+' unbound or mixed rigid vertex'
    images=[i for i in bpy.data.images if i.type=='IMAGE' and i.filepath]
    assert images and all(i.packed_file for i in images),mid+' unpacked source texture'
    report.append(dict(id=mid,triangles=tris,bones=len(arm.data.bones),clips=sorted(clips),paintedCells=len(cells),uvWithinSingleCell=True,packedImages=len(images)))
out=ROOT/'art/source/models/expansion-validation.json'
out.write_text(json.dumps(report,indent=2)+'\n')
print('EXPANSION_VALIDATION_OK',json.dumps(report))
