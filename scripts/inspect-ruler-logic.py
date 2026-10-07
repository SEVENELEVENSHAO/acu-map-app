#!/usr/bin/env python3
"""Inspect ruler-controller MonoBehaviours and serialized point/ruler links."""

from __future__ import annotations

import argparse
import json
import re
from pathlib import Path

import UnityPy


PATTERN = re.compile(r"ruler|measure|cun|尺|寸", re.I)


def walk(value, path="root"):
    hits = []
    if isinstance(value, dict):
        for key, child in value.items():
            next_path = f"{path}.{key}"
            if PATTERN.search(str(key)):
                hits.append({"path": next_path, "value": child})
            hits.extend(walk(child, next_path))
    elif isinstance(value, list):
        for index, child in enumerate(value):
            hits.extend(walk(child, f"{path}[{index}]"))
    elif isinstance(value, str) and PATTERN.search(value):
        hits.append({"path": path, "value": value})
    return hits


def pointer_name(pointer):
    try:
        script = pointer.deref_parse_as_object()
        return getattr(script, "m_ClassName", "") or getattr(script, "m_Name", "")
    except Exception:
        return ""


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("level", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    environment = UnityPy.load(str(args.level.resolve()))
    objects = {obj.path_id: obj for obj in environment.objects}
    game_objects = {obj.path_id: obj.read().m_Name for obj in environment.objects if obj.type.name == "GameObject"}
    results = []
    for obj in environment.objects:
        if obj.type.name != "MonoBehaviour":
            continue
        try:
            data = obj.read()
            tree = obj.read_typetree()
        except Exception:
            continue
        hits = walk(tree)
        script = pointer_name(getattr(data, "m_Script", None))
        if PATTERN.search(script) or hits:
            game_object_id = getattr(getattr(data, "m_GameObject", None), "path_id", 0)
            results.append({
                "pathId": obj.path_id,
                "script": script,
                "gameObjectId": game_object_id,
                "gameObject": game_objects.get(game_object_id, ""),
                "hits": hits,
                "tree": tree,
            })
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(results, ensure_ascii=False, indent=2, default=str), encoding="utf-8")
    print(json.dumps([{key: row[key] for key in ("pathId", "script", "gameObjectId", "gameObject", "hits")} for row in results], ensure_ascii=False, indent=2, default=str))
    print(f"Wrote {len(results)} ruler-related behaviours to {args.output}")


if __name__ == "__main__":
    main()
