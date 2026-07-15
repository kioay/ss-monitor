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

        snapshot = {"status": "ok", "assets": [{"title": "封面素材"}], "totalMatched": 1, "stats": {}}
        public_assets = [{"title": "封面素材", "thumbnailUrl": "https://example.com/cover.jpg"}]
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


if __name__ == "__main__":
    unittest.main()
