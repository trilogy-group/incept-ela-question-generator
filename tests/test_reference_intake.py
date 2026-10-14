"""Preparation must preserve source scope while excluding authored answer material."""

import copy
import json
from pathlib import Path
import sys
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from generator import InputError  # noqa: E402
from reference_intake import PENDING, check_preparation, prepare_reference, resolve  # noqa: E402


class ReferenceIntakeTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.reference = json.loads((ROOT / "public" / "reference" / "lesson-context.json").read_text())
        cls.formats = json.loads((ROOT / "public" / "formats.json").read_text())
        cls.methods = json.loads((ROOT / "public" / "generation-standard.json").read_text())
        cls.provenance = {
            "knowledge_baseline_sha256": "365c0a5a2a3f460aa6fb8d8f87cf8ed9949b8863ef5df44200ec6477e8d1f8e9",
            "reference_context_sha256": "1f8c93a0671675ab7947493053ca18da4775102419bd6fa4aa193a868213065e",
            "reference_source": {key: cls.reference["source"][key] for key in ("commit", "path", "sha256")},
        }

    def prepare(self, reference=None):
        return prepare_reference(copy.deepcopy(reference or self.reference), self.formats, self.methods, self.provenance)

    def test_exact_anchors_retain_author_gloss_stage_direction_and_speaker_origins(self):
        writer, context, facts = self.prepare()
        self.assertEqual(5, check_preparation(writer, self.reference))
        self.assertEqual({"authored-exposition", "authored-stage-direction", "dramatic-dialogue"}, {fact["origin"] for fact in facts["facts"]})
        for fact in facts["facts"]:
            self.assertEqual(fact["text"], resolve(self.reference, fact["source_pointer"]))
            if fact["origin"] == "dramatic-dialogue":
                self.assertIn(fact["speaker"], {"IAGO", "RODERIGO"})
        self.assertEqual(PENDING, writer["progress"])
        self.assertEqual("unknown", context["native"]["course_context"]["learner_context"]["prerequisite_attainment"])
        self.assertTrue(all(not page["questions"] for page in context["native"]["pages"]))
        self.assertEqual(0, writer["attempt_policy"]["actual_attempts"])

    def test_authored_questions_keys_rubrics_audio_and_final_files_do_not_cross_intake(self):
        reference = copy.deepcopy(self.reference)
        sentinel = "EXCLUDED_AUTHOR_MATERIAL_SENTINEL"
        for page in reference["native"]["pages"]:
            for node in page.get("nodes", []):
                for key in ("mcqs", "rubric", "check", "audio", "step_audio", "verdict", "scoring"):
                    node[key] = sentinel
        for key in ("record", "cast", "organiser", "store"):
            reference["native"][key] = sentinel
        outputs = self.prepare(reference)
        self.assertNotIn(sentinel, json.dumps(outputs))
        def keys(value):
            found = set()
            if isinstance(value, dict):
                found.update(value)
                for child in value.values():
                    found.update(keys(child))
            elif isinstance(value, list):
                for child in value:
                    found.update(keys(child))
            return found
        self.assertFalse({"mcqs", "rubric", "audio", "step_audio", "verdict", "scoring"} & keys(outputs))

    def test_missing_reading_source_or_source_blocks_refuses_without_filling_a_gap(self):
        for mutation in ("nodes", "blocks"):
            reference = copy.deepcopy(self.reference)
            page = next(page for page in reference["native"]["pages"] if page["id"] == "reading-2")
            if mutation == "nodes":
                page["nodes"] = []
            else:
                page["nodes"][0]["blocks"] = []
            with self.assertRaisesRegex(InputError, "required|missing"):
                self.prepare(reference)

    def test_reordered_or_duplicate_reading_pages_are_refused(self):
        for duplicate in (False, True):
            reference = copy.deepcopy(self.reference)
            pages = reference["native"]["pages"]
            if duplicate:
                pages.insert(7, copy.deepcopy(pages[6]))
            else:
                pages[6], pages[7] = pages[7], pages[6]
            with self.assertRaisesRegex(InputError, "learner order"):
                self.prepare(reference)

    def test_unknown_block_kind_has_no_silent_text_fallback(self):
        reference = copy.deepcopy(self.reference)
        reference["native"]["pages"][6]["nodes"][0]["blocks"][0]["kind"] = "unsupported"
        with self.assertRaisesRegex(InputError, "unsupported reading block"):
            self.prepare(reference)

    def test_fact_with_wrong_source_id_or_wrong_source_pointer_is_rejected(self):
        for source in ("not-a-source", "reading-2"):
            writer, _, _ = self.prepare()
            writer["facts"]["facts"][0]["source_asset_ref"] = source
            with self.assertRaisesRegex(InputError, "unknown source|different reading"):
                check_preparation(writer, self.reference)

    def test_changed_quote_or_broken_pointer_is_rejected(self):
        for field, value in (("text", "Invented source claim"), ("source_pointer", "/native/pages/900/nodes/0/blocks/0/text")):
            writer, _, _ = self.prepare()
            writer["facts"]["facts"][0][field] = value
            with self.assertRaises(InputError):
                check_preparation(writer, self.reference)

    def test_future_sources_fact_refs_and_swapped_slots_are_rejected(self):
        for mutation in ("sources", "facts", "order"):
            writer, _, _ = self.prepare()
            if mutation == "sources":
                writer["sequence_blueprint"][0]["source_refs"].append("reading-4")
            elif mutation == "facts":
                future = next(fact["id"] for fact in writer["facts"]["facts"] if fact["source_asset_ref"] == "reading-4")
                writer["sequence_blueprint"][0]["fact_refs"].append(future)
            else:
                writer["sequence_blueprint"][0], writer["sequence_blueprint"][1] = writer["sequence_blueprint"][1], writer["sequence_blueprint"][0]
            with self.assertRaises(InputError):
                check_preparation(writer, self.reference)

    def test_unidentified_dramatic_speaker_is_not_inferred(self):
        reference = copy.deepcopy(self.reference)
        reference["native"]["pages"][7]["nodes"][0]["blocks"][1]["lines"][0]["who"] = None
        with self.assertRaisesRegex(InputError, "identified speaker"):
            self.prepare(reference)

    def test_altered_source_body_hash_origin_or_speaker_is_rejected(self):
        for mutation in ("body", "hash", "origin", "speaker"):
            writer, _, _ = self.prepare()
            course = writer["lesson_context"]["native"]["course_context"]
            if mutation == "body":
                course["source_assets"][0]["blocks"] = [{"kind": "para", "text": "Invented source body"}]
            elif mutation == "hash":
                course["source_assets"][0]["sha256"] = "changed"
            elif mutation == "origin":
                writer["facts"]["facts"][0]["origin"] = "dramatic-dialogue"
            else:
                writer["facts"]["facts"][0]["speaker"] = "INVENTED SPEAKER"
            with self.assertRaisesRegex(InputError, "differ|differs"):
                check_preparation(writer, self.reference)

    def test_conflicting_context_exposure_pages_or_inserted_question_is_rejected(self):
        for mutation in ("exposure", "pages", "question", "progress"):
            writer, _, _ = self.prepare()
            context = writer["lesson_context"]
            if mutation == "exposure":
                context["native"]["course_context"]["exposure_history"][0]["visible_source_refs"] = ["reading-4"]
            elif mutation == "pages":
                context["native"]["pages"][0]["source_refs"] = ["reading-4"]
            elif mutation == "question":
                context["native"]["pages"][0]["questions"].append({"stem": "A premature question"})
            else:
                context["progress"]["academic_quality"] = "qualified"
            with self.assertRaises(InputError):
                check_preparation(writer, self.reference)

    def test_missing_methods_format_or_provenance_refuses_preparation(self):
        for mutation in ("methods", "formats", "provenance"):
            methods, formats, provenance = copy.deepcopy(self.methods), copy.deepcopy(self.formats), copy.deepcopy(self.provenance)
            if mutation == "methods":
                methods["cards"].pop()
            elif mutation == "formats":
                formats["formats"] = [row for row in formats["formats"] if row["id"] != "classification"]
            else:
                del provenance["knowledge_baseline_sha256"]
            with self.assertRaises(InputError):
                prepare_reference(self.reference, formats, methods, provenance)


if __name__ == "__main__":
    unittest.main()
