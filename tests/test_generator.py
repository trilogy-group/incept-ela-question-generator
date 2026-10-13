"""Mutation tests for actual source, routing and pre-attempt delivery boundaries."""

import copy
import importlib.util
import json
from pathlib import Path
import unittest
from unittest.mock import patch


ROOT = Path(__file__).resolve().parents[1]
MODULE_SPEC = importlib.util.spec_from_file_location("prototype_generator", ROOT / "generator.py")
generator = importlib.util.module_from_spec(MODULE_SPEC)
MODULE_SPEC.loader.exec_module(generator)


class BoundedPrototypeTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.lessons = json.loads((ROOT / "examples" / "lessons.json").read_text())["lessons"]
        cls.formats = json.loads((ROOT / "public" / "formats.json").read_text())
        cls.methods = json.loads((ROOT / "public" / "generation-standard.json").read_text())

    def lesson(self, number=0):
        return copy.deepcopy(self.lessons[number])

    def run_lesson(self, lesson=None):
        return generator.generate(lesson or self.lesson(), self.formats, self.methods)

    def test_two_real_sequences_are_built_from_kernels_not_saved_responses(self):
        for lesson in self.lessons:
            with self.subTest(lesson=lesson["id"]):
                result = self.run_lesson(copy.deepcopy(lesson))
                self.assertEqual("prepared-for-review", result["status"])
                self.assertEqual(7, len(result["items"]))
                self.assertEqual(list(generator.ROLE_FORMAT.values()), [item["type"] for item in result["items"]])
                self.assertEqual(8, result["generation_trace"]["candidate_count"])
                self.assertEqual([], result["generation_trace"]["repairs"])
                self.assertEqual(0, result["generation_trace"]["model_calls"])
                self.assertNotIn("items", lesson)
                self.assertNotIn("items", lesson["content_notes"])
                self.assertEqual(8, len(result["generation_trace"]["methods"]))

    def test_semantic_kernel_change_reaches_generated_task_without_saved_output(self):
        lesson = self.lesson()
        lesson["content_notes"]["kernels"][0]["focus"]["question_focus"] = "how the two helpers describe their contributions"
        result = self.run_lesson(lesson)
        self.assertIn("how the two helpers describe their contributions", result["items"][4]["stem"])

    def test_invalid_quote_holds_whole_sequence_and_preserves_first_draft(self):
        lesson = self.lesson()
        lesson["content_notes"]["kernels"][0]["evidence"][0]["quote"] = "A source line that does not exist."
        result = self.run_lesson(lesson)
        self.assertEqual("held", result["status"])
        self.assertEqual([], result["items"])
        self.assertEqual([], result["student_view"]["items"])
        self.assertEqual(1, result["generation_trace"]["candidate_count"])
        self.assertTrue(result["generation_trace"]["first_attempt"][0]["construction_issues"])
        self.assertIn("not an exact source substring", result["generation_trace"]["refused_candidates"][0]["reasons"][0])

    def test_missing_source_holds_instead_of_synthesizing_a_fallback(self):
        lesson = self.lesson()
        lesson["request"]["course_context"]["source_assets"] = [row for row in lesson["request"]["course_context"]["source_assets"] if row["id"] != "S1"]
        result = self.run_lesson(lesson)
        self.assertEqual("held", result["status"])
        self.assertFalse(result["items"])
        self.assertEqual([], result["generation_trace"]["repairs"])

    def test_unknown_public_catalog_format_refuses_after_preserving_earlier_drafts(self):
        formats = copy.deepcopy(self.formats)
        formats["formats"] = [row for row in formats["formats"] if row["id"] != "rebuttal"]
        result = generator.generate(self.lesson(), formats, self.methods)
        self.assertEqual("held", result["status"])
        self.assertFalse(result["items"])
        self.assertEqual(7, len(result["generation_trace"]["first_attempt"]))
        self.assertIn("format is unsupported", result["generation_trace"]["refused_candidates"][0]["reasons"][0])

    def test_private_evaluator_inputs_are_rejected_even_if_nested(self):
        for name in ("expected_labels", "holdout", "judge_prompt", "evaluator_results", "ready_response"):
            with self.subTest(field=name):
                lesson = self.lesson()
                lesson["content_notes"]["kernels"][0][name] = {"any": "payload"}
                with self.assertRaises(generator.InputError):
                    self.run_lesson(lesson)

    def test_transfer_cannot_reuse_an_already_practised_source(self):
        lesson = self.lesson()
        context = lesson["request"]["course_context"]
        context["lesson_plan"]["phases"][-1]["source_refs"] = ["S1"]
        context["pairing_tables"][0]["pairs"][-1]["source_ref"] = "S1"
        result = self.run_lesson(lesson)
        self.assertEqual("held", result["status"])
        self.assertIn("fresh source", result["holds"][0]["detail"])
        self.assertTrue(result["generation_trace"]["first_attempt"])

    def test_renaming_practice_source_does_not_make_transfer_fresh(self):
        lesson = self.lesson()
        sources = lesson["request"]["course_context"]["source_assets"]
        next(row for row in sources if row["id"] == "S2")["text"] = next(row for row in sources if row["id"] == "S1")["text"]
        result = self.run_lesson(lesson)
        self.assertEqual("held", result["status"])
        self.assertIn("renamed duplicate", result["holds"][0]["detail"])

    def test_transfer_source_already_in_instruction_is_held(self):
        lesson = self.lesson()
        context = lesson["request"]["course_context"]
        context["prior_exposure"][0]["source_refs"].append("S2")
        result = self.run_lesson(lesson)
        self.assertEqual("held", result["status"])
        self.assertIn("fresh source", result["holds"][0]["detail"])

    def test_missing_pairing_does_not_silently_route_to_a_nearby_target(self):
        lesson = self.lesson()
        lesson["request"]["course_context"]["pairing_tables"][0]["pairs"].pop(2)
        result = self.run_lesson(lesson)
        self.assertEqual("held", result["status"])
        self.assertIn("pairing is missing", result["holds"][0]["detail"])

    def test_production_task_cannot_be_substituted_with_selection(self):
        lesson = self.lesson()
        lesson["request"]["sequence_blueprint"][-1]["formats"] = ["single_choice"]
        result = self.run_lesson(lesson)
        self.assertEqual("held", result["status"])
        self.assertIn("observable-performance route", result["holds"][0]["detail"])

    def test_first_candidate_selection_and_unselected_alternative_are_auditable(self):
        result = self.run_lesson()
        trace = result["generation_trace"]
        variants = [candidate for candidate in trace["first_attempt"] if candidate["item"]["sequence_role"] == "claim"]
        self.assertEqual(["direct", "careful"], [candidate["variant"] for candidate in variants])
        selection = next(row for row in trace["selection"] if row["item_id"].endswith("02"))
        self.assertEqual("direct", selection["variant"])
        self.assertEqual(result["items"][1], variants[0]["item"])

    def test_learner_packet_has_no_keys_feedback_author_notes_or_future_source(self):
        result = self.run_lesson()
        projection = result["student_view"]
        for number, item in enumerate(projection["items"]):
            self.assertFalse({"scoring", "feedback", "source_bindings", "generation_trace", "content_notes"} & set(item))
            self.assertEqual(["S2"] if number == 6 else ["S1"], [row["id"] for row in item["stimuli"]])
            self.assertNotIn("claim", [row["id"] for row in item.get("options", [])])
        for student in projection["items"]:
            for row in student.get("task_payload", {}).get("entries", []):
                self.assertEqual({"id", "text"}, set(row))

    def test_nested_answer_metadata_is_not_projected(self):
        result = self.run_lesson()
        result["items"][0]["task_payload"]["entries"][0]["correct_category"] = "public"
        result["items"][1]["options"][0]["correct"] = True
        projection = generator.student_projection(result, self.lesson()["request"])
        self.assertNotIn("correct_category", projection["items"][0]["task_payload"]["entries"][0])
        self.assertNotIn("correct", projection["items"][1]["options"][0])

    def test_unknown_learner_instruction_is_rejected_not_silently_lost(self):
        result = self.run_lesson()
        result["items"][0]["task_payload"]["new_critical_instruction"] = "Needs a contract"
        with self.assertRaises(generator.InputError):
            generator.student_projection(result)

    def test_every_quote_binding_resolves_to_exact_visible_source_bytes(self):
        for lesson in self.lessons:
            sources = {row["id"]: row["text"] for row in lesson["request"]["course_context"]["source_assets"]}
            result = self.run_lesson(copy.deepcopy(lesson))
            for item in result["items"]:
                for span in item["source_bindings"]:
                    self.assertEqual(span["quote"], sources[span["source_ref"]][span["start"]:span["end"]])

    def test_no_unapproved_model_or_evaluator_read_occurs(self):
        original_read = Path.read_text
        reads = []
        def record(path, *args, **kwargs):
            reads.append(path.resolve())
            return original_read(path, *args, **kwargs)
        with patch.object(Path, "read_text", record):
            result = self.run_lesson()
        self.assertEqual([], reads)
        self.assertEqual(0, result["generation_trace"]["model_calls"])

    def test_each_observable_operation_has_a_distinct_public_target(self):
        for lesson in self.lessons:
            result = self.run_lesson(copy.deepcopy(lesson))
            targets = [tuple(item["knowledge_target"]) for item in result["items"]]
            self.assertEqual(7, len(set(targets)))
            self.assertEqual([("K1",), ("K2",), ("K3",), ("K4",), ("K5",), ("K6",), ("K7",)], targets)

    def test_choice_feedback_tracks_displayed_neutral_ids_and_no_early_reveal(self):
        result = self.run_lesson()
        choice = result["items"][1]
        rationales = [row for row in choice["feedback"] if row["kind"] == "authored-option-rationale"]
        self.assertEqual({row["id"] for row in choice["options"]}, {row["response_condition"]["selected_option_id"] for row in rationales})
        self.assertTrue(all(row["requires_attempt"] for row in rationales))
        for item in result["items"][:6]:
            reveal = next(row for row in item["feedback"] if row["kind"] == "teacher-reference")
            self.assertEqual("F6", reveal["release_after_phase"])
        immediate = result["items"][0]["feedback"][0]
        self.assertNotEqual(choice["options"][-1]["text"], immediate["text"])

    def test_open_marking_contract_has_allocation_uncertainty_and_partial_examples(self):
        for lesson in self.lessons:
            result = self.run_lesson(copy.deepcopy(lesson))
            for item in result["items"]:
                if item["scoring"]["kind"] != "rubric":
                    continue
                marking = item["scoring"]
                self.assertEqual(len(marking["key_or_rubric"]), marking["allocation"]["maximum_credits"])
                self.assertEqual([row["id"] for row in marking["key_or_rubric"]], marking["allocation"]["criterion_ids"])
                self.assertEqual({"fully-developed-illustration", "partial-illustration", "unsupported-illustration"}, {row["level"] for row in marking["worked_marking_examples"]})
                self.assertTrue(all(row["draft_credit"]["unclear"] is None for row in marking["key_or_rubric"]))
                self.assertIn("pending review", marking["allocation"]["rule"])
                self.assertTrue(all("not an independently labelled case" in row["status"] for row in marking["worked_marking_examples"]))


if __name__ == "__main__":
    unittest.main()
