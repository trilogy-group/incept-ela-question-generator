"""Run boundary, source pin, immutable output and refusal regression checks."""

import copy
import hashlib
import json
from pathlib import Path
import shutil
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
import run  # noqa: E402
from generator import InputError  # noqa: E402


class RunnerTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        for name in ("config.json", "generator.py", "contract_adapter.py", "transport.py", "reference_intake.py"):
            shutil.copy2(ROOT / name, self.root / name)
        for name in ("public", "schema", "examples"):
            shutil.copytree(ROOT / name, self.root / name)
        self.change_root = patch.object(run, "ROOT", self.root)
        self.change_root.start()
        self.addCleanup(self.change_root.stop)
        self.addCleanup(self.temporary.cleanup)

    def config(self, key, value):
        data = json.loads((self.root / "config.json").read_text())
        data[key] = value
        (self.root / "config.json").write_text(json.dumps(data))

    def test_one_offline_run_produces_fourteen_items_and_private_outputs(self):
        directory, metadata = run.execute(check_tests=False)
        self.assertEqual("prepared-for-review", metadata["state"])
        self.assertEqual(14, sum(row["contract_items_checked"] for row in metadata["lessons"]))
        self.assertEqual(0, metadata["model_calls"])
        self.assertEqual(0o700, directory.stat().st_mode & 0o777)
        for path in directory.rglob("*"):
            if path.is_file():
                self.assertEqual(0o600, path.stat().st_mode & 0o777)

    def test_repeated_runs_preserve_first_trace_and_make_distinct_directories(self):
        first, _ = run.execute(check_tests=False)
        prior = (first / "run.json").read_bytes()
        second, _ = run.execute(check_tests=False)
        self.assertNotEqual(first, second)
        self.assertEqual(prior, (first / "run.json").read_bytes())
        current = json.loads((self.root / ".local" / "current.json").read_text())
        self.assertEqual(second.name, current["run"])

    def test_changed_public_method_bytes_refuse_before_creating_a_run(self):
        path = self.root / "public" / "generation-standard.json"
        path.write_text(path.read_text() + "\n")
        with self.assertRaisesRegex(InputError, "snapshot"):
            run.execute(check_tests=False)
        self.assertFalse((self.root / ".local").exists())

    def test_unknown_or_network_execution_config_is_rejected(self):
        self.config("execution", "model")
        with self.assertRaisesRegex(InputError, "offline"):
            run.execute(check_tests=False)

    def test_output_path_cannot_escape_or_follow_a_symlink(self):
        self.config("run_root", "../outside")
        with self.assertRaises(InputError):
            run.execute(check_tests=False)
        self.config("run_root", ".local/runs")
        (self.root / ".local").symlink_to(self.root.parent, target_is_directory=True)
        with self.assertRaisesRegex(InputError, "symlink"):
            run.execute(check_tests=False)

    def test_cli_input_cannot_read_a_sibling_repository_or_symlink(self):
        with self.assertRaises(InputError):
            run.execute("../another-repository/packet.json", check_tests=False)
        (self.root / "external.json").symlink_to(self.root / "examples" / "lessons.json")
        with self.assertRaisesRegex(InputError, "symlink"):
            run.execute("external.json", check_tests=False)

    def test_unsupported_domain_emits_empty_learner_packet_and_typed_hold(self):
        path = self.root / "examples" / "lessons.json"
        lesson = json.loads(path.read_text())["lessons"][0]
        lesson["content_notes"]["domain"] = "unsupported"
        path.write_text(json.dumps(lesson))
        directory, metadata = run.execute(check_tests=False)
        self.assertEqual("held", metadata["state"])
        destination = directory / lesson["id"]
        self.assertEqual([], json.loads((destination / "learner.json").read_text())["items"])
        self.assertFalse((destination / "question-set.json").exists())
        self.assertEqual([], json.loads((destination / "teacher.json").read_text())["items"])

    def test_reference_preparation_emits_five_pending_slots_and_no_questions(self):
        directory, metadata = run.execute(check_tests=False, preparation=True)
        self.assertEqual("writer-request-prepared", metadata["state"])
        self.assertEqual(5, metadata["planned_items"])
        self.assertEqual(0, metadata["model_calls"])
        self.assertEqual("pending", metadata["writing"])
        destination = directory / "reference-preparation"
        for name in ("writer-request.json", "lesson-context.json", "facts.json", "provenance.json", "trace.json"):
            self.assertTrue((destination / name).is_file())
            self.assertEqual(0o600, (destination / name).stat().st_mode & 0o777)
        self.assertFalse(list(directory.rglob("question-set.json")))
        self.assertFalse(list(directory.rglob("learner.json")))
        trace = json.loads((destination / "trace.json").read_text())
        self.assertEqual([], trace["first_attempt"])
        self.assertEqual(hashlib.sha256((destination / "writer-request.json").read_bytes()).hexdigest(), trace["writer_request_sha256"])
        self.assertEqual("365c0a5a2a3f460aa6fb8d8f87cf8ed9949b8863ef5df44200ec6477e8d1f8e9", trace["source"]["knowledge_baseline_sha256"])
        self.assertEqual("3ed708e126aec14b7456679b9236e01c1081df16", trace["source"]["reference_source"]["commit"])

    def test_reference_preparation_cannot_override_pinned_context_or_mutated_baseline(self):
        with self.assertRaisesRegex(InputError, "pinned public context"):
            run.execute("examples/lessons.json", check_tests=False, preparation=True)
        baseline = self.root / "public" / "knowledge-baseline.json"
        baseline.write_text(baseline.read_text() + "\n")
        with self.assertRaisesRegex(InputError, "snapshot"):
            run.execute(check_tests=False, preparation=True)
        self.assertFalse((self.root / ".local").exists())

    def test_template_run_trace_also_preserves_the_baseline_hash(self):
        directory, metadata = run.execute(check_tests=False)
        trace = json.loads((directory / "character-credit" / "trace.json").read_text())
        self.assertEqual(metadata["knowledge_baseline_sha256"], trace["knowledge_baseline_sha256"])

if __name__ == "__main__":
    unittest.main()
