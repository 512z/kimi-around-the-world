"""
GRIDLOCK self-made assets — drone builder (Blender 5.x, run via MCP exec()).
Builds three original hard-surface drones from primitives and exports GLBs:
  drone-cab.glb         (player taxi, ~3.4m, rear fare deck)
  drone-interceptor.glb (pursuer, ~3.0m, swept fins)
  drone-patrol.glb      (ambient patrol, ~2.6m, chin sensor)
Conventions: nose toward Blender +Y (=> glTF -Z after export), up = Blender +Z.
Materials: "hull" (dark metal, emissive black) + "accent" (cyan emission).
Each drone gets object-level actions: Body bob + per-rotor spin (assets.js plays
every embedded clip on loop).
"""
import bpy
import math
from mathutils import Vector

ROOT = "/Users/moonshot/Desktop/Designs/game-showcase/blender-mcp/city"
OUT = ROOT + "/assets/models"

# ---------------------------------------------------------------- cleanup ---
for ob in list(bpy.data.objects):
    if ob.name.startswith("DR_"):
        bpy.data.objects.remove(ob, do_unlink=True)
for mat in list(bpy.data.materials):
    if mat.name.startswith("DR_"):
        bpy.data.materials.remove(mat)
for act in list(bpy.data.actions):
    if act.name.startswith("DR_"):
        bpy.data.actions.remove(act)

# ------------------------------------------------------------- materials ---
def make_mats(tag, accent_rgb):
    hull = bpy.data.materials.new(f"DR_{tag}_hull")
    hull.use_nodes = True
    b = hull.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (0.055, 0.062, 0.078, 1)
    b.inputs["Metallic"].default_value = 0.85
    b.inputs["Roughness"].default_value = 0.42
    b.inputs["Emission Color"].default_value = (0, 0, 0, 1)
    b.inputs["Emission Strength"].default_value = 0.0

    acc = bpy.data.materials.new(f"DR_{tag}_accent")
    acc.use_nodes = True
    b = acc.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (0.02, 0.03, 0.04, 1)
    b.inputs["Metallic"].default_value = 0.2
    b.inputs["Roughness"].default_value = 0.5
    b.inputs["Emission Color"].default_value = (accent_rgb[0], accent_rgb[1], accent_rgb[2], 1)
    b.inputs["Emission Strength"].default_value = 0.6  # runtime boosts ×2.2-2.6; keep hull detail

    glass = bpy.data.materials.new(f"DR_{tag}_glass")
    glass.use_nodes = True
    b = glass.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (0.02, 0.05, 0.08, 1)
    b.inputs["Metallic"].default_value = 0.9
    b.inputs["Roughness"].default_value = 0.08
    b.inputs["Emission Color"].default_value = (accent_rgb[0] * 0.25, accent_rgb[1] * 0.25, accent_rgb[2] * 0.25, 1)
    b.inputs["Emission Strength"].default_value = 0.6
    return hull, acc, glass

# --------------------------------------------------------------- helpers ---
def cube(name, loc, scale, mat, bevel=0.03, rot=(0, 0, 0)):
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc, rotation=rot)
    o = bpy.context.object
    o.name = name
    o.scale = scale
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    if mat:
        o.data.materials.append(mat)
    if bevel > 0:
        m = o.modifiers.new("BEV", "BEVEL")
        m.width = bevel
        m.segments = 2
        m.affect = "EDGES"
        bpy.context.view_layer.objects.active = o
        bpy.ops.object.modifier_apply(modifier="BEV")
    return o

def cyl(name, loc, radius, depth, mat, vertices=20, bevel=0.0, rot=(0, 0, 0)):
    bpy.ops.mesh.primitive_cylinder_add(vertices=vertices, radius=radius, depth=depth, location=loc, rotation=rot)
    o = bpy.context.object
    o.name = name
    if mat:
        o.data.materials.append(mat)
    if bevel > 0:
        m = o.modifiers.new("BEV", "BEVEL")
        m.width = bevel
        m.segments = 2
        bpy.context.view_layer.objects.active = o
        bpy.ops.object.modifier_apply(modifier="BEV")
    return o

def sphere(name, loc, scale, mat, seg=24):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=seg, ring_count=12, radius=1, location=loc)
    o = bpy.context.object
    o.name = name
    o.scale = scale
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    if mat:
        o.data.materials.append(mat)
    return o

def join_into(name, parts, mat_keep=True):
    for p in parts:
        p.select_set(True)
    bpy.context.view_layer.objects.active = parts[0]
    bpy.ops.object.join()
    o = bpy.context.object
    o.name = name
    return o

