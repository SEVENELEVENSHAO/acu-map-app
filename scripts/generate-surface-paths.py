#!/usr/bin/env python3
"""Generate dense skin-following meridian paths on the native APK bodies in Blender."""

from __future__ import annotations

import json
import math
import statistics
import sys
from collections import defaultdict
from pathlib import Path

import bpy
from mathutils import Vector
from mathutils.bvhtree import BVHTree

PATH_BREAKS = {("BL", 40, 41)}


def nearest_surface(point, surfaces):
    best = None
    for obj, tree, inverse in surfaces:
        local = inverse @ point
        hit = tree.find_nearest(local)
        if not hit:
            continue
        location, normal, _, _ = hit
        world_location = obj.matrix_world @ location
        distance = (world_location - point).length
        if best is None or distance < best[0]:
            world_normal = (obj.matrix_world.to_3x3() @ normal).normalized()
            best = (distance, world_location, world_normal, obj)
    return best


def ray_surface(origin, direction, surfaces, max_distance=40.0):
    hits = []
    for obj, tree, inverse in surfaces:
        local_origin = inverse @ origin
        local_direction = (inverse.to_3x3() @ direction).normalized()
        hit = tree.ray_cast(local_origin, local_direction, max_distance)
        if not hit or hit[0] is None:
            continue
        location, normal, _, _ = hit
        world_location = obj.matrix_world @ location
        world_distance = (world_location - origin).length
        hits.append((world_distance, world_location, (obj.matrix_world.to_3x3() @ normal).normalized(), obj))
    return min(hits, key=lambda value: value[0]) if hits else None


def gltf_to_blender(position):
    x, y, z = position
    return Vector((x, -z, y))


def blender_to_gltf(position):
    return [round(position.x, 5), round(position.z, 5), round(-position.y, 5)]


def projection_options(baseline, normal, surfaces):
    normal = normal.normalized()
    # Cast through the skin from outside toward the interpolated chord. This
    # selects the outward contour instead of the nearest internal/back face.
    hit = ray_surface(baseline + normal * 18.0, -normal, surfaces, 36.0)
    nearest = nearest_surface(baseline, surfaces)
    options = []
    if nearest:
        options.append(nearest[1] + nearest[2] * 0.07)
    if hit and (not nearest or (hit[1] - baseline).length <= nearest[0] + 6.0):
        _, location, hit_normal, _ = hit
        if hit_normal.dot(normal) < 0:
            hit_normal.negate()
        ray_option = location + hit_normal * 0.07
        if not options or (ray_option - options[0]).length > 0.05:
            options.append(ray_option)
    return options or [baseline]


def project_segment(left_point, right_point, left_normal, right_normal, left_surfaces, right_surfaces, steps):
    """Project with a minimum-distance transition between separate body meshes."""
    same_surface = left_surfaces[0][0] == right_surfaces[0][0]
    candidates = []
    for step in range(steps + 1):
        mix = step / steps
        baseline = left_point.lerp(right_point, mix)
        normal = left_normal.lerp(right_normal, mix)
        if normal.length_squared < 1e-8:
            normal = left_normal
        if step == 0:
            row = [(0, left_point, baseline)]
        elif step == steps:
            row = [((0 if same_surface else 1), right_point, baseline)]
        elif same_surface:
            row = [(0, position, baseline) for position in projection_options(baseline, normal, left_surfaces)]
        else:
            row = [(0, position, baseline) for position in projection_options(baseline, normal, left_surfaces)]
            row += [(1, position, baseline) for position in projection_options(baseline, normal, right_surfaces)]
        candidates.append([(candidate_id, state, position, base) for candidate_id, (state, position, base) in enumerate(row)])

    costs = [{0: 0.0}]
    previous = [{}]
    for index in range(1, len(candidates)):
        row_costs, row_previous = {}, {}
        for candidate_id, state, position, baseline in candidates[index]:
            best = None
            for previous_id, previous_cost in costs[index - 1].items():
                previous_item = next(item for item in candidates[index - 1] if item[0] == previous_id)
                previous_state, previous_position = previous_item[1], previous_item[2]
                if previous_state == 1 and state == 0:
                    continue
                transition = (position - previous_position).length
                # Discourage unnecessary mesh hopping and large detours while
                # allowing the switch wherever the two parts meet most closely.
                switch_penalty = 0.35 if state != previous_state else 0.0
                score = previous_cost + transition + (position - baseline).length * 0.04 + switch_penalty
                if best is None or score < best[0]:
                    best = (score, previous_id)
            row_costs[candidate_id], row_previous[candidate_id] = best
        costs.append(row_costs)
        previous.append(row_previous)

    candidate_id = candidates[-1][0][0]
    result = [None] * len(candidates)
    for index in range(len(candidates) - 1, -1, -1):
        result[index] = next(item[2] for item in candidates[index] if item[0] == candidate_id)
        if index:
            candidate_id = previous[index][candidate_id]
    return result


