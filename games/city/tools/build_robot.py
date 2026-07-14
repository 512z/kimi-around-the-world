"""
GRIDLOCK self-made assets — humanoid android (Blender 5.x, run via MCP exec()).
Builds an original robot mannequin (~1.78m) from primitives, a 17-bone armature,
and rigid (1-bone-per-vertex) skinning by nearest bone segment — hard-surface
robots read fine with rigid limbs. Exports assets/models/android.glb
(mesh + armature, no animation; clips ship separately from build_clips.py).
"""
import bpy
import math
from mathutils import Vector

ROOT = "/Users/moonshot/Desktop/Designs/game-showcase/blender-mcp/city"
OUT = ROOT + "/assets/models"

# ---------------------------------------------------------------- cleanup ---
for ob in list(bpy.data.objects):
    if ob.name.startswith("RB_"):
        bpy.data.objects.remove(ob, do_unlink=True)
for mat in list(bpy.data.materials):
    if mat.name.startswith("RB_"):
        bpy.data.materials.remove(mat)
for arm in list(bpy.data.armatures):
    if arm.name.startswith("RB_"):
        bpy.data.armatures.remove(arm)

# ------------------------------------------------------------------ material
mat = bpy.data.materials.new("RB_body")
mat.use_nodes = True
b = mat.node_tree.nodes["Principled BSDF"]
b.inputs["Base Color"].default_value = (0.75, 0.8, 0.88, 1)
b.inputs["Metallic"].default_value = 0.7
b.inputs["Roughness"].default_value = 0.3

# -------------------------------------------------------------------- parts
def cube(name, loc, scale, bevel=0.02):
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc)
    o = bpy.context.object
    o.name = name
    o.scale = scale
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    o.data.materials.append(mat)
    if bevel > 0:
        m = o.modifiers.new("BEV", "BEVEL")
        m.width = bevel
        m.segments = 2
        bpy.context.view_layer.objects.active = o
        bpy.ops.object.modifier_apply(modifier="BEV")
    return o

def cyl(name, loc, radius, depth, vertices=14, rot=(0, 0, 0), smooth=True):
    bpy.ops.mesh.primitive_cylinder_add(vertices=vertices, radius=radius, depth=depth, location=loc, rotation=rot)
    o = bpy.context.object
    o.name = name
    o.data.materials.append(mat)
    if smooth:
        bpy.ops.object.shade_smooth()
    return o

def sph(name, loc, radius, seg=16):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=seg, ring_count=8, radius=radius, location=loc)
    o = bpy.context.object
    o.name = name
    o.data.materials.append(mat)
    bpy.ops.object.shade_smooth()
    return o

parts = []
# torso / head
parts.append(cube("RB_pelvis", (0, 0, 0.88), (0.17, 0.11, 0.10)))
parts.append(cube("RB_waist", (0, 0, 1.00), (0.14, 0.09, 0.06)))
parts.append(cube("RB_torso", (0, 0, 1.20), (0.20, 0.115, 0.20)))
parts.append(cube("RB_chestplate", (0, -0.02, 1.24), (0.215, 0.10, 0.13)))
parts.append(cyl("RB_neck", (0, 0, 1.44), 0.055, 0.10))
parts.append(cube("RB_head", (0, 0.005, 1.60), (0.105, 0.10, 0.115), bevel=0.04))
parts.append(cube("RB_visor", (0, -0.095, 1.615), (0.08, 0.012, 0.035), bevel=0.006))
# arms
for sx, side in [(1, "L"), (-1, "R")]:
    parts.append(sph(f"RB_shoulder_{side}", (sx * 0.245, 0, 1.345), 0.075))
    parts.append(cyl(f"RB_uparm_{side}", (sx * 0.26, 0, 1.19), 0.055, 0.30))
    parts.append(sph(f"RB_elbow_{side}", (sx * 0.26, 0, 1.04), 0.05))
    parts.append(cyl(f"RB_forearm_{side}", (sx * 0.26, 0, 0.90), 0.045, 0.26))
    parts.append(cube(f"RB_hand_{side}", (sx * 0.26, 0, 0.72), (0.045, 0.03, 0.07), bevel=0.015))
# legs
for sx, side in [(1, "L"), (-1, "R")]:
    parts.append(sph(f"RB_hip_{side}", (sx * 0.125, 0, 0.80), 0.085))
    parts.append(cyl(f"RB_thigh_{side}", (sx * 0.13, 0, 0.60), 0.075, 0.38))
    parts.append(sph(f"RB_knee_{side}", (sx * 0.13, 0, 0.42), 0.06))
    parts.append(cyl(f"RB_shin_{side}", (sx * 0.13, 0, 0.24), 0.055, 0.34))
    parts.append(cube(f"RB_foot_{side}", (sx * 0.13, 0.055, 0.035), (0.06, 0.135, 0.04), bevel=0.015))