def add_action(obj, name, frames_kf, loop_linear=False):
    """frames_kf: list of (frame, channel, value) — channel in {'locZ','rotZ','rotX'}"""
    obj.animation_data_create()
    act = bpy.data.actions.new(name)
    obj.animation_data.action = act
    for f, ch, v in frames_kf:
        if ch == "locZ":
            obj.location.z = v
            obj.keyframe_insert("location", frame=f, index=2)
        elif ch == "rotZ":
            obj.rotation_euler.z = v
            obj.keyframe_insert("rotation_euler", frame=f, index=2)
        elif ch == "rotX":
            obj.rotation_euler.x = v
            obj.keyframe_insert("rotation_euler", frame=f, index=0)
    if loop_linear:
        # Blender 5.x slotted actions: fcurves live under layers/strips/channelbags
        def _iter_fcurves(action):
            if hasattr(action, "fcurves"):
                yield from action.fcurves
                return
            for layer in action.layers:
                for strip in layer.strips:
                    for cb in strip.channelbags:
                        yield from cb.fcurves
        for fc in _iter_fcurves(act):
            for kp in fc.keyframe_points:
                kp.interpolation = "LINEAR"
    return act

# ------------------------------------------------------------- rotor unit ---
def rotor_unit(tag, x, y, z, r, hull, acc, spin_dir):
    """duct + spinning fan; returns (duct_parts, rotor_obj)"""
    duct = cyl(f"DR_{tag}_duct", (x, y, z), r, 0.16, hull, vertices=24, bevel=0.015)
    rim = cyl(f"DR_{tag}_rim", (x, y, z + 0.085), r * 1.02, 0.03, acc, vertices=24)
    hub = cyl(f"DR_{tag}_hub", (x, y, z + 0.02), r * 0.22, 0.10, hull, vertices=12)
    # fan: 3 thin blades joined, spins as one object
    blades = []
    for k in range(3):
        a = k * 2 * math.pi / 3
        bx = x + math.cos(a) * r * 0.42
        by = y + math.sin(a) * r * 0.42
        bl = cube(f"DR_{tag}_blade{k}", (bx, by, z + 0.02), (r * 0.62, r * 0.14, 0.012), hull, bevel=0.004, rot=(0, 0, a))
        blades.append(bl)
    fan = join_into(f"DR_{tag}_rotor", blades)
    # origin must sit at the duct center so the spin happens in place
    bpy.ops.object.select_all(action="DESELECT")
    fan.select_set(True)
    bpy.context.view_layer.objects.active = fan
    bpy.context.scene.cursor.location = (x, y, z + 0.02)
    bpy.ops.object.origin_set(type="ORIGIN_CURSOR")
    return [duct, rim, hub], fan

# ============================================================ drone: CAB ===
def build_cab():
    tag = "cab"
    hull, acc, glass = make_mats(tag, (0.33, 0.84, 1.0))
    parts = []
    # main hull: long shuttle body, nose +Y, rear deck -Y
    parts.append(cube(f"DR_{tag}_hull", (0, 0, 0.0), (1.05, 1.55, 0.30), hull, bevel=0.09))
    parts.append(cube(f"DR_{tag}_belly", (0, 0.1, -0.22), (0.80, 1.20, 0.16), hull, bevel=0.07))
    # nose taper + cockpit
    parts.append(sphere(f"DR_{tag}_nose", (0, 1.45, 0.02), (0.55, 0.45, 0.26), hull))
    parts.append(sphere(f"DR_{tag}_cockpit", (0, 0.85, 0.26), (0.42, 0.55, 0.20), glass, seg=20))
    # rear fare deck: flat pad at top-rear (fare stands at blender ~ (0,-1.0,0.14))
    parts.append(cube(f"DR_{tag}_deck", (0, -1.05, 0.26), (0.62, 0.55, 0.05), hull, bevel=0.02))
    parts.append(cube(f"DR_{tag}_deckrail", (0, -1.55, 0.33), (0.55, 0.03, 0.05), acc, bevel=0.01))
    # side accent strips
    for sx in (-1, 1):
        parts.append(cube(f"DR_{tag}_strip{sx}", (sx * 0.98, 0.0, 0.10), (0.035, 1.30, 0.05), acc, bevel=0.008))
    # nose light bar + tail light
    parts.append(cube(f"DR_{tag}_headbar", (0, 1.86, 0.05), (0.30, 0.03, 0.045), acc, bevel=0.008))
    parts.append(cube(f"DR_{tag}_tail", (0, -1.62, 0.02), (0.45, 0.025, 0.06), acc, bevel=0.008))
    # tail fins
    for sx in (-1, 1):
        parts.append(cube(f"DR_{tag}_fin{sx}", (sx * 0.55, -1.45, 0.30), (0.05, 0.28, 0.22), hull, bevel=0.015, rot=(0.25 * sx, 0, 0)))
    body = join_into(f"DR_{tag}_Body", parts)

    rotors = []
    for (x, y, sd) in [(-1.35, 0.95, 1), (1.35, 0.95, -1), (-1.35, -0.85, -1), (1.35, -0.85, 1)]:
        dparts, fan = rotor_unit(tag, x, y, 0.05, 0.34, hull, acc, sd)
        for p in dparts:
            p.parent = body
        fan.parent = body
        rotors.append((fan, sd, (x, y)))
        # arm struts
        st = cube(f"DR_{tag}_strut", (x * 0.62, y * 0.62, 0.0), (abs(x) * 0.55, 0.09, 0.07), hull, bevel=0.02)
        st.parent = body

    # animations: body bob + rotor spin (separate actions; loader plays all)
    add_action(body, f"DR_{tag}_hover", [
        (1, "locZ", 0.0), (18, "locZ", 0.07), (36, "locZ", 0.0), (54, "locZ", -0.04), (72, "locZ", 0.0),
    ])
    for fan, sd, (x, y) in rotors:
        # spin around own Z through origin trick: parent keeps world pos; keyframe rotZ
        add_action(fan, f"DR_{tag}_spin_{x}_{y}", [
            (1, "rotZ", 0.0), (12, "rotZ", sd * 2 * math.pi),
        ], loop_linear=True)
    return body

