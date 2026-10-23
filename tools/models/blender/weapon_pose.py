import math
import bpy
from mathutils import Matrix, Vector

def aim_weapon(m, action_name, grip, poses):
    """Author the pole direction in world space, then solve the hand-relative keys.

    Parent arm rotations must not turn a horizontal thrust into an overhead swing.
    The actual grip point remains fixed to the hand throughout the rotation.
    """
    arm=m.armature
    action=bpy.data.actions[action_name]
    arm.animation_data.action=action
    for track in arm.animation_data.nla_tracks:
        track.mute=True
    pb=arm.pose.bones["weapon"]
    for frame, tilt in poses:
        bpy.context.scene.frame_set(frame)
        bpy.context.view_layer.update()
        parent=pb.parent
        posed_grip=parent.matrix @ parent.bone.matrix_local.inverted() @ Vector(grip)
        turn=Matrix.Rotation(math.radians(tilt),4,"X")
        pb.matrix=Matrix.Translation(posed_grip) @ turn @ Matrix.Translation(-Vector(grip)) @ pb.bone.matrix_local
        pb.keyframe_insert("rotation_euler",frame=frame)
        pb.keyframe_insert("location",frame=frame)
    arm.animation_data.action=None
    for bone in arm.pose.bones:
        bone.rotation_euler=(0,0,0)
        bone.location=(0,0,0)
    bpy.context.scene.frame_set(1)

