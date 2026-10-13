"""Transport checks reject missing fields and wrong kinds, not just valid fixtures."""

import copy
import json
from pathlib import Path
import sys
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from contract_adapter import adapt  # noqa: E402
from generator import InputError, generate  # noqa: E402
from transport import validate  # noqa: E402


class TransportTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        lesson = json.loads((ROOT / "examples" / "lessons.json").read_text())["lessons"][0]
        formats = json.loads((ROOT / "public" / "formats.json").read_text())
        methods = json.loads((ROOT / "public" / "generation-standard.json").read_text())
        _, cls.packet = adapt(lesson, generate(lesson, formats, methods), {"kind": "fixture"})
        cls.schema = json.loads((ROOT / "schema" / "question-set.schema.json").read_text())

    def test_missing_required_native_field_is_rejected(self):
        packet = copy.deepcopy(self.packet)
        del packet["items"][0]["native"]
        with self.assertRaisesRegex(InputError, "missing required"):
            validate(packet, self.schema)

    def test_unknown_kind_and_boolean_order_are_rejected(self):
        for field, value in (("kind", "unknown"), ("order", True)):
            packet = copy.deepcopy(self.packet)
            packet["items"][0][field] = value
            with self.assertRaises(InputError):
                validate(packet, self.schema)

    def test_new_schema_keyword_is_not_silently_ignored(self):
        schema = copy.deepcopy(self.schema)
        schema["unexpectedConstraint"] = True
        with self.assertRaisesRegex(InputError, "unsupported transport schema"):
            validate(self.packet, schema)


if __name__ == "__main__":
    unittest.main()