# ================================================== drone: INTERCEPTOR ===
def build_interceptor():
    tag = "int"
    hull, acc, glass = make_mats(tag, (0.33, 0.84, 1.0))  # runtime tints accent red
    parts = []
    parts.append(cube(f"DR_{tag}_hull", (0, 0, 0.0), (0.70, 1.45, 0.24), hull, bevel=0.08))
    parts.append(cube(f"DR_{tag}_spine", (0, 0.1, 0.20), (0.30, 1.20, 0.14), hull, bevel=0.05))
    parts.append(sphere(f"DR_{tag}_nose", (0, 1.42, -0.02), (0.34, 0.50, 0.20), hull, seg=20))
    parts.append(sphere(f"DR_{tag}_eye", (0, 1.30, 0.16), (0.22, 0.25, 0.10), glass, seg=16))
    # swept-forward fins
    for sx in (-1, 1):
        parts.append(cube(f"DR_{tag}_fin{sx}", (sx * 0.85, 0.55, 0.02), (0.55, 0.30, 0.035), hull, bevel=0.012, rot=(0, 0, sx * 0.5)))
        parts.append(cube(f"DR_{tag}_finstrip{sx}", (sx * 1.05, 0.70, 0.05), (0.30, 0.03, 0.03), acc, bevel=0.006, rot=(0, 0, sx * 0.5)))
    # rear stabilizers + tail blade
    for sx in (-1, 1):
        parts.append(cube(f"DR_{tag}_stab{sx}", (sx * 0.35, -1.35, 0.18), (0.045, 0.35, 0.20), hull, bevel=0.012, rot=(0.3 * sx, 0, 0)))
    parts.append(cube(f"DR_{tag}_tail", (0, -1.5, 0.0), (0.30, 0.025, 0.05), acc, bevel=0.006))
    # side accent dashes
    for sx in (-1, 1):
        parts.append(cube(f"DR_{tag}_dash{sx}", (sx * 0.68, -0.1, 0.10), (0.03, 0.9, 0.04), acc, bevel=0.006))
    body = join_into(f"DR_{tag}_Body", parts)

    rotors = []
    for (x, y, sd) in [(-0.95, 0.6, 1), (0.95, 0.6, -1), (-0.95, -0.75, -1), (0.95, -0.75, 1)]:
        dparts, fan = rotor_unit(tag, x, y, 0.04, 0.26, hull, acc, sd)
        for p in dparts:
            p.parent = body
        fan.parent = body
        rotors.append((fan, sd, (x, y)))
        st = cube(f"DR_{tag}_strut", (x * 0.55, y * 0.55, 0.0), (abs(x) * 0.5, 0.07, 0.055), hull, bevel=0.015)
        st.parent = body

    add_action(body, f"DR_{tag}_hover", [
        (1, "locZ", 0.0), (14, "locZ", 0.06), (28, "locZ", 0.0), (42, "locZ", -0.05), (56, "locZ", 0.0),
    ])
    for fan, sd, (x, y) in rotors:
        add_action(fan, f"DR_{tag}_spin_{x}_{y}", [
            (1, "rotZ", 0.0), (10, "rotZ", sd * 2 * math.pi),
        ], loop_linear=True)
    return body

