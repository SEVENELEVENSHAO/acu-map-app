#!/usr/bin/env python3
"""Export source APK ruler renderers with their world transforms and regions."""

from __future__ import annotations

import argparse
import importlib.util
import json
import re
from pathlib import Path

import UnityPy


def load_export_helpers():
    source = Path(__file__).with_name("export-acu-bodies.py")
    spec = importlib.util.spec_from_file_location("acu_body_export", source)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def ruler_model(lineage):
    if "jessi_Ruler_all" in lineage:
        return "Female"
    if "Ruler_all" in lineage:
        return "Male"
    return None


def ruler_region(name):
    raw = name.split("_", 2)[1] if name.startswith("Ruler_") and "_" in name else "Other"
    match = re.match(r"[A-Za-z]+", raw)
    token = match.group(0) if match else "Other"
    return {
        "Face": "Head",
        "Neck": "Head",
        "Chest": "Torso",
        "Back": "Torso",
        "Hip": "Torso",
        "Foot": "Leg",
    }.get(token, token if token in {"Head", "Arm", "Hand", "Leg"} else "Other")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("data_dir", type=Path)
    parser.add_argument("output_dir", type=Path)
    args = parser.parse_args()
    helpers = load_export_helpers()
    environment = UnityPy.load(str((args.data_dir / "level0").resolve()))

    game_objects = {}
    transforms = {}
    transform_for_game_object = {}
    renderers = {}
    for obj in environment.objects:
        kind = obj.type.name
        if kind == "GameObject":
            game_objects[obj.path_id] = obj.read()
        elif kind in {"Transform", "RectTransform"}:
            transform = obj.read()
            transforms[obj.path_id] = transform
            transform_for_game_object[transform.m_GameObject.path_id] = obj.path_id
        elif kind == "MeshRenderer":
            renderer = obj.read()
            renderers[renderer.m_GameObject.path_id] = renderer

    world_cache = {}

    def world_matrix(transform_id):
        if transform_id in world_cache:
            return world_cache[transform_id]
        transform = transforms[transform_id]
        local = helpers.trs_matrix(transform)
        father = transform.m_Father.path_id
        world_cache[transform_id] = helpers.multiply(world_matrix(father), local) if father else local
        return world_cache[transform_id]

    def lineage(game_object_id):
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
        model = ruler_model(names)
        if not model:
            continue
        game_object = game_objects[game_object_id]
        if not renderer.m_Enabled:
            continue
        if hasattr(renderer, "m_SubsetIndices") and not renderer.m_SubsetIndices:
            delattr(renderer, "m_SubsetIndices")
        renderer_dir = args.output_dir / model / f"{game_object_id}_{helpers.safe_name(game_object.m_Name)}"
        object_path = helpers.export_renderer(renderer, renderer_dir, game_object.m_Name)
        if not object_path:
            continue
        manifest.append({
            "model": model,
            "region": ruler_region(game_object.m_Name),
            "name": game_object.m_Name,
            "object": str(object_path.resolve()),
            "matrix": helpers.reflected(world_matrix(transform_for_game_object[game_object_id])),
            "lineage": names,
        })

    manifest_path = args.output_dir / "manifest.json"
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    summary = {}
    for row in manifest:
        key = f"{row['model']}:{row['region']}"
        summary[key] = summary.get(key, 0) + 1
    print(json.dumps({"renderers": len(manifest), "groups": summary}, indent=2))
    print(manifest_path)


if __name__ == "__main__":
    main()
