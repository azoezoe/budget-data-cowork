#!/usr/bin/env python3
"""Build static JSON for the gazette review page."""

from __future__ import annotations

import argparse
import json
import re
from pathlib import Path


def split_urls(value: str) -> list[str]:
    return [
        part
        for part in re.split(r"[\s,]+", value or "")
        if part.startswith(("http://", "https://"))
    ]


def first_present(row: dict[str, str], names: list[str]) -> str:
    for name in names:
        value = row.get(name, "")
        if value:
            return value
    return ""


def is_unmatched_dataset(dataset: dict) -> bool:
    source = dataset.get("source", "")
    name = dataset.get("name", "")
    return source.endswith("_unmatched_images.csv") or name.endswith("_unmatch")


def dataset_image_count(dataset: dict) -> int:
    headers = dataset.get("headers", [])
    count = 0
    for values in dataset.get("rows", []):
        row = dict(zip(headers, values, strict=False))
        image_urls = first_present(row, ["pdf", "image_url", "圖片網址", "url"])
        if split_urls(image_urls):
            count += 1
    return count


def dataset_meeting_key(dataset: dict) -> tuple[str, str, str]:
    metadata = dataset.get("metadata") or {}
    return (
        str(metadata.get("來源表_來源列號", "")),
        str(metadata.get("來源表_會議日期", "")),
        str(metadata.get("來源表_委員會名稱", "")),
    )


def site_dataset_name(dataset: dict) -> str:
    source = dataset.get("source", "")
    match = re.search(r"original_agenda_newflow/(\d{8})_[^/]+_(\d{7,8}_\d{5})/(check_pdf_review_newflow(?:_unmatched_images)?).csv", source)
    if not match:
        return dataset["name"]
    date, agenda_id, kind = match.groups()
    suffix = "unmatch" if kind.endswith("_unmatched_images") else "matched"
    return f"{date}_{agenda_id}_{suffix}"


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--review-json", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--exclude-source-rows", default="")
    args = parser.parse_args()

    excluded = {part.strip() for part in args.exclude_source_rows.split(",") if part.strip()}
    payload = json.loads(args.review_json.read_text(encoding="utf-8"))

    gazette_datasets = payload["workbooks"]["gazette"]["datasets"]
    matched_image_counts_by_meeting: dict[tuple[str, str, str], int] = {}
    for dataset in gazette_datasets:
        if is_unmatched_dataset(dataset):
            continue
        matched_image_counts_by_meeting[dataset_meeting_key(dataset)] = max(
            matched_image_counts_by_meeting.get(dataset_meeting_key(dataset), 0),
            dataset_image_count(dataset),
        )

    datasets = []
    rows = []
    for dataset in gazette_datasets:
        metadata = dataset.get("metadata") or {}
        source_row = str(metadata.get("來源表_來源列號", ""))
        if source_row in excluded:
            continue
        if (
            not is_unmatched_dataset(dataset)
            and dataset.get("row_count", 0)
            and dataset_image_count(dataset) == 0
            and matched_image_counts_by_meeting.get(dataset_meeting_key(dataset), 0) > 0
        ):
            continue
        dataset_name = site_dataset_name(dataset)
        datasets.append(
            {
                "name": dataset_name,
                "source": dataset["source"],
                "row_count": dataset["row_count"],
                "source_sheet_row": source_row,
                "date": metadata.get("來源表_會議日期", ""),
                "committee": metadata.get("來源表_委員會名稱", ""),
                "ppg_url": metadata.get("ppg_url", "") or metadata.get("會議記錄連結", ""),
                "html_file": split_urls(metadata.get("公報HTML", "")),
                "fingerprint": dataset.get("fingerprint", ""),
            }
        )
        headers = dataset.get("headers", [])
        for index, values in enumerate(dataset.get("rows", []), start=1):
            row = dict(zip(headers, values, strict=False))
            image_urls = first_present(row, ["pdf", "image_url", "圖片網址", "url"])
            content = first_present(row, ["內容", "content", "context_before", "ocr_text"])
            rows.append(
                {
                    "dataset": dataset_name,
                    "row_id": str(index),
                    "proposal_ID": row.get("proposal_ID", ""),
                    "content": content,
                    "pdf": split_urls(image_urls),
                    "status": "unmatched_review" if dataset_name.endswith("_unmatch") else "unchecked",
                    "note": "",
                }
            )

    output = {
        "schema": "gazette-review.v1",
        "datasets": datasets,
        "rows": rows,
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(output, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"datasets: {len(datasets)}")
    print(f"rows: {len(rows)}")
    print(f"wrote: {args.output}")


if __name__ == "__main__":
    main()
