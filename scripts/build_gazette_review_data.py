#!/usr/bin/env python3
"""Build static JSON for the gazette review page."""

from __future__ import annotations

import argparse
import json
import re
from html.parser import HTMLParser
from pathlib import Path


WORKSPACE_ROOT = Path(__file__).resolve().parents[2]


class GazetteTextExtractor(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.parts: list[str] = []
        self.skip_depth = 0

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag in {"script", "style"}:
            self.skip_depth += 1
        if tag in {"p", "div", "br", "tr", "li", "h1", "h2", "h3"}:
            self.parts.append("\n")

    def handle_endtag(self, tag: str) -> None:
        if tag in {"script", "style"} and self.skip_depth:
            self.skip_depth -= 1
        if tag in {"p", "div", "tr", "li", "h1", "h2", "h3"}:
            self.parts.append("\n")

    def handle_data(self, data: str) -> None:
        if self.skip_depth:
            return
        text = re.sub(r"\s+", " ", data).strip()
        if text:
            self.parts.append(text)

    def text(self) -> str:
        text = "".join(self.parts)
        text = re.sub(r"[ \t]*\n[ \t]*", "\n", text)
        text = re.sub(r"\n{3,}", "\n\n", text)
        text = re.sub(r"(?<!\n)(主席|[^：\n]{1,12}(?:委員|處長|部長|署長|主委|主任委員|局長|司長|次長|秘書長|執行長)[^：\n]{0,8})：", r"\n\1：", text)
        return text.strip()


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


def agenda_html_path(dataset: dict) -> Path | None:
    source = str(dataset.get("source", ""))
    source_path = WORKSPACE_ROOT / source
    if not source_path.exists():
        return None
    folder = source_path.parent
    candidates = sorted(folder.glob("agenda_*.html"))
    return candidates[0] if candidates else None


def gazette_text(dataset: dict) -> str:
    path = agenda_html_path(dataset)
    if not path or not path.exists():
        return ""
    parser = GazetteTextExtractor()
    parser.feed(path.read_text(encoding="utf-8", errors="replace"))
    return parser.text()


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
    text_by_source: dict[str, str] = {}
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
        source = dataset["source"]
        text_by_source.setdefault(source, gazette_text(dataset))
        datasets.append(
            {
                "name": dataset_name,
                "source": source,
                "row_count": dataset["row_count"],
                "source_sheet_row": source_row,
                "date": metadata.get("來源表_會議日期", ""),
                "committee": metadata.get("來源表_委員會名稱", ""),
                "ppg_url": metadata.get("ppg_url", "") or metadata.get("會議記錄連結", ""),
                "html_file": split_urls(metadata.get("公報HTML", "")),
                "gazette_text": text_by_source[source],
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
