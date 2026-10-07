#!/usr/bin/env python3
"""Blender background script: extract APK-native bones and internal organs."""

from __future__ import annotations

import json
import sys
from pathlib import Path

import bmesh
import bpy
from mathutils import Matrix


def script_args():
    marker = sys.argv.index("--") + 1
    return Path(sys.argv[marker]), Path(sys.argv[marker + 1])


def clear_scene():
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for collection in (bpy.data.meshes, bpy.data.materials, bpy.data.images):
        for block in list(collection):
            if block.users == 0:
                collection.remove(block)


def anatomy_system(material_name):
    name = material_name.lower()
    if name.startswith("skel"):
        return "skeletal"
    if name.startswith("organ-") or name.startswith("brain_"):
        return "internal-organs"
    return None


def keep_anatomy_faces(obj):
    mesh = obj.data
    keep_slots = {
        index for index, slot in enumerate(obj.material_slots)
        if anatomy_system(slot.name)
    }
    if not keep_slots:
        bpy.data.objects.remove(obj, do_unlink=True)
        return False

    remove = [polygon.index for polygon in mesh.polygons if polygon.material_index not in keep_slots]
    if remove:
        editable = bmesh.new()
        editable.from_mesh(mesh)
        editable.faces.ensure_lookup_table()
        bmesh.ops.delete(editable, geom=[editable.faces[index] for index in remove], context="FACES")
        editable.to_mesh(mesh)
        editable.free()

    for index in reversed([index for index in range(len(obj.material_slots)) if index not in keep_slots]):
        obj.active_material_index = index
        bpy.context.view_layer.objects.active = obj
        bpy.ops.object.material_slot_remove()
    return bool(mesh.polygons)


def main():
    manifest_path, output_dir = script_args()
    rows = json.loads(manifest_path.read_text(encoding="utf-8"))
    output_dir.mkdir(parents=True, exist_ok=True)

    for model in ("Male", "Female"):
        clear_scene()
        imported = []
        for row in (item for item in rows if item["model"] == model):
            if not any(anatomy_system(name) for name in row["materials"]):
                continue
            before = set(bpy.data.objects)
            bpy.ops.wm.obj_import(filepath=row["object"], forward_axis="NEGATIVE_Z", up_axis="Y")
            objects = [obj for obj in bpy.data.objects if obj not in before and obj.type == "MESH"]
            matrix = Matrix(row["matrix"])
            for obj in objects:
                obj.matrix_world = obj.matrix_world @ matrix
                obj.name = f"{row['name']} native cutaway anatomy"
                if keep_anatomy_faces(obj):
                    imported.append(obj)

        if not imported:
            raise RuntimeError(f"No APK-native cutaway anatomy remained for {model}")

        bpy.ops.object.select_all(action="DESELECT")
        for obj in imported:
            obj.select_set(True)
        bpy.context.view_layer.objects.active = imported[0]
        bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
        for obj in imported:
            systems = sorted({anatomy_system(slot.name) for slot in obj.material_slots})
            obj["anatomyLayer"] = "Native APK cutaway"
            obj["anatomySystems"] = ",".join(systems)
            obj["source"] = "免费找穴位神器.apk"
            for polygon in obj.data.polygons:
                polygon.use_smooth = True

        output_path = output_dir / f"anatomy-{model.lower()}.glb"
        bpy.ops.export_scene.gltf(
            filepath=str(output_path.resolve()),
            export_format="GLB",
            use_selection=True,
            export_apply=True,
            export_yup=True,
            export_materials="EXPORT",
            export_extras=True,
        )
        triangles = sum(len(obj.data.polygons) for obj in imported)
        materials = {slot.name for obj in imported for slot in obj.material_slots}
        systems = sorted({anatomy_system(name) for name in materials})
        print(
            f"Exported native {model} cutaway: {len(imported)} meshes, "
            f"{len(materials)} materials, {triangles} triangles, {systems} -> {output_path}"
        )


if __name__ == "__main__":
    main()
