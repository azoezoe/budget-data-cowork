# Budget Data Cowork

Static review pages for budget proposal gazette image matching.

## Gazette Review

Open `index.html` locally or publish this repository with GitHub Pages.

Reviewers edit rows in the browser and download `review-output.jsonl`.
Send that file back for import. CSV download is only a backup for manual checks.

Each JSONL line is one reviewed row:

```json
{"dataset":"20260518_1154104_00003_matched","row_id":"1","proposal_ID":"12345","pdf":["https://example/image.jpg"],"status":"ok","note":""}
```

Use `status` this way:

- `ok`: proposal_ID and image are correct.
- `change_proposal`: proposal_ID was edited.
- `change_image`: image URL was edited.
- `skip`: this row should not be imported.
- `unmatched_review`: image is still waiting for manual matching.

The browser keeps draft edits in local storage until the reviewer exports or clears them.
