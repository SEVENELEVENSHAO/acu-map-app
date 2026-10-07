#!/usr/bin/env python3
import json
import statistics
import sys
from pathlib import Path

import bpy
from mathutils import Vector
from mathutils.bvhtree import BVHTree

args = sys.argv[sys.argv.index("--") + 1:]
model_path, data_path, model_name = Path(args[0]).resolve(), Path(args[1]).resolve(), args[2]
bpy.ops.object.select_all(action="SELECT")
bpy.ops.object.delete(use_global=False)
bpy.ops.import_scene.gltf(filepath=str(model_path))
depsgraph = bpy.context.evaluated_depsgraph_get()
trees = []
for obj in bpy.context.scene.objects:
    if obj.type == "MESH":
        trees.append(BVHTree.FromObject(obj, depsgraph))
data = json.loads(data_path.read_text(encoding="utf-8"))
distances = []
worst = []
for point in (item for item in data["points"] if item["model"] == model_name):
    x, y, z = point["sourcePosition"]
    # Blender imports glTF Y-up coordinates into its Z-up working basis.
    location = Vector((-x, -z, y))
    nearest = min((tree.find_nearest(location) for tree in trees), key=lambda hit: hit[3] if hit else float("inf"))
    distance = nearest[3] if nearest else float("inf")
    distances.append(distance)
    worst.append((distance, f"{point['id']}:{point['side']}"))
print("model", model_name, "points", len(distances))
print("distance min", round(min(distances), 4), "median", round(statistics.median(distances), 4), "mean", round(statistics.mean(distances), 4), "max", round(max(distances), 4))
print("within 1", sum(value <= 1 for value in distances), "within 3", sum(value <= 3 for value in distances), "within 5", sum(value <= 5 for value in distances))
print("worst", sorted(worst, reverse=True)[:12])
