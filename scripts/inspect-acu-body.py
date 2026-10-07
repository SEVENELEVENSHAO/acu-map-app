#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
from pathlib import Path

import UnityPy


BODY_ROOTS = {"James_Body", "Jessi_Body"}


def ptr_object(pointer):
    try:
        return pointer.deref_parse_as_object()
    except Exception:
        return None


def vector(value):
    return [value.x, value.y, value.z]


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("data_dir", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    environment = UnityPy.load(str(args.data_dir.resolve() / "level0"))
    game_objects = {}
    transforms = {}
    transform_for_game_object = {}
    mesh_filters = {}
    mesh_renderers = {}

    for obj in environment.objects:
        kind = obj.type.name
        if kind == "GameObject":
            data = obj.read()
            game_objects[obj.path_id] = data
        elif kind in {"Transform", "RectTransform"}:
            data = obj.read()
            transforms[obj.path_id] = data
            transform_for_game_object[data.m_GameObject.path_id] = obj.path_id
        elif kind == "MeshFilter":
            data = obj.read()
            mesh_filters[data.m_GameObject.path_id] = data
        elif kind == "MeshRenderer":
            data = obj.read()
            mesh_renderers[data.m_GameObject.path_id] = data

    def lineage(game_object_id: int) -> list[str]:
        names = []
        transform_id = transform_for_game_object.get(game_object_id)
        while transform_id and len(names) < 20:
            transform = transforms[transform_id]
            game_object = game_objects.get(transform.m_GameObject.path_id)
            names.append(game_object.m_Name if game_object else "")
            transform_id = transform.m_Father.path_id
        return names

    rows = []
    for game_object_id, mesh_filter in mesh_filters.items():
        names = lineage(game_object_id)
        if not BODY_ROOTS.intersection(names):
            continue
        game_object = game_objects[game_object_id]
        transform = transforms[transform_for_game_object[game_object_id]]
        renderer = mesh_renderers.get(game_object_id)
        mesh = ptr_object(mesh_filter.m_Mesh)
        materials = []
        if renderer:
            for pointer in renderer.m_Materials:
                material = ptr_object(pointer)
                materials.append(material.m_Name if material else "")
        rows.append(
            {
                "gameObjectId": game_object_id,
                "name": game_object.m_Name,
                "lineage": names,
                "active": bool(game_object.m_IsActive),
                "rendererEnabled": bool(renderer.m_Enabled) if renderer else False,
                "meshPathId": mesh_filter.m_Mesh.path_id,
                "meshName": mesh.m_Name if mesh else "",
                "vertices": mesh.m_VertexData.m_VertexCount if mesh else 0,
                "subMeshes": len(mesh.m_SubMeshes) if mesh else 0,
                "materials": materials,
                "localPosition": vector(transform.m_LocalPosition),
                "localScale": vector(transform.m_LocalScale),
                "localRotation": [
                    transform.m_LocalRotation.x,
                    transform.m_LocalRotation.y,
                    transform.m_LocalRotation.z,
                    transform.m_LocalRotation.w,
                ],
            }
        )

    rows.sort(key=lambda row: (row["lineage"][-1], row["name"]))
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(rows, ensure_ascii=False, indent=2), encoding="utf-8")
    for row in rows:
        print(
            f"{row['lineage'][-1]:5} active={int(row['active'])} enabled={int(row['rendererEnabled'])} "
            f"verts={row['vertices']:7} sub={row['subMeshes']:2} {row['name']} -> {row['meshName']} "
            f"materials={','.join(row['materials'])}"
        )


if __name__ == "__main__":
    main()
