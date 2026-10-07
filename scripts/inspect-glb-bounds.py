#!/usr/bin/env python3
import sys
from pathlib import Path

import bpy
from mathutils import Vector

path = Path(sys.argv[sys.argv.index("--") + 1]).resolve()
bpy.ops.object.select_all(action="SELECT")
bpy.ops.object.delete(use_global=False)
bpy.ops.import_scene.gltf(filepath=str(path))
for obj in sorted((item for item in bpy.context.scene.objects if item.type == "MESH"), key=lambda item: item.name):
    corners = [obj.matrix_world @ Vector(corner) for corner in obj.bound_box]
    minimum = [min(corner[index] for corner in corners) for index in range(3)]
    maximum = [max(corner[index] for corner in corners) for index in range(3)]
    print(obj.name, "min", *(round(value, 3) for value in minimum), "max", *(round(value, 3) for value in maximum))