def main():
    args = sys.argv[sys.argv.index("--") + 1:]
    male_path, female_path, data_path, output_path = map(Path, args[:4])
    source = json.loads(data_path.read_text(encoding="utf-8"))
    output = {
        "schema": "acu-map-native-surface-paths",
        "version": 1,
        "sourceSha256": source["source"]["sha256"],
        "models": {},
    }
    all_offsets = []
    for model, model_path in (("Male", male_path), ("Female", female_path)):
        bpy.ops.object.select_all(action="SELECT")
        bpy.ops.object.delete(use_global=False)
        bpy.ops.import_scene.gltf(filepath=str(model_path.resolve()))
        depsgraph = bpy.context.evaluated_depsgraph_get()
        surfaces = []
        for obj in bpy.context.scene.objects:
            if obj.type == "MESH":
                surfaces.append((obj, BVHTree.FromObject(obj, depsgraph), obj.matrix_world.inverted()))

        groups = defaultdict(list)
        for point in source["points"]:
            if point["model"] == model:
                groups[f"{point['channel']}:{point['side']}"].append(point)

        paths = {}
        for group_key, points in sorted(groups.items()):
            points.sort(key=lambda value: value["number"])
            samples = []
            for segment_index, (left, right) in enumerate(zip(points, points[1:])):
                left_key, right_key = f"{left['id']}:{left['side']}", f"{right['id']}:{right['side']}"
                left_point = gltf_to_blender((-left["sourcePosition"][0], left["sourcePosition"][1], left["sourcePosition"][2]))
                right_point = gltf_to_blender((-right["sourcePosition"][0], right["sourcePosition"][1], right["sourcePosition"][2]))
                if (left["channel"], left["number"], right["number"]) in PATH_BREAKS:
                    samples.append(
                        {
                            "from": right_key,
                            "to": right_key,
                            "mix": 0.0,
                            "position": blender_to_gltf(right_point),
                            "breakBefore": True,
                        }
                    )
                    continue
                left_surface = nearest_surface(left_point, surfaces)
                right_surface = nearest_surface(right_point, surfaces)
                left_normal = left_surface[2] if left_surface else Vector((0, 1, 0))
                right_normal = right_surface[2] if right_surface else left_normal
                left_object = left_surface[3] if left_surface else None
                right_object = right_surface[3] if right_surface else left_object
                left_surfaces = [surface for surface in surfaces if surface[0] == left_object] or surfaces
                right_surfaces = [surface for surface in surfaces if surface[0] == right_object] or left_surfaces
                steps = max(2, min(48, math.ceil((right_point - left_point).length / 1.25)))
                projected = project_segment(left_point, right_point, left_normal, right_normal, left_surfaces, right_surfaces, steps)
                for step, position in enumerate(projected):
                    if segment_index and step == 0:
                        continue
                    mix = step / steps
                    nearest = nearest_surface(position, surfaces)
                    if nearest:
                        all_offsets.append(nearest[0])
                    samples.append(
                        {
                            "from": left_key,
                            "to": right_key,
                            "mix": round(mix, 6),
                            "position": blender_to_gltf(position),
                        }
                    )
            if samples:
                paths[group_key] = samples
        output["models"][model] = {"paths": paths}
        print(f"{model}: {len(paths)} paths, {sum(len(path) for path in paths.values())} surface samples")

    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(output, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(
        "surface offset",
        "median", round(statistics.median(all_offsets), 5),
        "mean", round(statistics.mean(all_offsets), 5),
        "max", round(max(all_offsets), 5),
    )
    print(f"Wrote {output_path}")


if __name__ == "__main__":
    main()
