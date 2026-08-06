#!/usr/bin/env python3
"""Add full gazette text to an existing gazette review JSON file."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from build_gazette_review_data import gazette_text


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()

    payload = json.loads(args.input.read_text(encoding="utf-8"))
    text_by_source: dict[str, str] = {}
    for dataset in payload.get("datasets", []):
        source = str(dataset.get("source", ""))
        text_by_source.setdefault(source, gazette_text(dataset))
        dataset["gazette_text"] = text_by_source[source]

    args.output.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"datasets: {len(payload.get('datasets', []))}")
    print(f"rows: {len(payload.get('rows', []))}")
    print(f"wrote: {args.output}")


if __name__ == "__main__":
    main()
