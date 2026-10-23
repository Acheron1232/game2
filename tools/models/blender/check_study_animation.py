"""Check weapon aiming and grip attachment in the saved review blend files."""
import sys
import bpy
from mathutils import Vector

model_id=sys.argv[sys.argv.index("--")+1]
arm=next(obj for obj in bpy.data.objects if obj.type=="ARMATURE")
action_name="attack" if model_id=="pike_warden" else "cast"
frame=19 if model_id=="pike_warden" else 25
arm.animation_data.action=bpy.data.actions[action_name]
for track in arm.animation_data.nla_tracks:
    track.mute=True
bpy.context.scene.frame_set(frame)
bpy.context.view_layer.update()
bone=arm.pose.bones["weapon"]
transform=bone.matrix @ bone.bone.matrix_local.inverted()
direction=(transform.to_3x3() @ Vector((0,0,1))).normalized()
rest_grip=Vector(arm["weapon_grip"]) if "weapon_grip" in arm else arm.data.bones["hand.R"].head_local+Vector((0,-0.025,-0.055))
posed_grip=transform @ rest_grip
hand_grip=bone.parent.matrix @ bone.parent.bone.matrix_local.inverted() @ rest_grip
error=(posed_grip-hand_grip).length
print(f"POSE {model_id} {action_name} frame={frame} direction={tuple(round(v,4) for v in direction)} grip_error={error:.6f}m")
assert error < 0.015, "Weapon slides away from its grip"
if model_id=="pike_warden":
    assert direction.y < -0.97, "Spear must point forward during the thrust"
    assert abs(direction.z)<0.20, "Spear must be almost horizontal"
else:
    assert direction.z>0.94, "Casting staff must remain upright"