# ====================================================== drone: PATROL ====
def build_patrol():
    tag = "pat"
    hull, acc, glass = make_mats(tag, (0.45, 0.85, 1.0))
    parts = []
    parts.append(cube(f"DR_{tag}_hull", (0, 0, 0.0), (0.85, 1.15, 0.28), hull, bevel=0.09))
    parts.append(sphere(f"DR_{tag}_dome", (0, 0.15, 0.24), (0.45, 0.55, 0.20), hull, seg=20))
    # chin sensor pod (searchlight hangs below this at runtime)
    parts.append(cyl(f"DR_{tag}_chin", (0, 0.75, -0.22), 0.16, 0.22, hull, vertices=16, bevel=0.01, rot=(math.pi / 2, 0, 0)))
    parts.append(sphere(f"DR_{tag}_lens", (0, 0.87, -0.22), (0.10, 0.06, 0.10), glass, seg=14))
    # winglets
    for sx in (-1, 1):
        parts.append(cube(f"DR_{tag}_wing{sx}", (sx * 0.75, -0.1, 0.02), (0.35, 0.55, 0.04), hull, bevel=0.012, rot=(0, 0, sx * 0.15)))
        parts.append(cube(f"DR_{tag}_wingtip{sx}", (sx * 1.0, -0.15, 0.04), (0.03, 0.30, 0.03), acc, bevel=0.006))
    parts.append(cube(f"DR_{tag}_headbar", (0, 1.12, 0.05), (0.22, 0.025, 0.04), acc, bevel=0.006))
    parts.append(cube(f"DR_{tag}_tail", (0, -1.16, 0.05), (0.30, 0.025, 0.05), acc, bevel=0.006))
    body = join_into(f"DR_{tag}_Body", parts)

    rotors = []
    for (x, y, sd) in [(-1.05, 0.55, 1), (1.05, 0.55, -1), (-1.05, -0.6, -1), (1.05, -0.6, 1)]:
        dparts, fan = rotor_unit(tag, x, y, 0.03, 0.24, hull, acc, sd)
        for p in dparts:
            p.parent = body
        fan.parent = body
        rotors.append((fan, sd, (x, y)))
        st = cube(f"DR_{tag}_strut", (x * 0.55, y * 0.55, 0.0), (abs(x) * 0.5, 0.06, 0.05), hull, bevel=0.012)
        st.parent = body

    add_action(body, f"DR_{tag}_hover", [
        (1, "locZ", 0.0), (16, "locZ", 0.05), (32, "locZ", 0.0), (48, "locZ", -0.05), (64, "locZ", 0.0),
    ])
    for fan, sd, (x, y) in rotors:
        add_action(fan, f"DR_{tag}_spin_{x}_{y}", [
            (1, "rotZ", 0.0), (10, "rotZ", sd * 2 * math.pi),
        ], loop_linear=True)
    return body

# ----------------------------------------------------------------- build ---
cab = build_cab()
itc = build_interceptor()
pat = build_patrol()
itc.location = (5, 0, 0)
pat.location = (10, 0, 0)

# ------------------------------------------------------------ dimensions ---
for name, target_len in [("DR_cab_Body", None), ("DR_int_Body", None), ("DR_pat_Body", None)]:
    o = bpy.data.objects[name]
    bpy.context.view_layer.objects.active = o
    dims = o.dimensions
    print(f"{name}: dims=({dims.x:.2f}, {dims.y:.2f}, {dims.z:.2f})  (Y => glTF Z length)")

# ---------------------------------------------------------------- export ---
import os
os.makedirs(OUT, exist_ok=True)

def export_drone(tag, fname):
    bpy.ops.object.select_all(action="DESELECT")
    for o in bpy.data.objects:
        if o.name.startswith(f"DR_{tag}_"):
            o.select_set(True)
    kw = dict(filepath=f"{OUT}/{fname}", export_format="GLB", use_selection=True,
              export_animations=True)
    try:
        bpy.ops.export_scene.gltf(**kw, export_animation_mode="ACTIONS")
    except TypeError:
        bpy.ops.export_scene.gltf(**kw)
    print("EXPORTED", fname, os.path.getsize(f"{OUT}/{fname}"), "bytes")

export_drone("cab", "drone-cab.glb")
export_drone("int", "drone-interceptor.glb")
export_drone("pat", "drone-patrol.glb")

print("DRONES_BUILT_OK")
