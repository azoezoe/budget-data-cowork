#!/usr/bin/env python3
"""Build static data for the meeting-minutes review workbench."""

from __future__ import annotations

import argparse
import csv
import hashlib
import html
import json
import re
from pathlib import Path
from urllib.request import Request, urlopen

from lxml import etree
from lxml import html as lxml_html


CHECKLIST = [
    "填寫校對人姓名",
    "自由捲動原始議事錄，直接修改錯誤欄位，再逐筆判斷無誤、有修正或刪除",
    "發現遺漏時選取原文建立新提案，或新增空白提案後補齊欄位",
    "確認 full_name，排除歲入與增列，補齊漏掉的減列提案",
    "沿案號順序抽查，遇到跳號時回看前一筆",
    "用議事錄所載總數確認部會邊界",
    "抽查 action、cost、deleted、frozen，先處理 extract_notes",
    "預算年度統一為 115，full_name 與 result 不可空白",
    "完成後標記做完；資料來源錯誤則標成資料錯誤",
]


def read_csv(path: Path) -> list[dict[str, str]]:
    with path.open(encoding="utf-8-sig", newline="") as file:
        return list(csv.DictReader(file))


def suggest_full_name(content: str, current: str) -> str:
    candidates = (
        ("高速公路局", "高速公路局"),
        ("公路局", "公路局"),
        ("觀光署", "觀光署"),
        ("運輸研究所", "運輸研究所"),
        ("交通部", "交通部"),
    )
    if current and current != "立法院":
        return current
    for needle, value in candidates:
        if needle in content:
            return value
    return ""


def build_source_html(docx_path: Path, output: Path, title: str) -> None:
    from docx import Document

    document = Document(docx_path)
    paragraphs = []
    for number, paragraph in enumerate(document.paragraphs, start=1):
        text = re.sub(r"\s+", " ", paragraph.text or "").strip()
        if not text:
            continue
        paragraphs.append(
            f'<p id="p-{number}" data-paragraph="{number}"><span class="paragraph-number">{number}</span>{html.escape(text)}</p>'
        )
    page = f"""<!doctype html>
<html lang="zh-Hant">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>{html.escape(title)}原始議事錄</title>
  <style>
    :root {{ font-family: "Noto Serif TC", "Songti TC", serif; color: #20282d; background: #f3f5f6; }}
    body {{ max-width: 880px; margin: 0 auto; padding: 28px 34px 80px; background: #fff; }}
    h1 {{ margin: 0 0 24px; font-family: "Noto Sans TC", sans-serif; font-size: 20px; }}
    p {{ position: relative; margin: 0; padding: 8px 12px 8px 54px; border-left: 3px solid transparent; font-size: 17px; line-height: 1.9; scroll-margin-block: 42vh; }}
    p + p {{ border-top: 1px solid #edf0f2; }}
    .paragraph-number {{ position: absolute; left: 10px; top: 13px; color: #88949b; font-family: Arial, sans-serif; font-size: 10px; }}
    p.active-proposal {{ border-left-color: #18836f; background: #fff8d9; }}
    @media (max-width: 640px) {{ body {{ padding: 18px 14px 60px; }} p {{ padding-left: 42px; font-size: 16px; }} }}
  </style>
</head>
<body>
  <h1>{html.escape(title)}原始議事錄</h1>
  {''.join(paragraphs)}
</body>
</html>"""
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(page, encoding="utf-8")
    print(f"source paragraphs: {len(paragraphs)}")
    print(f"wrote: {output}")


def build_remote_source_html(source_url: str, output: Path, title: str = "") -> None:
    request = Request(source_url, headers={"User-Agent": "Mozilla/5.0 budget-cowork/1.0"})
    with urlopen(request, timeout=60) as response:
        source = response.read().decode("utf-8")
    document = lxml_html.fromstring(source)
    head = document.find("head")
    if head is None:
        head = etree.Element("head")
        document.insert(0, head)
    charset = etree.Element("meta", charset="utf-8")
    head.insert(0, charset)
    title_element = head.find("title")
    if title_element is None:
        title_element = etree.Element("title")
        head.append(title_element)
    if title:
        title_element.text = f"{title}原始議事錄"
    style = etree.Element("style")
    style.text = """
      :root { font-family: "Noto Serif TC", "Songti TC", serif; color: #20282d; background: #f3f5f6; }
      body { max-width: 920px; margin: 0 auto; padding: 28px 36px 80px; background: #fff; font-size: 17px; line-height: 1.85; }
      p { scroll-margin-block: 42vh; }
      table { max-width: 100%; border-collapse: collapse; }
      td, th { padding: 4px 8px; vertical-align: top; }
      .active-proposal { outline: 3px solid #18836f; outline-offset: 5px; background: #fff8d9 !important; }
      @media (max-width: 640px) { body { padding: 18px 16px 60px; font-size: 16px; } }
    """
    head.append(style)
    blocks = document.xpath("//body//p")
    for number, element in enumerate(blocks, start=1):
        element.set("id", f"source-p-{number}")
        element.set("data-source-block", str(number))
    output.parent.mkdir(parents=True, exist_ok=True)
    rendered = lxml_html.tostring(document, encoding="unicode", method="html", doctype="<!doctype html>")
    output.write_text("\n".join(line.rstrip() for line in rendered.splitlines()), encoding="utf-8")
    print(f"source html blocks: {len(blocks)}")
    print(f"wrote: {output}")


