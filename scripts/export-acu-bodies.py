#!/usr/bin/env python3
"""Export the APK's native male/female body renderers and their world matrices."""

from __future__ import annotations

import argparse
import json
import re
from pathlib import Path

import UnityPy
import UnityPy.export.MeshRendererExporter as mesh_renderer_exporter
from UnityPy.export.MeshExporter import export_mesh_obj


BODY_ROOTS = {"James_Body": "Male", "Jessi_Body": "Female"}


def export_material(material):
    """UnityPy's current MTL helper expects obsolete uppercase Color fields."""
    def pairs(values):
        return {key if isinstance(key, str) else key.name: value for key, value in values if value is not None}

    def color(value, default):
        if value is None:
            return default
        return tuple(getattr(value, field) for field in ("r", "g", "b", "a"))

    colors = pairs(material.m_SavedProperties.m_Colors)
    floats = pairs(material.m_SavedProperties.m_Floats)
    textures = pairs(material.m_SavedProperties.m_TexEnvs)
    diffuse = color(colors.get("_Color"), (0.8, 0.8, 0.8, 1.0))
    ambient = color(colors.get("_SColor"), (0.2, 0.2, 0.2, 1.0))
    specular = color(colors.get("_SpecularColor"), (0.2, 0.2, 0.2, 1.0))
    lines = [
        f"newmtl {material.m_Name}",
        f"Ka {ambient[0]:.4f} {ambient[1]:.4f} {ambient[2]:.4f}",
        f"Kd {diffuse[0]:.4f} {diffuse[1]:.4f} {diffuse[2]:.4f}",
        f"Ks {specular[0]:.4f} {specular[1]:.4f} {specular[2]:.4f}",
        f"Tr {floats.get('_Transparency', 0.0):.4f}",
        f"Ns {floats.get('_Shininess', 20.0):.4f}",
    ]
    for key, texture_environment in textures.items():
        if not texture_environment.m_Texture:
            continue
        texture = texture_environment.m_Texture.deref_parse_as_object()
        texture_name = f"{texture.m_Name if texture.m_Name else key}.png"
        if key == "_MainTex":
            lines.append(f"map_Kd {texture_name}")
        elif key == "_BumpMap":
            lines.append(f"map_bump {texture_name}")
    return "\n".join(lines)


mesh_renderer_exporter.export_material = export_material


def export_renderer(renderer, output_dir: Path, fallback_name: str) -> Path | None:
    mesh = mesh_renderer_exporter.get_mesh(renderer)
    if not mesh:
        return None
    output_dir.mkdir(parents=True, exist_ok=True)
    material_names = []
    material_text = []
    for pointer in renderer.m_Materials:
        try:
            material = pointer.deref_parse_as_object()
        except Exception:
            material_names.append(None)
            continue
        material_names.append(material.m_Name)
        material_text.append(export_material(material))
        for key, texture_environment in material.m_SavedProperties.m_TexEnvs:
            if not texture_environment.m_Texture:
                continue
            texture = texture_environment.m_Texture.deref_parse_as_object()
            key_name = key if isinstance(key, str) else key.name
            texture_name = f"{texture.m_Name if texture.m_Name else key_name}.png"
            texture.image.save(output_dir / texture_name)
    stem = safe_name(mesh.m_Name or fallback_name)
    object_path = output_dir / f"{stem}.obj"
    object_path.write_text(export_mesh_obj(mesh, material_names), encoding="utf-8", newline="")
    (output_dir / f"{stem}.mtl").write_text("\n".join(material_text), encoding="utf-8", newline="")
    return object_path


def quaternion_matrix(rotation):
    x, y, z, w = rotation.x, rotation.y, rotation.z, rotation.w
    length = x * x + y * y + z * z + w * w
    if length < 1e-16:
        return [[1, 0, 0], [0, 1, 0], [0, 0, 1]]
    scale = 2 / length
    xx, yy, zz = x * x * scale, y * y * scale, z * z * scale
    xy, xz, yz = x * y * scale, x * z * scale, y * z * scale
    wx, wy, wz = w * x * scale, w * y * scale, w * z * scale
    return [
        [1 - yy - zz, xy - wz, xz + wy],
        [xy + wz, 1 - xx - zz, yz - wx],
        [xz - wy, yz + wx, 1 - xx - yy],
    ]


