#!/usr/bin/env python3
"""Build every unique meeting-minutes review page and its source mirror."""

from __future__ import annotations

import argparse
import html
import json
import re
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from urllib.parse import quote

from build_minutes_review_data import (
    build_remote_source_html,
    build_review_payload,
    build_source_html,
    read_csv,
)


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_PROCESSING_ROOT = ROOT.parent / "115" / "processing" / "meeting_minutes_newflow"
PROTOTYPE = ROOT / "minutes" / "20260610_traffic_11-5-23-18.html"
PAGES_BASE_URL = "https://azoezoe.github.io/budget-data-cowork"


def source_url(meeting_code: str) -> str:
    return f"https://lydata.ronny-s3.click/meet-proceeding-html/{quote(meeting_code)}.html"


def slug_for(directory: Path, meeting_code: str) -> str:
    without_row = directory.name.split("_", 1)[1]
    return re.sub(r"_委員會-", "_", without_row) if meeting_code else without_row


def page_html(prototype: str, title: str, committee: str, row_number: str) -> str:
    page = re.sub(r"<title>.*?</title>", f"<title>{html.escape(committee)}議事錄校對</title>", prototype, count=1)
    page = re.sub(
        r'(<h1 id="meetingTitle">).*?(</h1>)',
        rf"\1{html.escape(title or committee)}\2",
        page,
        count=1,
    )
    page = re.sub(
        r'window\.MINUTES_REVIEW_DATA = "\.\./data/minutes-review-[^"]+\.json";',
        f'window.MINUTES_REVIEW_DATA = "../data/minutes-review-{row_number}.json";',
        page,
        count=1,
    )
    return page


def index_html(meetings: list[dict]) -> str:
    rows = []
    for item in meetings:
        rows.append(
            "<tr>"
            f"<td>{html.escape(item['date'])}</td>"
            f"<td>{html.escape(item['committee'])}</td>"
            f"<td class=\"number\">{item['proposal_count']}</td>"
            f"<td><a href=\"{html.escape(item['relative_url'])}\">開始校對</a></td>"
            "</tr>"
        )
    return f"""<!doctype html>
<html lang="zh-Hant">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>預算議事錄校對</title>
  <style>
    :root {{ color: #20282d; background: #f4f6f7; font-family: "Noto Sans TC", sans-serif; }}
    body {{ margin: 0; }}
    header {{ background: #fff; border-bottom: 1px solid #dfe4e7; padding: 26px max(24px, calc((100vw - 1040px) / 2)); }}
    h1 {{ margin: 0 0 6px; font-size: 26px; }}
    p {{ margin: 0; color: #65717b; }}
    main {{ width: min(1040px, calc(100% - 32px)); margin: 24px auto 60px; background: #fff; border: 1px solid #dfe4e7; border-radius: 6px; overflow: hidden; }}
    table {{ width: 100%; border-collapse: collapse; }}
    th, td {{ padding: 13px 16px; border-bottom: 1px solid #e8ecee; text-align: left; }}
    th {{ background: #f7f9f9; color: #526069; font-size: 13px; }}
    tr:last-child td {{ border-bottom: 0; }}
    .number {{ text-align: right; font-variant-numeric: tabular-nums; }}
    a {{ color: #087866; font-weight: 700; text-decoration: none; }}
    a:hover {{ text-decoration: underline; }}
    @media (max-width: 640px) {{ th, td {{ padding: 11px 9px; }} th:nth-child(3), td:nth-child(3) {{ display: none; }} }}
  </style>
</head>
<body>
  <header><h1>預算議事錄校對</h1><p>{len(meetings)} 場會議，逐場對照原始議事錄並補回遺漏提案。</p></header>
  <main><table><thead><tr><th>日期</th><th>委員會</th><th class="number">提案數</th><th>校對頁</th></tr></thead><tbody>{''.join(rows)}</tbody></table></main>
</body>
</html>"""


