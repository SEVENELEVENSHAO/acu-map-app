#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
from collections import Counter
from pathlib import Path

import UnityPy


def ptr_name(pointer) -> str:
    try:
        return pointer.deref_parse_as_object().m_Name
    except Exception:
        return ""


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("data_dir", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    data_dir = args.data_dir.resolve()
    environment = UnityPy.load(str(data_dir / "level0"))
    counts = Counter(obj.type.name for obj in environment.objects)
    game_objects = {}
    components = {}
    transforms = {}
    transform_for_game_object = {}
    renderers = []

    for obj in environment.objects:
        kind = obj.type.name
        if kind == "GameObject":
            data = obj.read()
            game_objects[obj.path_id] = data.m_Name
            components[obj.path_id] = [component.component.type.name for component in data.m_Component]
        elif kind in {"Transform", "RectTransform"}:
            data = obj.read()
            transforms[obj.path_id] = data
            transform_for_game_object[data.m_GameObject.path_id] = obj.path_id
        elif kind in {"SkinnedMeshRenderer", "MeshRenderer"}:
            data = obj.read()
            game_object_id = data.m_GameObject.path_id
            mesh_name = ptr_name(data.m_Mesh) if hasattr(data, "m_Mesh") else ""
            renderers.append(
                {
                    "type": kind,
                    "pathId": obj.path_id,
                    "gameObjectId": game_object_id,
                    "gameObject": game_objects.get(game_object_id, ""),
                    "mesh": mesh_name,
                    "materials": [ptr_name(pointer) for pointer in data.m_Materials],
                    "bones": len(getattr(data, "m_Bones", [])),
                    "rootBone": ptr_name(getattr(data, "m_RootBone", None)),
                }
            )

    def parents(game_object_id: int) -> list[str]:
        names = []
        transform_id = transform_for_game_object.get(game_object_id)
        while transform_id and len(names) < 16:
            transform = transforms[transform_id]
            names.append(game_objects.get(transform.m_GameObject.path_id, ""))
            transform_id = transform.m_Father.path_id
        return names

    for renderer in renderers:
        renderer["parents"] = parents(renderer["gameObjectId"])

    interesting = []
    for game_object_id, name in game_objects.items():
        lineage = parents(game_object_id)
        haystack = " ".join([name, *lineage]).lower()
        if any(token in haystack for token in ("james", "jessi", "male", "female", "body", "skin", "meri")):
            interesting.append(
                {
                    "pathId": game_object_id,
                    "name": name,
                    "components": components.get(game_object_id, []),
                    "parents": lineage,
                }
            )

    output = {
        "counts": counts,
        "gameObjectCount": len(game_objects),
        "renderers": renderers,
        "interestingObjects": interesting,
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(output, ensure_ascii=False, indent=2, default=dict), encoding="utf-8")
    print(json.dumps({"counts": counts, "renderers": renderers}, ensure_ascii=False, indent=2, default=dict))


if __name__ == "__main__":
    main()
