#!/usr/bin/env python3
"""Build smooth, skin-conforming ribbons around registered meridian paths."""

from __future__ import annotations

import json
import sys
from pathlib import Path

import bpy
from mathutils import Vector
from mathutils.bvhtree import BVHTree


COLORS = {
    "LU": "c9d5d8", "LI": "f1f3ee", "ST": "f2dc4a", "SP": "e98632",
    "HT": "a96bd2", "SI": "8a72d4", "BL": "4b72e8", "KI": "4055bd",
    "PC": "d45359", "TE": "ef655e", "GB": "75cb58", "LR": "3d9f62",
    "CV": "54c5b0", "GV": "e78bb2",
}
HALF_WIDTH = 2.4
SURFACE_LIFT = 0.055
BORDER_SMOOTHING_PASSES = 3
MAX_JOIN_LENGTH = 6.0


def script_args():
    marker = sys.argv.index("--") + 1
    return Path(sys.argv[marker]), Path(sys.argv[marker + 1]), Path(sys.argv[marker + 2])


def clear_scene():
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for collection in (bpy.data.meshes, bpy.data.materials, bpy.data.images):
        for block in list(collection):
            if block.users == 0:
                collection.remove(block)


def build_skin_bvh(skin_objects):
    vertices = []
    polygons = []
    for obj in skin_objects:
        matrix = obj.matrix_world
        offset = len(vertices)
        vertices.extend(matrix @ vertex.co for vertex in obj.data.vertices)
        polygons.extend(tuple(offset + index for index in polygon.vertices) for polygon in obj.data.polygons)
    if not vertices or not polygons:
        raise RuntimeError("The source body model does not contain a skin mesh")
    return BVHTree.FromPolygons(vertices, polygons, all_triangles=False)


def split_path(path):
    segments = []
    current = []
    for sample in path:
        if sample.get("breakBefore") and current:
            segments.append(current)
            current = []
        x, y, z = sample["position"]
        point = Vector((x, -z, y))  # glTF Y-up to Blender Z-up.
        if not current or (point - current[-1]).length_squared > 0.0001:
            current.append(point)
    if current:
        segments.append(current)
    return [segment for segment in segments if len(segment) >= 2]


def nearest_surface(bvh, point):
    location, normal, _, _ = bvh.find_nearest(point)
    if location is None:
        raise RuntimeError(f"Could not project point {tuple(point)} onto the skin")
    return location, normal.normalized()


def projected_boundary_point(bvh, center, center_normal, lateral, sign):
    """Project a tangent-plane offset while avoiding jumps across thin body parts."""
    fallback = None
    for scale in (1.0, 0.9, 0.78, 0.65, 0.5):
        target = center + lateral * (HALF_WIDTH * sign * scale)
        location, normal = nearest_surface(bvh, target)
        if normal.dot(center_normal) < 0:
            normal.negate()
        fallback = (location, normal)
        if (location - center).length <= HALF_WIDTH * 1.7 and normal.dot(center_normal) >= 0.1:
            return location, normal
    return fallback


def smooth_boundary(bvh, points, passes):
    result = list(points)
    if len(result) < 3:
        return result
    for _ in range(passes):
        previous = list(result)
        for index in range(1, len(previous) - 1):
            proposal = (previous[index - 1] + previous[index] * 2.0 + previous[index + 1]) * 0.25
            result[index], _ = nearest_surface(bvh, proposal)
    return result


def build_strip(segment, bvh):
    centers = []
    normals = []
    for point in segment:
        center, normal = nearest_surface(bvh, point)
        centers.append(center)
        normals.append(normal)

    left = []
    right = []
    previous_lateral = None
    for index, center in enumerate(centers):
        if index == 0:
            tangent = centers[1] - center
        elif index == len(centers) - 1:
            tangent = center - centers[index - 1]
        else:
            tangent = centers[index + 1] - centers[index - 1]
        tangent -= normals[index] * tangent.dot(normals[index])
        if tangent.length_squared < 1e-8:
            tangent = centers[min(index + 1, len(centers) - 1)] - centers[max(index - 1, 0)]
        tangent.normalize()
        lateral = tangent.cross(normals[index]).normalized()
        if previous_lateral is not None and lateral.dot(previous_lateral) < 0:
            lateral.negate()
        previous_lateral = lateral.copy()
        left_point, _ = projected_boundary_point(bvh, center, normals[index], lateral, 1.0)
        right_point, _ = projected_boundary_point(bvh, center, normals[index], lateral, -1.0)
        left.append(left_point)
        right.append(right_point)

    left = smooth_boundary(bvh, left, BORDER_SMOOTHING_PASSES)
    right = smooth_boundary(bvh, right, BORDER_SMOOTHING_PASSES)
    return left, right


