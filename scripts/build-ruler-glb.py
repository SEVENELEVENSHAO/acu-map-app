#!/usr/bin/env python3
"""Blender background script: assemble source APK rulers into compact GLBs."""

from __future__ import annotations

import json
import sys
from pathlib import Path

import bpy
from mathutils import Matrix


COLORS = {
    "Head": (0.55, 0.92, 0.86, 1.0),
    "Torso": (0.98, 0.80, 0.43, 1.0),
    "Arm": (0.56, 0.78, 0.98, 1.0),
    "Hand": (0.73, 0.67, 0.98, 1.0),
    "Leg": (0.56, 0.86, 0.65, 1.0),
    "Other": (0.86, 0.88, 0.90, 1.0),
}


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


def region_material(region):
    material = bpy.data.materials.new(f"Reference ruler · {region}")
    material.diffuse_color = COLORS[region]
    material.use_nodes = True
    principled = material.node_tree.nodes.get("Principled BSDF")
    principled.inputs["Base Color"].default_value = COLORS[region]
    principled.inputs["Roughness"].default_value = 0.6
    principled.inputs["Emission Color"].default_value = (*COLORS[region][:3], 1.0)
    principled.inputs["Emission Strength"].default_value = 0.18
    return material


def main():
    manifest_path, output_dir = script_args()
    rows = json.loads(manifest_path.read_text(encoding="utf-8"))
    output_dir.mkdir(parents=True, exist_ok=True)
    for model in ("Male", "Female"):
        clear_scene()
        materials = {region: region_material(region) for region in COLORS}
        imported = []
        for row in (item for item in rows if item["model"] == model):
            before = set(bpy.data.objects)
            bpy.ops.wm.obj_import(filepath=row["object"], forward_axis="NEGATIVE_Z", up_axis="Y")
            objects = [obj for obj in bpy.data.objects if obj not in before and obj.type == "MESH"]
            for obj in objects:
                obj.matrix_world = obj.matrix_world @ Matrix(row["matrix"])
                obj.name = row["name"]
                obj.data.materials.clear()
                obj.data.materials.append(materials[row["region"]])
                obj["rulerLayer"] = "APK reference ruler"
                obj["region"] = row["region"]
                obj["source"] = "免费找穴位神器.apk"
                obj["reviewStatus"] = "pending"
                for polygon in obj.data.polygons:
                    polygon.use_smooth = False
                imported.append(obj)
        if not imported:
            raise RuntimeError(f"No source ruler meshes found for {model}")
        bpy.ops.object.select_all(action="DESELECT")
        for obj in imported:
            obj.select_set(True)
        bpy.context.view_layer.objects.active = imported[0]
        bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
        output_path = output_dir / f"rulers-{model.lower()}.glb"
        bpy.ops.export_scene.gltf(
            filepath=str(output_path.resolve()),
            export_format="GLB",
            use_selection=True,
            export_apply=True,
            export_yup=True,
            export_materials="EXPORT",
            export_extras=True,
        )
        triangles = sum(len(obj.data.loop_triangles) for obj in imported)
        print(f"Exported {model}: {len(imported)} ruler meshes, {triangles} triangles -> {output_path}")


if __name__ == "__main__":
    main()
