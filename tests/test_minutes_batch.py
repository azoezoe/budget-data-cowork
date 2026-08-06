import json
import re
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


class MinutesBatchTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.manifest = json.loads((ROOT / "data" / "minutes-manifest.json").read_text(encoding="utf-8"))

    def test_manifest_contains_unique_nonempty_meetings(self):
        meetings = self.manifest["meetings"]
        self.assertEqual(22, len(meetings))
        self.assertEqual(len(meetings), len({item["meeting_code"] for item in meetings}))
        self.assertTrue(all(item["proposal_count"] > 0 for item in meetings))

    def test_every_page_points_to_its_own_data_and_source(self):
        for meeting in self.manifest["meetings"]:
            with self.subTest(row=meeting["source_sheet_row"]):
                page = ROOT / meeting["page"]
                data = ROOT / "data" / f"minutes-review-{meeting['source_sheet_row']}.json"
                source = ROOT / "sources" / f"{page.stem}.html"
                self.assertTrue(page.exists())
                self.assertTrue(data.exists())
                self.assertTrue(source.exists())
                self.assertIn(data.name, page.read_text(encoding="utf-8"))
                payload = json.loads(data.read_text(encoding="utf-8"))
                self.assertEqual(meeting["proposal_count"], len(payload["rows"]))
                self.assertEqual(meeting["meeting_code"], payload["dataset"]["meeting_code"])
                self.assertEqual(f"../sources/{source.name}", payload["dataset"]["source_html"])

    def test_index_has_one_link_per_meeting(self):
        index = (ROOT / "minutes" / "index.html").read_text(encoding="utf-8")
        links = re.findall(r'href="([^"]+\.html)"', index)
        self.assertEqual(len(self.manifest["meetings"]), len(links))
        self.assertEqual(len(links), len(set(links)))

    def test_expected_skips_are_recorded(self):
        reasons = {item["directory"]: item["reason"] for item in self.manifest["skipped"]}
        self.assertEqual("Meeting 議事錄轉檔紀錄 is y", reasons["4_20260506_finance_委員會-11-5-20-12"])
        self.assertEqual("Meeting 議事錄轉檔紀錄 is y", reasons["19_20260527_economics_委員會-11-5-19-15"])
        self.assertEqual("duplicate of row 25", reasons["28_20260604_judiciary_委員會-11-5-36-16"])
        self.assertEqual("zero proposals", reasons["41_20260617_finance_委員會-11-5-20-19"])

    def test_export_filename_contains_meeting_identity(self):
        script = (ROOT / "assets" / "minutes.js").read_text(encoding="utf-8")
        for field in ("source_sheet_row", "date", "committee", "meeting_code"):
            self.assertIn(f"dataset.{field}", script)


if __name__ == "__main__":
    unittest.main()
