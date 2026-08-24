from __future__ import annotations

import importlib.util
import sys
import tempfile
import types
import unittest
from pathlib import Path
from unittest import mock


def load_worker_module():
    sdk = types.ModuleType("wdcloud_worker_sdk")
    sdk.WorkerClient = object
    sdk.prepare_codex_home = lambda: None
    sdk.redact_secrets = lambda value: value
    sdk.run_codex_streaming = lambda *args, **kwargs: {}
    sdk.sanitize_text = lambda value: value
    sys.modules["wdcloud_worker_sdk"] = sdk

    worker_path = Path(__file__).with_name("worker.py")
    spec = importlib.util.spec_from_file_location("design_inspiration_worker", worker_path)
    module = importlib.util.module_from_spec(spec)
    assert spec and spec.loader
    spec.loader.exec_module(module)
    return module


class FakeWorker:
    def status(self, *args, **kwargs):
        return None

    def log(self, *args, **kwargs):
        return None


class DelegatedThumbnailArtifactTest(unittest.TestCase):
    def test_delegated_turn_uploads_thumbnail_artifacts_without_image_markdown(self):
        module = load_worker_module()
        captured_result = {}

        def stage_thumbnail_artifacts(assets, turn_input, output_dir, log):
            assets[0]["thumbnailArtifactId"] = "assetThumb-001"
            assets[0]["thumbnailArtifactName"] = "assetThumb-001.jpg"
            assets[0]["thumbnailContentType"] = "image/jpeg"
            return [("assetThumb-001", output_dir / "assetThumb-001.jpg")]

        def upload_turn_artifacts(worker, artifacts):
            return [
                {"artifactId": artifact_id, "objectKey": f"tasks/test/{path.name}"}
                for artifact_id, path in artifacts
            ]

        def write_result_optional(worker, *, artifact_files, structured_result, summary):
            captured_result.update(structured_result)
            captured_result["artifactFiles"] = artifact_files

        snapshot = {"status": "ok", "assets": [{"title": "无畏契约武器皮肤展示"}], "totalMatched": 1, "stats": {}}
        public_assets = [{"title": "无畏契约武器皮肤展示", "thumbnailUrl": "https://example.com/cover.jpg"}]
        delegated_input = {
            "mode": "inspiration.collect",
            "channelReplyAuthority": False,
            "inspirationBaseUrl": "http://192.168.8.242:8788",
        }

        with tempfile.TemporaryDirectory() as temp_dir, mock.patch.dict(
            module.os.environ, {"WDCLAW_WORK_DIR": temp_dir}
        ), mock.patch.object(module, "collect_inspiration_snapshot", return_value=snapshot), mock.patch.object(
            module, "read_agent_skill", return_value="test skill"
        ), mock.patch.object(
            module, "run_codex_streaming", return_value={"finalMessage": "正文", "finalMessageSource": "test"}
        ), mock.patch.object(
            module, "public_assets_for_result", return_value=public_assets
        ), mock.patch.object(
            module, "stage_thumbnail_artifacts", side_effect=stage_thumbnail_artifacts
        ) as stage_mock, mock.patch.object(
            module, "upload_turn_artifacts", side_effect=upload_turn_artifacts
        ), mock.patch.object(
            module, "write_result_optional", side_effect=write_result_optional
        ):
            module.run_collect_turn(FakeWorker(), Path(temp_dir), "inspiration.collect", delegated_input)

        stage_mock.assert_called_once()
        self.assertEqual(captured_result["assets"][0]["thumbnailArtifactId"], "assetThumb-001")
        self.assertIn("assetThumb-001", [item["artifactId"] for item in captured_result["artifactFiles"]])
        self.assertNotIn("![", captured_result["finalMessage"])

    def test_compact_assets_rejects_market_and_commentary_thumbnails(self):
        module = load_worker_module()

        def raw_asset(asset_id, title, summary, keywords, author=""):
            return {
                "id": asset_id,
                "kind": "video",
                "category": "general_reference",
                "item": {
                    "id": asset_id,
                    "source": "bilibili",
                    "title": title,
                    "summary": summary,
                    "author": author,
                    "keywords": keywords,
                    "thumbnail": f"https://example.com/{asset_id}.jpg",
                    "url": f"https://example.com/{asset_id}",
                },
            }

        assets = module.compact_assets_for_result(
            [
                raw_asset("market", "CS2市场行情：手套价格极限涨幅", "价格走势和饰品交易分析", ["CS2", "手套", "皮肤"]),
                raw_asset(
                    "commentary",
                    "白鲨说EWC皮肤想选幻神，不知道领导是否同意，领导在直播间直接回应",
                    "职业选手直播间回应，主播聊天讨论幻神和USP小刀。",
                    ["CF", "皮肤", "幻神", "USP小刀"],
                ),
                raw_asset("peripheral", "利维坦新联名键盘", "游戏联名套装体验", ["VALORANT", "联名"]),
                raw_asset("showcase", "CS2手套外观展示", "手套材质和配色预览", ["CS2", "手套"]),
            ],
            60,
            ["CS2", "CF"],
        )
        self.assertEqual([asset["id"] for asset in assets], ["showcase"])

    def test_filtering_happens_before_limit(self):
        module = load_worker_module()
        valid_asset = {
            "id": "valid",
            "kind": "video",
            "item": {
                "title": "CS2手套外观展示",
                "summary": "手套材质预览",
                "thumbnail": "https://example.com/valid.jpg",
                "url": "https://example.com/valid",
            },
        }
        invalid_asset = {
            "id": "invalid",
            "kind": "video",
            "item": {
                "title": "CS2市场行情",
                "summary": "手套价格走势",
                "thumbnail": "https://example.com/invalid.jpg",
                "url": "https://example.com/invalid",
            },
        }
        assets = module.compact_assets_for_result([invalid_asset, valid_asset], 1, ["CS2"])
        self.assertEqual([asset["id"] for asset in assets], ["valid"])


if __name__ == "__main__":
    unittest.main()
