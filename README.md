# Budget Data Cowork

Static review pages for budget proposal gazette image matching.

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
