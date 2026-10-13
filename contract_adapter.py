"""Lossless envelope adaptation to the public question-set 0.1 contract.

The kinds describe presentation families. They do not assert that an existing
semantic evaluator supports a new operation or has validated this generator.
"""

import copy

from generator import InputError


KINDS = {
    "classification": "classify",
    "single_choice": "reading_mcq",
    "evidence_selection": "evidence_select",
    "short_explanation": "open_check",
    "learner_question": "open_prompt",
    "rebuttal": "open_prompt",
    "integrated_response": "open_prompt",
}


def _view(item):
    kind = item["type"]
    payload = copy.deepcopy(item["task_payload"])
    shared = {
        "native_format": kind,
        "knowledge_target": list(item["knowledge_target"]),
        "sequence_role": item["sequence_role"],
        "source_refs": list(item["source_refs"]),
        "task_payload": payload,
        "source_bindings": copy.deepcopy(item["source_bindings"]),
        "feedback": copy.deepcopy(item["feedback"]),
    }
    scoring = item["scoring"]
    if kind == "single_choice":
        ids = [row["id"] for row in item["options"]]
        by_id = {row["response_condition"]["selected_option_id"]: row["text"]
                 for row in item["feedback"] if row["kind"] == "authored-option-rationale"}
        shared.update({
            "stem": item["stem"], "options": [row["text"] for row in item["options"]],
            "option_ids": ids, "key": [ids.index(key) for key in scoring["key_or_rubric"]],
            "option_feedback": [by_id.get(option) for option in ids],
        })
    elif kind == "evidence_selection":
        good = set(scoring["key_or_rubric"])
        shared.update({
            "prompt": item["stem"], "claim": payload["claim"],
            "options": copy.deepcopy(item["options"]),
            "candidates": [row["text"] for row in item["options"]],
            "strong": [row["text"] for row in item["options"] if row["id"] in good],
            "decoys": [row["text"] for row in item["options"] if row["id"] not in good],
            "key_option_ids": list(scoring["key_or_rubric"]),
            "selection_rule": payload["selection"],
        })
    elif kind == "classification":
        shared.update({
            "prompt": item["stem"], "categories": copy.deepcopy(payload["categories"]),
            "entries": copy.deepcopy(payload["entries"]),
            "mapping": copy.deepcopy(scoring["key_or_rubric"]),
        })
    else:
        shared.update({
            "prompt": item["stem"],
            "rubric": {
                "id": item["id"] + "-rubric", "question": item["stem"],
                "criteria": copy.deepcopy(scoring["key_or_rubric"]),
                "allocation": copy.deepcopy(scoring["allocation"]),
                "combination_rules": copy.deepcopy(scoring["combination_rules"]),
                "worked_marking_examples": copy.deepcopy(scoring["worked_marking_examples"]),
                "status": scoring["status"],
            },
        })
    return shared


def adapt(spec, response, source):
    """Produce public context and full teacher set; do not consult an evaluator."""
    if response["status"] != "prepared-for-review":
        raise InputError("A held sequence cannot be adapted as a completed question set")
    pages = []
    items = []
    for number, native in enumerate(response["items"]):
        native_kind = native["type"]
        if native_kind not in KINDS:
            raise InputError(f"Unsupported native format {native_kind}; no silent kind fallback")
        pages.append({"id": native["phase_ref"], "questions": [copy.deepcopy(native)]})
        items.append({
            "id": native["id"], "page": native["phase_ref"], "order": number + 1,
            "kind": KINDS[native_kind], "pointer": f"/pages/{number}/questions/0",
            "view": _view(native), "native": copy.deepcopy(native),
            "adapter_extension": {
                "version": "bounded-authored-adapter/0.1", "operation": native_kind,
                "status": "presentation envelope only; semantic evaluator coverage is not verified",
                "required_context": ["declared targets", "visible source", "support and reveal history"],
                "native_scoring_preserved": True,
            },
        })
    course = copy.deepcopy(spec["request"]["course_context"])
    context = {
        "contract": "lesson-context 0.1", "source": copy.deepcopy(source),
        "lesson": {
            "id": spec["id"], "title": spec["title"],
            "learning_question": spec["title"],
            "keywords": [], "declared_targets": copy.deepcopy(course["core_knowledge"]),
            "learning_question_status": "title supplied as context label; no curriculum question invented",
        },
        "native": {
            "id": spec["id"], "pages": pages, "course_context": course,
            "sequence_blueprint": copy.deepcopy(spec["request"]["sequence_blueprint"]),
        },
    }
    question_set = {
        "contract": "question-set 0.1", "source": copy.deepcopy(source), "lesson": spec["id"],
        "made_by": {"kind": "generated", "note": "Bounded compiler from authored semantic kernels; zero model calls."},
        "items": items,
        "quality_status": "independent academic review and evaluator qualification pending",
    }
    return context, question_set


def check_pair(context, question_set):
    """Check reference integrity only, never academic item quality."""
    if context.get("contract") != "lesson-context 0.1" or question_set.get("contract") != "question-set 0.1":
        raise InputError("Unsupported shared contract")
    if context["source"] != question_set["source"] or context["lesson"]["id"] != question_set["lesson"]:
        raise InputError("Context and question set refer to different sources or lessons")
    seen = set()
    for number, item in enumerate(question_set["items"], 1):
        if item["id"] in seen or item["order"] != number:
            raise InputError("Question identifiers/order must be unique and sequential")
        seen.add(item["id"])
        if item["kind"] not in set(KINDS.values()):
            raise InputError("Unknown contract kind")
        pointer = item["pointer"].split("/")[1:]
        selected = context["native"]
        try:
            for part in pointer:
                part = part.replace("~1", "/").replace("~0", "~")
                selected = selected[int(part)] if isinstance(selected, list) else selected[part]
        except (KeyError, IndexError, ValueError, TypeError) as error:
            raise InputError("Native pointer does not resolve") from error
        if selected != item["native"] or item["view"] != _view(item["native"]):
            raise InputError("Native copy or standardized view changed during adaptation")
    return len(seen)
