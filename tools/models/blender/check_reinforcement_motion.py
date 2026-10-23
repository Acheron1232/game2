"""Small motion check: the ram and bolt must travel forward, not sink vertically."""
import bpy, json
from pathlib import Path
from mathutils import Vector

ROOT=Path(__file__).resolve().parents[3]
report=[]
for name in ('covered_ram','bolt_cart'):
    bpy.ops.wm.open_mainfile(filepath=str(ROOT/'art/source/blender'/f'{name}.blend'))
    arm=next(o for o in bpy.data.objects if o.type=='ARMATURE')
    arm.animation_data.action=None
    for track in arm.animation_data.nla_tracks:track.mute=track.name!='attack'
    points=[]
    for frame in (1,16):
        bpy.context.scene.frame_set(frame);bpy.context.view_layer.update()
        points.append(arm.matrix_world @ arm.pose.bones['mechanism'].matrix @ Vector((0,0,0)))
    delta=points[1]-points[0]
    assert delta.y<-.3 and abs(delta.z)<.001,(name,list(delta))
    report.append({'model':name,'forwardTravel':round(-delta.y,3),'verticalTravel':round(delta.z,3)})
(ROOT/'art/source/models/selected-batch2-motion.json').write_text(json.dumps(report,indent=2)+'\n')
print('MOTION_OK',json.dumps(report))
