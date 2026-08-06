# Budget Data Cowork

Static review pages for budget proposal gazette image matching.

## Meeting Minutes Review

Open `minutes/index.html` through a local web server, then choose a meeting.
The workbench keeps the proposal queue, freely scrollable original minutes, the
current extracted proposal, and structured fields visible together. Reviewers
mark each row as correct, needs amendment, or delete. Missing proposals can be
created from selected source text or as a blank row. Drafts stay in browser local
storage; reviewers return the CSV or JSONL download after checking the meeting.
Export filenames include the Meeting Sheet row, date, committee, and meeting
code, for example `minutes-review-33_20260610_交通委員會_11-5-23-18.jsonl`.

The original-source view prefers Dataly's meeting-minutes HTML at
`meet-proceeding-html/{meeting_code}.html`. The build step saves a same-origin
review copy so the current proposal can be found, highlighted, and scrolled into
view. The remote HTML link, source DOC, and `ppg_url` remain available in the
toolbar. When Dataly has no usable minutes HTML, the builder can create a text
view from the downloaded DOCX instead.

The interface follows the `使用說明` checklist: reviewer name, source comparison,
serial and department boundaries, `action`, `cost`, `deleted`, `frozen`, budget
year, `full_name`, and `result`. It also supports amendment notes, row splitting,
deletion, new rows, follow-up flags, organization suggestions, and the one-time
budget-year fix. Exports preserve `review_decision` (`correct`, `amend`, `delete`,
or `add`) and `correction_note` so reviewed changes can be imported directly.

`full_name` behaves as a reviewed section value. After a reviewer edits it and
saves the row, that value is copied forward until the next row where a reviewer
edits and saves a different `full_name`. Revisiting an earlier section only
updates rows up to the next saved edit point.

Rebuild every unique meeting from the latest local processing outputs with:

```sh
python3 scripts/build_minutes_pages.py
```

The batch builder reads the latest Meeting Sheet through its Apps Script CSV
exporter. It skips rows whose `議事錄轉檔紀錄` is `y`, zero-row datasets, and
later Meeting Sheet rows that reuse the same `meeting_code`. It writes the
claim-list source to `data/minutes-manifest.json`.

## Gazette Review

Open `index.html` locally or publish this repository with GitHub Pages.

Reviewers open one meeting page, edit rows in the browser, and download `review-output.jsonl`.
Send that file back for import. CSV download is only a backup for manual checks.

Each JSONL line is one reviewed row:

```json
{"dataset":"20260518_1154104_00003_matched","row_id":"1","proposal_ID":"12345","pdf":["https://example/image.jpg"],"status":"ok","done":true,"note":""}
```

Use `status` this way:

- `ok`: proposal_ID and image are correct.
- `change_proposal`: proposal_ID was edited.
- `change_image`: image URL was edited.
- `skip`: this row should not be imported.
- `unmatched_review`: image is still waiting for manual matching.

Use the checkbox when a row is confirmed. If proposal_ID or image URL is edited,
the page marks the row status automatically.

The page starts with matched proposals that already have images. Confirm each
correct image, or click `圖片錯誤，進配對池` when the image is wrong. Rows without
images do not appear in this first pass.

After all matched images are reviewed, the pairing pool appears automatically.
It shows text waiting for images next to images waiting for text from the same
meeting. Select one text row and one image, then apply the pair.

The browser keeps draft edits in local storage until the reviewer exports or clears them.
