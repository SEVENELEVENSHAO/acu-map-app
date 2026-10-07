#!/usr/bin/env python3
"""Find ruler and proportional-measurement assets in the source Unity APK."""

from __future__ import annotations

import argparse
import json
import re
from pathlib import Path

import UnityPy


PATTERN = re.compile(r"ruler|measure|measurement|scale|cun|inch|distance|尺|寸|比例", re.I)


def matching_strings(value, path="root"):
    matches = []
    if isinstance(value, str):
        if PATTERN.search(value):
            matches.append((path, value))
    elif isinstance(value, dict):
        for key, item in value.items():
            matches.extend(matching_strings(key, f"{path}.<key>"))
            matches.extend(matching_strings(item, f"{path}.{key}"))
    elif isinstance(value, (list, tuple)):
        for index, item in enumerate(value):
            matches.extend(matching_strings(item, f"{path}[{index}]"))
    return matches


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("unity_data", type=Path)
    parser.add_argument("--path-id", type=int)
    args = parser.parse_args()
    environment = UnityPy.load(str(args.unity_data.resolve()))
    if args.path_id:
        objects = {obj.path_id: obj for obj in environment.objects}
        target = objects[args.path_id].read()
        payload = {"object": objects[args.path_id].read_typetree(), "components": []}
        for component in getattr(target, "m_Component", []):
            pointer = component.component
            component_obj = objects.get(pointer.path_id)
            if component_obj:
                try:
                    tree = component_obj.read_typetree()
                except Exception as error:
                    tree = {"error": str(error)}
                payload["components"].append({"pathId": pointer.path_id, "type": component_obj.type.name, "data": tree})
        print(json.dumps(payload, ensure_ascii=False, indent=2, default=str))
        return
    hits = []
    type_counts = {}
    for obj in environment.objects:
        type_name = obj.type.name
        type_counts[type_name] = type_counts.get(type_name, 0) + 1
        name = ""
        try:
            data = obj.read()
            name = getattr(data, "name", "") or getattr(data, "m_Name", "") or ""
        except Exception:
            data = None
        matches = []
        if name and PATTERN.search(str(name)):
            matches.append(("name", str(name)))
        if type_name in {"MonoBehaviour", "GameObject", "TextAsset"}:
            try:
                matches.extend(matching_strings(obj.read_typetree()))
            except Exception:
                pass
        if matches:
            hits.append({
                "file": Path(obj.assets_file.name).name,
                "pathId": obj.path_id,
                "type": type_name,
                "name": str(name),
                "matches": matches[:100],
            })
    print(json.dumps({"typeCounts": type_counts, "hits": hits}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
