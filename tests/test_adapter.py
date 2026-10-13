"""Contract mutations that must not silently alter the authored task or key."""

import copy
import json
from pathlib import Path
import sys
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from contract_adapter import adapt, check_pair  # noqa: E402
from generator import InputError, generate  # noqa: E402


class ContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.specs = json.loads((ROOT / "examples" / "lessons.json").read_text())["lessons"]
        cls.formats = json.loads((ROOT / "public" / "formats.json").read_text())
        cls.methods = json.loads((ROOT / "public" / "generation-standard.json").read_text())

    def pair(self, index=0):
        spec = copy.deepcopy(self.specs[index])
        response = generate(spec, self.formats, self.methods)
        return adapt(spec, response, {"kind": "generator-run", "run": "test"})

    def test_two_pairs_resolve_native_tasks_and_preserve_all_seven_operations(self):
        for index in (0, 1):
            context, questions = self.pair(index)
            self.assertEqual(7, check_pair(context, questions))
            self.assertEqual({"classification", "single_choice", "evidence_selection", "short_explanation", "learner_question", "rebuttal", "integrated_response"}, {item["adapter_extension"]["operation"] for item in questions["items"]})

    def test_choice_key_maps_displayed_ids_to_zero_based_contract_positions(self):
        _, questions = self.pair()
        item = questions["items"][1]
        for index in item["view"]["key"]:
            self.assertIn(item["view"]["option_ids"][index], item["native"]["scoring"]["key_or_rubric"])
        self.assertEqual(len(item["view"]["options"]), len(item["view"]["option_feedback"]))

    def test_evidence_claim_and_selection_rule_survive_standardized_view(self):
        _, questions = self.pair()
        item = questions["items"][2]
        self.assertEqual(item["native"]["task_payload"]["claim"], item["view"]["claim"])
        self.assertEqual("multiple", item["view"]["selection_rule"])
        self.assertTrue(item["view"]["strong"])
        self.assertTrue(item["view"]["decoys"])

    def test_rebuttal_counterclaim_and_atomic_rubric_survive_adaptation(self):
        _, questions = self.pair()
        item = questions["items"][5]
        self.assertEqual("open_prompt", item["kind"])
        self.assertEqual("rebuttal", item["adapter_extension"]["operation"])
        self.assertEqual(item["native"]["task_payload"]["counterclaim"], item["view"]["task_payload"]["counterclaim"])
        self.assertEqual(item["native"]["scoring"]["key_or_rubric"], item["view"]["rubric"]["criteria"])

    def test_native_mutation_and_view_mutation_are_detected(self):
        for which in ("native", "view"):
            context, questions = self.pair()
            questions["items"][0][which]["unexpected"] = "changed"
            with self.assertRaises(InputError):
                check_pair(context, questions)

    def test_broken_pointer_is_a_contract_failure(self):
        context, questions = self.pair()
        questions["items"][0]["pointer"] = "/pages/100/questions/0"
        with self.assertRaisesRegex(InputError, "pointer"):
            check_pair(context, questions)

    def test_changed_source_or_lesson_cannot_mix_sets(self):
        for field in ("source", "lesson"):
            context, questions = self.pair()
            questions[field] = {} if field == "source" else "different"
            with self.assertRaises(InputError):
                check_pair(context, questions)

    def test_unknown_native_format_has_no_generic_fallback(self):
        spec = copy.deepcopy(self.specs[0])
        response = generate(spec, self.formats, self.methods)
        response["items"][0]["type"] = "unimplemented-format"
        with self.assertRaisesRegex(InputError, "Unsupported native format"):
            adapt(spec, response, {})

    def test_held_sequence_cannot_look_like_completed_contract(self):
        spec = copy.deepcopy(self.specs[0])
        spec["content_notes"]["domain"] = "unsupported"
        response = generate(spec, self.formats, self.methods)
        with self.assertRaisesRegex(InputError, "held sequence"):
            adapt(spec, response, {})

    def test_public_context_retains_targets_sources_and_exposure_history(self):
        context, _ = self.pair()
        self.assertEqual(self.specs[0]["request"]["course_context"], context["native"]["course_context"])
        self.assertEqual(7, len(context["lesson"]["declared_targets"]))


if __name__ == "__main__":
    unittest.main()