def color_value(hex_color):
    return tuple(int(hex_color[index:index + 2], 16) / 255 for index in (0, 2, 4))


def channel_material(channel):
    material = bpy.data.materials.new(f"{channel} computed skin zone")
    rgb = color_value(COLORS[channel])
    material.diffuse_color = (*rgb, 0.3)
    material.use_nodes = True
    principled = material.node_tree.nodes.get("Principled BSDF")
    principled.inputs["Base Color"].default_value = (*rgb, 1)
    principled.inputs["Alpha"].default_value = 0.3
    principled.inputs["Roughness"].default_value = 0.82
    return material


def make_zone(name, channel, path, bvh, material):
    vertices = []
    faces = []
    for segment in split_path(path):
        left, right = build_strip(segment, bvh)
        start = len(vertices)
        for left_point, right_point in zip(left, right):
            left_location, left_normal = nearest_surface(bvh, left_point)
            right_location, right_normal = nearest_surface(bvh, right_point)
            vertices.extend((
                left_location + left_normal * SURFACE_LIFT,
                right_location + right_normal * SURFACE_LIFT,
            ))
        for index in range(len(left) - 1):
            a = start + index * 2
            b = a + 1
            c = a + 2
            d = a + 3
            if max(
                (vertices[c] - vertices[a]).length,
                (vertices[d] - vertices[b]).length,
                (vertices[b] - vertices[a]).length,
                (vertices[d] - vertices[c]).length,
            ) <= MAX_JOIN_LENGTH:
                faces.append((a, b, d, c))

    if not faces:
        raise RuntimeError(f"No skin ribbon generated for {name}")
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(vertices, [], faces)
    mesh.materials.append(material)
    for polygon in mesh.polygons:
        polygon.use_smooth = True
    mesh.calc_loop_triangles()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    obj["channel"] = channel
    obj["layer"] = "computed-meridian-skin-zone"
    obj["reviewStatus"] = "pending"
    obj["halfWidth"] = HALF_WIDTH
    obj["borderSmoothing"] = BORDER_SMOOTHING_PASSES
    obj["surfaceLift"] = SURFACE_LIFT
    return obj


def main():
    manifest_path, paths_path, output_dir = script_args()
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    path_data = json.loads(paths_path.read_text(encoding="utf-8"))
    public_dir = manifest_path.parent.parent
    output_dir.mkdir(parents=True, exist_ok=True)

    for model in manifest["models"]:
        clear_scene()
        bpy.ops.import_scene.gltf(filepath=str((public_dir / model["url"]).resolve()))
        skin_objects = [obj for obj in bpy.context.scene.objects if obj.type == "MESH"]
        bvh = build_skin_bvh(skin_objects)
        materials = {channel: channel_material(channel) for channel in COLORS}
        zones = []
        for key, path in path_data["models"][model["id"]]["paths"].items():
            channel = key.split(":", 1)[0]
            zones.append(make_zone(f"{key} computed skin zone", channel, path, bvh, materials[channel]))

        for obj in skin_objects:
            bpy.data.objects.remove(obj, do_unlink=True)
        bpy.ops.object.select_all(action="DESELECT")
        for zone in zones:
            zone.select_set(True)
        bpy.context.view_layer.objects.active = zones[0]
        output_path = output_dir / f"skin-zones-{model['id'].lower()}.glb"
        bpy.ops.export_scene.gltf(
            filepath=str(output_path.resolve()),
            export_format="GLB",
            use_selection=True,
            export_apply=True,
            export_yup=True,
            export_materials="EXPORT",
            export_extras=True,
        )
        triangles = sum(len(zone.data.loop_triangles) for zone in zones)
        print(f"Exported {model['id']}: {len(zones)} smooth projected skin zones, {triangles} triangles -> {output_path}")


if __name__ == "__main__":
    main()
