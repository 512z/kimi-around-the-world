"""
GRIDLOCK self-made assets — android animation clips (Blender 5.x, MCP exec()).
Hand-keyed on the RB_Armature built by build_robot.py (must run first, same
Blender session). Exports assets/models/android-clips.glb (armature-only GLB
with one clip per NLA track). Clip names are load-bearing:
  - "Standing_Phone_01_FemaleA"  (the fare on the cab — exact name required)
  - "Walking_Chat_01", "Walking_Phone_01" (pedestrians; prefix "Walking_")
  - "Standing_Idle_01"
Conventions for this rig (bones point down; bone X ~ world X):
  +rotX swings a limb BACKWARD (-rotX = forward), knee/elbow bend = +rotX.
"""
import bpy
import math
import os

ROOT = "/Users/moonshot/Desktop/Designs/game-showcase/blender-mcp/city"
OUT = ROOT + "/assets/models"

arm_obj = bpy.data.objects.get("RB_Armature")
if arm_obj is None:
    raise RuntimeError("RB_Armature missing — run build_robot.py first")

bpy.context.view_layer.objects.active = arm_obj
bpy.ops.object.mode_set(mode="POSE")
arm_obj.animation_data_create()
for pb in arm_obj.pose.bones:
    pb.rotation_mode = "XYZ"

def reset_pose():
    for pb in arm_obj.pose.bones:
        pb.rotation_euler = (0, 0, 0)
        pb.location = (0, 0, 0)

def new_action(name):
    act = bpy.data.actions.new(name)
    arm_obj.animation_data.action = act
    reset_pose()
    return act

def K(name, frame, rot=None, loc=None):
    pb = arm_obj.pose.bones[name]
    if rot is not None:
        pb.rotation_euler = rot
        pb.keyframe_insert("rotation_euler", frame=frame)
    if loc is not None:
        pb.location = loc
        pb.keyframe_insert("location", frame=frame)

def push_nla(name):
    ad = arm_obj.animation_data
    act = ad.action
    track = ad.nla_tracks.new()
    track.name = name
    track.strips.new(name, int(act.frame_range[0]), act)
    ad.action = None

# ======================================================= Walking_Chat_01 ===
# 24-frame in-place walk; right arm gestures, left arm swings.
act = new_action("Walking_Chat_01")
FR = [1, 7, 13, 19, 25]
legR = [-0.55, -0.05, 0.50, -0.05, -0.55]
legL = [0.50, -0.05, -0.55, -0.05, 0.50]
kneeR = [0.05, 0.10, 0.30, 0.75, 0.05]
kneeL = [0.30, 0.75, 0.05, 0.10, 0.30]
armL = [-0.45, 0.0, 0.45, 0.0, -0.45]
for i, f in enumerate(FR):
    K("UpperLeg.R", f, (legR[i], 0, 0))
    K("UpperLeg.L", f, (legL[i], 0, 0))
    K("LowerLeg.R", f, (kneeR[i], 0, 0))
    K("LowerLeg.L", f, (kneeL[i], 0, 0))
    K("UpperArm.L", f, (armL[i], 0, 0.12))
    K("ForeArm.L", f, (0.3, 0, 0))
    K("Hips", f, (0.02, 0, 0.05 if i % 2 == 0 else -0.05), (0, 0, -0.02 if i % 2 == 0 else 0.01))
    K("Chest", f, (0.02, 0, -0.04 if i % 2 == 0 else 0.04))
# right arm: gesture cycle (hold-ish with two flicks)
gest = [(1, -0.15), (6, -0.35), (10, -0.75), (14, -0.4), (18, -0.2), (22, -0.55), (25, -0.15)]
for f, x in gest:
    K("UpperArm.R", f, (x, 0, -0.15))
    K("ForeArm.R", f, (0.5 + abs(x) * 0.8, 0, 0))
K("Head", 1, (0.05, 0, 0.08)); K("Head", 13, (0.05, 0, -0.08)); K("Head", 25, (0.05, 0, 0.08))
push_nla("Walking_Chat_01")

