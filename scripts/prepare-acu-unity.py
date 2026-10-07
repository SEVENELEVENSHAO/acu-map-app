#!/usr/bin/env python3
from __future__ import annotations

import argparse
import shutil
import zipfile
from pathlib import Path


def join_splits(data_dir: Path, base_name: str) -> Path:
    output = data_dir / base_name
    parts = sorted(
        data_dir.glob(f"{base_name}.split*"),
        key=lambda path: int(path.name.rsplit("split", 1)[1]),
    )
    if not parts:
        raise FileNotFoundError(f"No split files found for {base_name}")
    with output.open("wb") as destination:
        for part in parts:
            with part.open("rb") as source:
                shutil.copyfileobj(source, destination)
    return output


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("apk", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    output = args.output.resolve()
    marker = output / "assets" / "bin" / "Data" / "sharedassets0.assets"
    if not marker.exists():
        output.mkdir(parents=True, exist_ok=True)
        with zipfile.ZipFile(args.apk.resolve()) as archive:
            archive.extractall(output)
        data_dir = output / "assets" / "bin" / "Data"
        join_splits(data_dir, "level0")
        join_splits(data_dir, "sharedassets0.assets")
    print(marker.parent)


if __name__ == "__main__":
    main()