def proceeding_doc_url(source_html_url: str, fallback: str) -> str:
    if "/meet-proceeding-html/" not in source_html_url or not source_html_url.endswith(".html"):
        return fallback
    return source_html_url.replace("/meet-proceeding-html/", "/meet-proceeding-doc/")[:-5] + ".doc"


def build_review_payload(
    proposal_csv: Path,
    extracted_csv: Path,
    metadata_path: Path,
    source_html_remote: str = "",
    source_html_url: str = "",
) -> dict:
    proposal_rows = read_csv(proposal_csv)
    extracted_rows = read_csv(extracted_csv)
    extracted_by_source = {row.get("source_row", ""): row for row in extracted_rows}
    metadata = json.loads(metadata_path.read_text(encoding="utf-8"))

    rows = []
    for index, proposal in enumerate(proposal_rows, start=1):
        source_row = proposal.get("source_row", "")
        extracted = extracted_by_source.get(source_row, {})
        content = proposal.get("內容", "")
        rows.append(
            {
                "row_id": str(index),
                "source_row": source_row,
                "start_paragraph": extracted.get("start_paragraph", ""),
                "end_paragraph": extracted.get("end_paragraph", ""),
                "section_context": extracted.get("section_context", ""),
                "suggested_full_name": suggest_full_name(content, proposal.get("full_name", "")),
                "fields": proposal,
            }
        )

    fingerprint_input = proposal_csv.read_bytes() + metadata_path.read_bytes()
    return {
        "schema": "minutes-review.v1",
        "fingerprint": hashlib.sha256(fingerprint_input).hexdigest()[:16],
        "dataset": {
            "name": proposal_csv.parent.name,
            "source": str(proposal_csv),
            "row_count": len(rows),
            "source_sheet_row": metadata.get("來源列號", ""),
            "date": metadata.get("會議日期", ""),
            "committee": metadata.get("委員會名稱", ""),
            "meeting_title": metadata.get("meeting_title", ""),
            "meeting_code": metadata.get("meeting_code", ""),
            "ppg_url": metadata.get("ppg_url", "") or metadata.get("會議記錄連結", ""),
            "doc_file": proceeding_doc_url(source_html_remote, metadata.get("doc_file", "")),
            "minutes_html_file": source_html_remote or metadata.get("minutes_html_file", ""),
            "source_html": source_html_url,
        },
        "checklist": CHECKLIST,
        "headers": list(proposal_rows[0].keys()) if proposal_rows else [],
        "rows": rows,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--proposal-csv", type=Path, required=True)
    parser.add_argument("--extracted-csv", type=Path, required=True)
    parser.add_argument("--metadata", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--source-docx", type=Path)
    parser.add_argument("--source-html-remote", default="")
    parser.add_argument("--source-html-output", type=Path)
    parser.add_argument("--source-html-url", default="")
    args = parser.parse_args()

    metadata = json.loads(args.metadata.read_text(encoding="utf-8"))
    if args.source_html_remote and args.source_html_output:
        build_remote_source_html(args.source_html_remote, args.source_html_output, metadata.get("meeting_title", ""))
    elif args.source_docx and args.source_html_output:
        build_source_html(args.source_docx, args.source_html_output, metadata.get("meeting_title", ""))

    payload = build_review_payload(
        args.proposal_csv,
        args.extracted_csv,
        args.metadata,
        args.source_html_remote,
        args.source_html_url,
    )
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"rows: {len(payload['rows'])}")
    print(f"wrote: {args.output}")


if __name__ == "__main__":
    main()
