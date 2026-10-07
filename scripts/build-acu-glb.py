#!/usr/bin/env python3
"""Blender background script: assemble surface-only native APK bodies into GLBs."""

from __future__ import annotations

import json
import sys
from pathlib import Path

import bpy
from mathutils import Matrix


def script_args():
    marker = sys.argv.index("--") + 1
    return Path(sys.argv[marker]), Path(sys.argv[marker + 1])


def keep_material(model: str, name: str) -> bool:
    token = name.lower()
    excluded = ("skel", "organ", "brain", "cartilage", "bone", "artery", "vein")
    if any(word in token for word in excluded):
        return False
    if model == "Male":
        return any(word in token for word in ("james_body", "finnail", "toenail", "genital", "eye"))
    return any(
        word in token
        for word in (
            "jss_arm", "jss_leg", "jss_toenail", "jss_fingernail", "jss_head", "jss_neck",
            "jss_eye", "jss_iris", "jss_pupil", "jss_torso", "jss_chest", "jss_genital",
        )
    )


def clear_scene():
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for collection in (bpy.data.meshes, bpy.data.materials, bpy.data.images):
        for block in list(collection):
            if block.users == 0:
                collection.remove(block)


def remove_non_surface_faces(obj, model):
    mesh = obj.data
    keep_slots = {index for index, slot in enumerate(obj.material_slots) if keep_material(model, slot.name)}
    if not keep_slots:
        bpy.data.objects.remove(obj, do_unlink=True)
        return False
    remove = [polygon.index for polygon in mesh.polygons if polygon.material_index not in keep_slots]
    if remove:
        import bmesh

        bm = bmesh.new()
        bm.from_mesh(mesh)
        bm.faces.ensure_lookup_table()
        bmesh.ops.delete(bm, geom=[bm.faces[index] for index in remove], context="FACES")
        bm.to_mesh(mesh)
        bm.free()
    unused = [index for index in range(len(obj.material_slots)) if index not in keep_slots]
    for index in reversed(unused):
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
            before = set(bpy.data.objects)
            bpy.ops.wm.obj_import(filepath=row["object"], forward_axis="NEGATIVE_Z", up_axis="Y")
            new_objects = [obj for obj in bpy.data.objects if obj not in before and obj.type == "MESH"]
            matrix = Matrix(row["matrix"])
            for obj in new_objects:
                # Keep the OBJ importer's Y-up basis conversion on the outside so
                # the Unity world transform lands in the same final glTF basis.
                obj.matrix_world = obj.matrix_world @ matrix
                obj.name = row["name"]
                if remove_non_surface_faces(obj, model):
                    imported.append(obj)
        if not imported:
            raise RuntimeError(f"No surface meshes remained for {model}")
        bpy.ops.object.select_all(action="DESELECT")
        for obj in imported:
            obj.select_set(True)
        bpy.context.view_layer.objects.active = imported[0]
        bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
        for obj in imported:
            for polygon in obj.data.polygons:
                polygon.use_smooth = True
        output_path = output_dir / f"acu-{model.lower()}.glb"
        bpy.ops.export_scene.gltf(
            filepath=str(output_path.resolve()),
            export_format="GLB",
            use_selection=True,
            export_apply=True,
            export_yup=True,
            export_materials="EXPORT",
            export_image_format="WEBP",
        )
        print(f"Exported {model}: {len(imported)} meshes -> {output_path}")


if __name__ == "__main__":
    main()