def trs_matrix(transform):
    rotation = quaternion_matrix(transform.m_LocalRotation)
    scale = transform.m_LocalScale
    values = [[0.0] * 4 for _ in range(4)]
    for row in range(3):
        for column, factor in enumerate((scale.x, scale.y, scale.z)):
            values[row][column] = rotation[row][column] * factor
    position = transform.m_LocalPosition
    values[0][3], values[1][3], values[2][3] = position.x, position.y, position.z
    values[3][3] = 1.0
    return values


def multiply(left, right):
    return [
        [sum(left[row][k] * right[k][column] for k in range(4)) for column in range(4)]
        for row in range(4)
    ]


def reflected(matrix):
    """Conjugate Unity transform by X reflection used by UnityPy's OBJ exporter."""
    reflection = [[-1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]]
    return multiply(multiply(reflection, matrix), reflection)


def safe_name(value: str) -> str:
    return re.sub(r"[^A-Za-z0-9_.-]+", "_", value).strip("_")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("data_dir", type=Path)
    parser.add_argument("output_dir", type=Path)
    args = parser.parse_args()

    environment = UnityPy.load(str((args.data_dir / "level0").resolve()))
    game_objects = {}
    transforms = {}
    transform_for_game_object = {}
    renderers = {}

    for obj in environment.objects:
        if obj.type.name == "GameObject":
            game_objects[obj.path_id] = obj.read()
        elif obj.type.name in {"Transform", "RectTransform"}:
            transform = obj.read()
            transforms[obj.path_id] = transform
            transform_for_game_object[transform.m_GameObject.path_id] = obj.path_id
        elif obj.type.name == "MeshRenderer":
            renderer = obj.read()
            renderers[renderer.m_GameObject.path_id] = renderer

    world_cache = {}

    def world_matrix(transform_id: int):
        if transform_id in world_cache:
            return world_cache[transform_id]
        transform = transforms[transform_id]
        local = trs_matrix(transform)
        father = transform.m_Father.path_id
        world_cache[transform_id] = multiply(world_matrix(father), local) if father else local
        return world_cache[transform_id]

    def lineage(game_object_id: int):
        result = []
        transform_id = transform_for_game_object.get(game_object_id)
        while transform_id:
            transform = transforms[transform_id]
            game_object = game_objects.get(transform.m_GameObject.path_id)
            result.append(game_object.m_Name if game_object else "")
            transform_id = transform.m_Father.path_id
        return result

    manifest = []
    args.output_dir.mkdir(parents=True, exist_ok=True)
    for game_object_id, renderer in renderers.items():
        names = lineage(game_object_id)
        root = next((name for name in names if name in BODY_ROOTS), None)
        if not root:
            continue
        game_object = game_objects[game_object_id]
        if not game_object.m_IsActive or not renderer.m_Enabled:
            continue
        model = BODY_ROOTS[root]
        transform_id = transform_for_game_object[game_object_id]
        renderer_dir = args.output_dir / model / f"{game_object_id}_{safe_name(game_object.m_Name)}"
        renderer_dir.mkdir(parents=True, exist_ok=True)
        # UnityPy 1.25 treats a present-but-empty legacy field as iterable.
        if hasattr(renderer, "m_SubsetIndices") and not renderer.m_SubsetIndices:
            delattr(renderer, "m_SubsetIndices")
        object_path = export_renderer(renderer, renderer_dir, game_object.m_Name)
        if not object_path:
            continue
        material_names = []
        for pointer in renderer.m_Materials:
            try:
                material_names.append(pointer.deref_parse_as_object().m_Name)
            except Exception:
                material_names.append("")
        manifest.append(
            {
                "model": model,
                "name": game_object.m_Name,
                "object": str(object_path.resolve()),
                "materials": material_names,
                "matrix": reflected(world_matrix(transform_id)),
                "lineage": names,
            }
        )
        print(f"{model:6} {game_object.m_Name} -> {object_path.name}")

    manifest_path = args.output_dir / "manifest.json"
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Wrote {len(manifest)} renderers to {manifest_path}")


if __name__ == "__main__":
    main()