def build_one(item: dict, prototype: str) -> dict:
    directory = item["directory"]
    metadata = item["metadata"]
    row_number = metadata["來源列號"]
    slug = item["slug"]
    remote_url = source_url(metadata["meeting_code"])
    source_output = ROOT / "sources" / f"{slug}.html"
    source_kind = "dataly_html"
    try:
        build_remote_source_html(remote_url, source_output, metadata.get("meeting_title", ""))
    except Exception as error:
        source_kind = f"docx_fallback: {type(error).__name__}"
        build_source_html(directory / "source.converted.docx", source_output, metadata.get("meeting_title", ""))

    payload = build_review_payload(
        directory / "Proposal_draft_filled.csv",
        directory / "docx_extracted_proposals.csv",
        directory / "metadata.json",
        remote_url,
        f"../sources/{slug}.html",
    )
    data_output = ROOT / "data" / f"minutes-review-{row_number}.json"
    data_output.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    page_output = ROOT / "minutes" / f"{slug}.html"
    page_output.write_text(
        page_html(prototype, metadata.get("meeting_title", ""), metadata.get("委員會名稱", ""), row_number),
        encoding="utf-8",
    )
    return {
        "source_sheet_row": row_number,
        "date": metadata.get("會議日期", ""),
        "committee": metadata.get("委員會名稱", ""),
        "meeting_title": metadata.get("meeting_title", ""),
        "meeting_code": metadata.get("meeting_code", ""),
        "proposal_count": len(payload["rows"]),
        "page": f"minutes/{slug}.html",
        "relative_url": f"{slug}.html",
        "review_url": f"{PAGES_BASE_URL}/minutes/{slug}.html",
        "ppg_url": payload["dataset"]["ppg_url"],
        "doc_file": payload["dataset"]["doc_file"],
        "minutes_html_file": remote_url,
        "source_kind": source_kind,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--processing-root", type=Path, default=DEFAULT_PROCESSING_ROOT)
    parser.add_argument("--workers", type=int, default=6)
    args = parser.parse_args()

    prototype = PROTOTYPE.read_text(encoding="utf-8")
    seen_codes: dict[str, str] = {}
    candidates = []
    skipped = []
    directories = sorted(
        (path for path in args.processing_root.iterdir() if path.is_dir() and path.name.split("_", 1)[0].isdigit()),
        key=lambda path: int(path.name.split("_", 1)[0]),
    )
    for directory in directories:
        if not directory.is_dir():
            continue
        required = ["metadata.json", "Proposal_draft_filled.csv", "docx_extracted_proposals.csv", "source.converted.docx"]
        missing = [name for name in required if not (directory / name).exists()]
        if missing:
            skipped.append({"directory": directory.name, "reason": f"missing: {', '.join(missing)}"})
            continue
        metadata = json.loads((directory / "metadata.json").read_text(encoding="utf-8"))
        meeting_code = metadata.get("meeting_code", "")
        proposal_count = len(read_csv(directory / "Proposal_draft_filled.csv"))
        if not proposal_count:
            skipped.append({"directory": directory.name, "reason": "zero proposals"})
            continue
        if meeting_code in seen_codes:
            skipped.append({"directory": directory.name, "reason": f"duplicate of row {seen_codes[meeting_code]}"})
            continue
        seen_codes[meeting_code] = metadata.get("來源列號", "")
        candidates.append({"directory": directory, "metadata": metadata, "slug": slug_for(directory, meeting_code)})

    meetings = []
    with ThreadPoolExecutor(max_workers=max(1, args.workers)) as executor:
        futures = [executor.submit(build_one, item, prototype) for item in candidates]
        for future in as_completed(futures):
            meeting = future.result()
            meetings.append(meeting)
            print(f"built row {meeting['source_sheet_row']}: {meeting['proposal_count']} proposals")

    meetings.sort(key=lambda item: int(item["source_sheet_row"]))
    manifest = {"schema": "minutes-review-manifest.v1", "meetings": meetings, "skipped": skipped}
    (ROOT / "data" / "minutes-manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    (ROOT / "minutes" / "index.html").write_text(index_html(meetings), encoding="utf-8")
    print(f"wrote {len(meetings)} meeting pages; skipped {len(skipped)}")


if __name__ == "__main__":
    main()