# ====================================================== Walking_Phone_01 ===
# same legs, right hand glued to face, head tipped at the screen
act = new_action("Walking_Phone_01")
for i, f in enumerate(FR):
    K("UpperLeg.R", f, (legR[i], 0, 0))
    K("UpperLeg.L", f, (legL[i], 0, 0))
    K("LowerLeg.R", f, (kneeR[i], 0, 0))
    K("LowerLeg.L", f, (kneeL[i], 0, 0))
    K("UpperArm.L", f, (armL[i] * 0.8, 0, 0.12))
    K("ForeArm.L", f, (0.3, 0, 0))
    K("UpperArm.R", f, (-1.55 + 0.05 * (i % 2), 0, -0.22))
    K("ForeArm.R", f, (1.95, 0, 0))
    K("Hips", f, (0.02, 0, 0.05 if i % 2 == 0 else -0.05), (0, 0, -0.02 if i % 2 == 0 else 0.01))
    K("Head", f, (0.18, 0, -0.05))
push_nla("Walking_Phone_01")

# ============================================ Standing_Phone_01_FemaleA ===
# 8s loop, 24fps. Weight on left leg, phone in right hand, occasional glance up.
act = new_action("Standing_Phone_01_FemaleA")
base = {
    "Hips": ((0.0, 0, 0.04), (0.03, 0, -0.01)),
    "Spine": ((0.02, 0, -0.03), None),
    "Chest": ((0.03, 0, -0.04), None),
    "Head": ((0.16, 0, -0.06), None),
    "UpperArm.R": ((-1.52, 0, -0.24), None),
    "ForeArm.R": ((1.95, 0, 0), None),
    "UpperArm.L": ((0.10, 0, 0.14), None),
    "ForeArm.L": ((0.35, 0, 0), None),
    "UpperLeg.R": ((-0.04, 0, 0), None),
    "UpperLeg.L": ((0.06, 0, 0), None),
}
def phone_pose(frame, glance=0.0, fidget=0.0):
    for bone, (rot, loc) in base.items():
        r = list(rot)
        if bone == "Head":
            r[0] -= glance * 0.22
            r[2] += glance * 0.20
        if bone == "UpperArm.R":
            r[0] += fidget * 0.10
        if bone == "Chest":
            r[0] += 0.012 * math.sin(frame / 191 * math.pi * 4)  # breathing
        K(bone, frame, tuple(r), loc)
for f, gl, fg in [(1, 0, 0), (48, 0, 0), (60, 1, 0), (84, 1, 0), (96, 0, 0),
                  (120, 0, 0.6), (132, 0, 0), (160, 0, 0), (191, 0, 0)]:
    phone_pose(f, gl, fg)
push_nla("Standing_Phone_01_FemaleA")

# ====================================================== Standing_Idle_01 ===
# 6s loop: breathing, slow weight sway, head looks left then right.
act = new_action("Standing_Idle_01")
for f in [1, 36, 72, 108, 143]:
    phase = (f - 1) / 142
    sway = math.sin(phase * math.pi * 2) * 0.025
    breath = math.sin(phase * math.pi * 4) * 0.015
    look = math.sin(phase * math.pi * 2 - math.pi / 2) * 0.14
    K("Hips", f, (0, 0, sway))
    K("Spine", f, (breath, 0, -sway * 0.6))
    K("Chest", f, (0.02 + breath, 0, -sway * 0.6))
    K("Head", f, (0.04, 0, look))
    K("UpperArm.L", f, (0.06 + abs(sway), 0, 0.14))
    K("UpperArm.R", f, (0.06 + abs(sway), 0, -0.14))
    K("ForeArm.L", f, (0.3, 0, 0))
    K("ForeArm.R", f, (0.3, 0, 0))
push_nla("Standing_Idle_01")

# ------------------------------------------------------------------ export
bpy.ops.object.mode_set(mode="OBJECT")
os.makedirs(OUT, exist_ok=True)
bpy.ops.object.select_all(action="DESELECT")
arm_obj.select_set(True)
kw = dict(filepath=f"{OUT}/android-clips.glb", export_format="GLB",
          use_selection=True, export_animations=True)
try:
    bpy.ops.export_scene.gltf(**kw, export_animation_mode="NLA_TRACKS")
except TypeError as e:
    print("NLA_TRACKS mode failed, retrying default:", e)
    bpy.ops.export_scene.gltf(**kw, export_nla_strips=True)
print("EXPORTED android-clips.glb", os.path.getsize(f"{OUT}/android-clips.glb"), "bytes")
print("tracks:", [t.name for t in arm_obj.animation_data.nla_tracks])
print("CLIPS_BUILT_OK")
