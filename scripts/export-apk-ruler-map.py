#!/usr/bin/env python3
"""Extract the original APK's acupoint -> proportional-ruler display rules."""

from __future__ import annotations

import argparse
import json
import struct
from collections import defaultdict
from pathlib import Path

import UnityPy


def read_aligned_string(data: bytes, offset: int) -> tuple[str, int]:
    length = struct.unpack_from("<i", data, offset)[0]
    start = offset + 4
    value = data[start : start + length].decode("utf-8", "replace")
    return value, (start + length + 3) & ~3


def mono_script_path(global_managers: Path, class_name: str) -> int:
    environment = UnityPy.load(str(global_managers))
    for obj in environment.objects:
        if obj.type.name == "MonoScript" and obj.read().m_ClassName == class_name:
            return obj.path_id
    raise RuntimeError(f"MonoScript {class_name!r} was not found")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("data_directory", type=Path, help="Extracted Unity assets/bin/Data directory")
    parser.add_argument("output", type=Path)
    args = parser.parse_args()

    script_path = mono_script_path(args.data_directory / "globalgamemanagers.assets", "KyungHyulPointB")
    environment = UnityPy.load(str(args.data_directory / "level0"))
    by_point: dict[str, set[tuple[str, ...]]] = defaultdict(set)
    source_records = 0

    for obj in environment.objects:
        if obj.type.name != "MonoBehaviour":
            continue
        behaviour = obj.read(check_read=False)
        if behaviour.m_Script.file_id != 1 or behaviour.m_Script.path_id != script_path:
            continue

        data = obj.get_raw_data()
        # MonoBehaviour base header is 32 bytes. KyungHyulPointB then stores
        # three Vector3 values and FOV before the channel string at byte 72.
        offset = 72
        channel, offset = read_aligned_string(data, offset)
        number = struct.unpack_from("<i", data, offset)[0]
        offset += 4

        active_count = struct.unpack_from("<i", data, offset)[0]
        offset += 4 + active_count * 12  # PPtr<GameObject> entries
        name_count = struct.unpack_from("<i", data, offset)[0]
        offset += 4
        names = []
        for _ in range(name_count):
            name, offset = read_aligned_string(data, offset)
            names.append(name)

        if active_count != name_count:
            raise RuntimeError(f"{channel}{number}: {active_count} active objects but {name_count} names")
        by_point[f"{channel}{number}"].add(tuple(names))
        source_records += 1

    conflicts = {point: values for point, values in by_point.items() if len(values) != 1}
    if conflicts:
        raise RuntimeError(f"Conflicting ruler lists for {len(conflicts)} point ids")

    points = {point: list(next(iter(values))) for point, values in sorted(by_point.items())}
    payload = {
        "schema": "acu-map-apk-point-rulers",
        "version": 1,
        "source": "免费找穴位神器.apk",
        "reviewStatus": "pending",
        "behavior": "Show only the ruler objects listed by the selected point's KyungHyulPointB.ActiveRulers/RulersName arrays.",
        "sourceRecords": source_records,
        "points": points,
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Wrote {len(points)} point rules from {source_records} APK records to {args.output}")
    print(f"Points with ruler references: {sum(bool(names) for names in points.values())}")


if __name__ == "__main__":
    main()