for p in parts:
    p.select_set(True)
bpy.context.view_layer.objects.active = parts[0]
bpy.ops.object.join()
body = bpy.context.object
body.name = "RB_Body"
print("RB_Body vertices:", len(body.data.vertices))

# ----------------------------------------------------------------- armature
arm_data = bpy.data.armatures.new("RB_Armature")
arm_obj = bpy.data.objects.new("RB_Armature", arm_data)
bpy.context.collection.objects.link(arm_obj)
bpy.context.view_layer.objects.active = arm_obj
bpy.ops.object.mode_set(mode="EDIT")
eb = arm_data.edit_bones

BONES = {
    "Hips":       ((0, 0, 0.86), (0, 0, 1.00), None),
    "Spine":      ((0, 0, 1.00), (0, 0, 1.18), "Hips"),
    "Chest":      ((0, 0, 1.18), (0, 0, 1.34), "Spine"),
    "Neck":       ((0, 0, 1.34), (0, 0, 1.46), "Chest"),
    "Head":       ((0, 0, 1.46), (0, 0, 1.64), "Neck"),
    "UpperArm.L": ((0.24, 0, 1.34), (0.26, 0, 1.06), "Chest"),
    "ForeArm.L":  ((0.26, 0, 1.06), (0.26, 0, 0.80), "UpperArm.L"),
    "Hand.L":     ((0.26, 0, 0.80), (0.26, 0, 0.66), "ForeArm.L"),
    "UpperArm.R": ((-0.24, 0, 1.34), (-0.26, 0, 1.06), "Chest"),
    "ForeArm.R":  ((-0.26, 0, 1.06), (-0.26, 0, 0.80), "UpperArm.R"),
    "Hand.R":     ((-0.26, 0, 0.80), (-0.26, 0, 0.66), "ForeArm.R"),
    "UpperLeg.L": ((0.125, 0, 0.82), (0.13, 0, 0.44), "Hips"),
    "LowerLeg.L": ((0.13, 0, 0.44), (0.13, 0, 0.07), "UpperLeg.L"),
    "Foot.L":     ((0.13, 0, 0.07), (0.13, 0.16, 0.03), "LowerLeg.L"),
    "UpperLeg.R": ((-0.125, 0, 0.82), (-0.13, 0, 0.44), "Hips"),
    "LowerLeg.R": ((-0.13, 0, 0.44), (-0.13, 0, 0.07), "UpperLeg.R"),
    "Foot.R":     ((-0.13, 0, 0.07), (-0.13, 0.16, 0.03), "LowerLeg.R"),
}
for name, (head, tail, parent) in BONES.items():
    bn = eb.new(name)
    bn.head = head
    bn.tail = tail
for name, (_, _, parent) in BONES.items():
    if parent:
        eb[name].parent = eb[parent]
bpy.ops.object.mode_set(mode="OBJECT")
print("bones:", len(BONES))

# ------------------------------------------------- rigid skin (nearest bone)
def seg_dist(p, a, b):
    ab = b - a
    t = max(0.0, min(1.0, (p - a).dot(ab) / max(ab.length_squared, 1e-9)))
    return (p - (a + ab * t)).length

bone_segs = {n: (Vector(h), Vector(t)) for n, (h, t, _) in BONES.items()}
groups = {}
for n in BONES:
    groups[n] = body.vertex_groups.new(name=n)
assign = {n: [] for n in BONES}
for v in body.data.vertices:
    p = body.matrix_world @ v.co
    best, bd = None, 1e9
    for n, (a, tb) in bone_segs.items():
        d = seg_dist(p, a, tb)
        if d < bd:
            best, bd = n, d
    assign[best].append(v.index)
for n, idxs in assign.items():
    if idxs:
        groups[n].add(idxs, 1.0, "REPLACE")
amod = body.modifiers.new("ARM", "ARMATURE")
amod.object = arm_obj
body.parent = arm_obj
print("skinning done:", {n: len(v) for n, v in assign.items() if v})

# ------------------------------------------------------------- export robot
import os
os.makedirs(OUT, exist_ok=True)
bpy.ops.object.select_all(action="DESELECT")
body.select_set(True)
arm_obj.select_set(True)
kw = dict(filepath=f"{OUT}/android.glb", export_format="GLB", use_selection=True,
          export_animations=False)
bpy.ops.export_scene.gltf(**kw)
print("EXPORTED android.glb", os.path.getsize(f"{OUT}/android.glb"), "bytes")
print("ROBOT_BUILT_OK")
