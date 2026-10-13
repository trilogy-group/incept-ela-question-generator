"""Bounded authored compiler for two question-sequence prototypes.

This module uses public course inputs and author-supplied semantic kernels. It
does not interpret arbitrary prose, call a model, or read evaluator artifacts.
Its checks establish construction constraints, never academic item quality.
"""

from __future__ import annotations

import copy
import hashlib
import json


VERSION = "bounded-authored-compiler/0.1"
PROTOCOL = "question-lane-generation/0.1"
FORMATS = {
    "classification", "single_choice", "evidence_selection", "short_explanation",
    "learner_question", "rebuttal", "integrated_response",
}
ROLE_FORMAT = {
    "observation": "classification", "claim": "single_choice",
    "evidence": "evidence_selection", "explain": "short_explanation",
    "question": "learner_question", "rebuttal": "rebuttal",
    "transfer": "integrated_response",
}
STUDENT_FIELDS = (
    "id", "type", "stem", "knowledge_target", "sequence_role", "source_refs",
    "phase_ref", "content_key_refs", "options", "task_payload",
)
PRIVATE_FIELDS = {
    "expected", "expected_verdict", "expected_labels", "gold_labels", "gold_set",
    "holdout", "holdout_labels", "evaluator_prompt", "evaluator_results",
    "judge_prompt", "benchmark_cases", "private_evaluator", "private_cases",
    "teacher_output", "ready_response", "items", "student_view", "generation_trace",
}
PAYLOAD_FIELDS = {
    "classification": {"support", "categories", "entries", "placement_rule"},
    "single_choice": {"support", "selection"},
    "evidence_selection": {"support", "selection", "claim"},
    "short_explanation": {"support", "response_mode", "suggested_length"},
    "learner_question": {"support", "response_mode", "response_parts", "requirements"},
    "rebuttal": {"support", "response_mode", "counterclaim"},
    "integrated_response": {"support", "response_mode", "new_source"},
}


class InputError(ValueError):
    """An input or compiler prerequisite is missing; no fallback is invented."""


def _digest(value):
    return hashlib.sha256(json.dumps(value, ensure_ascii=False, sort_keys=True).encode()).hexdigest()


def _reject_private(value, path="input"):
    if isinstance(value, dict):
        for key, child in value.items():
            if key.lower() in PRIVATE_FIELDS:
                raise InputError(f"{path}.{key}: private evaluator input is outside the generator boundary")
            _reject_private(child, f"{path}.{key}")
    elif isinstance(value, list):
        for number, child in enumerate(value):
            _reject_private(child, f"{path}[{number}]")


def _catalog_ids(formats):
    entries = formats.get("formats", formats) if isinstance(formats, dict) else formats
    if isinstance(entries, dict):
        return set(entries)
    if isinstance(entries, list):
        return {entry["id"] for entry in entries if isinstance(entry, dict) and "id" in entry}
    raise InputError("formats must contain an explicit public format catalog")


def _source_binding(source_id, quote, sources):
    if not quote:
        raise InputError("Empty evidence quote")
    source = sources.get(source_id)
    if not source or not isinstance(source.get("text"), str):
        raise InputError(f"{source_id}: required source text is missing")
    start = source["text"].find(quote)
    if start < 0:
        raise InputError(f"{source_id}: evidence is not an exact source substring: {quote!r}")
    return {"source_ref": source_id, "quote": quote, "start": start, "end": start + len(quote)}


def _rubric(kernel, requirements):
    return [
        {
            "id": f"R{number}", "requirement": requirement,
            "source_refs": [kernel["source_ref"]],
            "evidence": [row["quote"] for row in kernel["evidence"]],
            "evidence_role": "Reference spans to consult in context, not a rule that any quotation satisfies every criterion.",
            "draft_credit": {"met": 1, "not_met": 0, "partial": 0, "unclear": None},
            "partial_policy": "Keep what the learner establishes in the review note; the missing required relation receives no full credit yet.",
            "accept_alternative": "Equivalent source-supported reasoning counts; these are not string-match keys.",
        }
        for number, requirement in enumerate(requirements, 1)
    ]


def _build_candidate(request, kernel, step, phase, item_id, variant):
    """Compose a task from a semantic kernel; no input contains a finished item."""
    role = step["role"]
    format_id = ROLE_FORMAT[role]
    focus = kernel["focus"]
    item = {
        "id": item_id, "type": format_id,
        "knowledge_target": list(step["target"]), "sequence_role": role,
        "source_refs": [kernel["source_ref"]], "phase_ref": phase["id"],
        "content_key_refs": list(phase["content_key_refs"]),
        "task_payload": {"support": step["support"]},
    }
    if role == "observation":
        item["stem"] = (
            f"Sort each statement about {focus['subject']} by the kind of evidence it reports. "
            "Use the passage and the category descriptions."
        )
        item["task_payload"].update({
            "categories": copy.deepcopy(kernel["categories"]),
            "entries": [{"id": row["id"], "text": row["text"]} for row in kernel["classifications"]],
            "placement_rule": "Every statement goes in one category; there is no required number in each category.",
        })
        item["scoring"] = {
            "kind": "mapping", "key_or_rubric": {row["id"]: row["category"] for row in kernel["classifications"]},
            "ambiguity_policy": "If another source-supported category fits, hold for review rather than rejecting the learner.",
        }
    elif role == "claim":
        item["stem"] = (
            f"Which conclusion about {focus['subject']} is best supported by the passage?"
            if variant == "direct" else
            f"What conclusion does the passage support about {focus['subject']}?"
        )
        option_texts = [kernel["claim"], *[row["claim"] for row in kernel["distractors"]]]
        # A deterministic layout transform, not a quality rule or a scored property.
        offset = sum(ord(char) for char in request["request_id"]) % len(option_texts)
        displayed = option_texts[offset:] + option_texts[:offset]
        item["options"] = [{"id": f"o{number}", "text": text} for number, text in enumerate(displayed, 1)]
        item["scoring"] = {"kind": "single-key", "key_or_rubric": [f"o{displayed.index(kernel['claim']) + 1}"]}
        item["task_payload"]["selection"] = "single"
    elif role == "evidence":
        item["stem"] = "Which quoted lines give evidence for the claim below? Select all that apply."
        item["options"] = [{"id": row["id"], "text": row["quote"]} for row in kernel["evidence"]]
        item["task_payload"].update({"claim": kernel["evidence_claim"], "selection": "multiple"})
        item["scoring"] = {
            "kind": "multiple-key", "key_or_rubric": [row["id"] for row in kernel["evidence"] if row.get("supports", True)],
            "alternative_policy": "An unlisted quotation can be reviewed for relevance; exact option IDs apply only to this closed task.",
        }
    elif role == "explain":
        comparison_instruction = "State the observed comparison first. Then explain " if focus.get("state_comparison_first") else "Explain "
        item["stem"] = f"{comparison_instruction}{focus['explanation_focus']}. Use one short quotation and show how it supports your reasoning."
        item["task_payload"].update({"response_mode": "written", "suggested_length": "Two or three sentences; reasoning matters more than length."})
        item["scoring"] = {"kind": "rubric", "key_or_rubric": _rubric(kernel, kernel["reasoning_requirements"])}
    elif role == "question":
        item["stem"] = (
            f"Write a question that makes a reader explain {focus['question_focus']}. "
            "Then identify a line a good answer would need to discuss, and say why."
        )
        item["task_payload"].update({"response_mode": "written", "response_parts": ["question", "quotation", "reason"], "requirements": ["A question in your own words", "A relevant quotation", "Why that line matters"]})
        item["scoring"] = {"kind": "rubric", "key_or_rubric": _rubric(kernel, [
            "The question requires the specified inference or distinction, rather than merely copying a fact.",
            "The learner identifies source evidence that makes the question answerable.",
            "The learner explains why that source detail would matter to an answer.",
        ])}
    elif role == "rebuttal":
        item["stem"] = (
            "A reader makes the claim below. Explain what is wrong or missing in it. "
            "Use the passage, then give a more careful conclusion."
        )
        item["task_payload"].update({"response_mode": "written", "counterclaim": kernel["rival_claim"]})
        item["scoring"] = {"kind": "rubric", "key_or_rubric": _rubric(kernel, [
            kernel["rebuttal_requirement"],
            "Use a relevant quotation or precisely identified source detail to explain the limitation.",
            f"Replace the claim with a conclusion no stronger than: {kernel['claim']}",
        ])}
    elif role == "transfer":
        item["stem"] = (
            f"Read the new passage. {focus['transfer_question']} "
            "Give a supported conclusion, one short quotation, and an explanation of how it supports the conclusion."
        )
        item["task_payload"].update({"response_mode": "written", "new_source": True})
        item["scoring"] = {"kind": "rubric", "key_or_rubric": _rubric(kernel, kernel["reasoning_requirements"])}
    item["feedback"] = [
        {"when": "after-attempt", "requires_attempt": True, "release_stage": "review", "kind": "source-directed", "text": kernel["classification_feedback"] if role == "observation" else focus["feedback_direction"]},
        {"when": "after-attempt", "requires_attempt": True, "release_stage": "teacher-approved-reveal", "release_after_phase": "F7" if role == "transfer" else "F6", "kind": "teacher-reference", "text": kernel["claim"]},
    ]
    if role == "claim":
        explanations = {kernel["claim"]: kernel["claim_reason"], **{row["claim"]: row["why"] for row in kernel["distractors"]}}
        for option in item["options"]:
            item["feedback"].append({
                "when": "after-attempt", "requires_attempt": True, "release_stage": "review",
                "kind": "authored-option-rationale", "response_condition": {"selected_option_id": option["id"]},
                "text": explanations[option["text"]],
                "interpretation": "This explains a property of the option; it is not a diagnosis of the learner's misconception.",
                "next_opportunity": "Use the next evidence and explanation tasks to justify or revise the conclusion on this same source; they are supported practice.",
            })
    elif role == "evidence":
        for evidence in kernel["evidence"]:
            item["feedback"].append({
                "when": "after-attempt", "requires_attempt": True, "release_stage": "review",
                "kind": "authored-evidence-rationale", "response_condition": {"option_id": evidence["id"]},
                "text": evidence["why"], "interpretation": "Relevance is to this stated claim, not to every possible question about the passage.",
            })
    if item["scoring"]["kind"] == "rubric":
        item["scoring"].update({
            "allocation": {
                "status": "draft analytic marking illustration; not an adopted scoring policy",
                "criterion_ids": [row["id"] for row in item["scoring"]["key_or_rubric"]],
                "maximum_credits": len(item["scoring"]["key_or_rubric"]),
                "rule": "Award one credit for each fully met criterion; assess criteria separately. If a criterion is unclear, withhold its verdict and the total pending review.",
                "quality_inference": "A total is only a response-marking illustration; it is not an evaluator qualification or item-quality threshold.",
            },
            "combination_rules": [
                "A quotation without the required explained link can meet an evidence criterion but cannot meet a reasoning criterion.",
                "A direct contradiction of a criterion prevents credit on that criterion, even when a correct quotation is also present.",
                "A defensible alternative interpretation can meet a criterion if it accounts for the relevant source details and keeps the required scope.",
                "Off-task, copied-stem and unintelligible replies need review; no mechanical keyword match earns a semantic credit.",
            ],
            "worked_marking_examples": copy.deepcopy(kernel["answer_examples"][role]),
        })
        item["feedback"].extend([
            {
                "when": "after-attempt", "requires_attempt": True, "release_stage": "review",
                "kind": "authored-review-move", "response_condition": {"teacher_or_future_qualified_marker_finds": "quotation-without-explained-link"},
                "text": "You have located a detail. Explain what it shows and why that detail supports your conclusion.",
                "routing_status": "Conditional teacher move; no runtime semantic marker is implemented or validated here.",
            },
            {
                "when": "after-attempt", "requires_attempt": True, "release_stage": "review",
                "kind": "authored-review-move", "response_condition": {"teacher_or_future_qualified_marker_finds": "claim-stronger-than-source"},
                "text": "Separate what the passage establishes from what it leaves uncertain. Revise the claim to fit the evidence.",
                "routing_status": "Conditional teacher move; no runtime semantic marker is implemented or validated here.",
            },
        ])
    item["scoring"]["status"] = "authored-reference-needs-independent-academic-review"
    item["scoring"]["source_refs"] = list(item["source_refs"])
    return item


def _construction_issues(item, kernel, phase, sources, format_ids):
    issues = []
    if item["type"] not in format_ids or item["type"] not in FORMATS:
        issues.append("format is unsupported or absent from the public catalog")
    if not set(item["knowledge_target"]) <= set(phase["target_refs"]):
        issues.append("task targets do not match the lesson phase")
    if item["source_refs"] != phase["source_refs"]:
        issues.append("task source does not match the lesson phase")
    if not set(item["content_key_refs"]) <= set(phase["content_key_refs"]):
        issues.append("task content keys do not match the lesson phase")
    try:
        bindings = [_source_binding(kernel["source_ref"], row["quote"], sources) for row in kernel["evidence"]]
        item["source_bindings"] = bindings
    except InputError as error:
        issues.append(str(error))
    if item["type"] in {"single_choice", "evidence_selection"}:
        option_ids = [row["id"] for row in item["options"]]
        if len(set(option_ids)) != len(option_ids):
            issues.append("option identifiers are duplicated")
        if len({row["text"] for row in item["options"]}) != len(option_ids):
            issues.append("option texts are duplicated")
        key = item["scoring"]["key_or_rubric"]
        keys = key if isinstance(key, list) else [key]
        if not keys or not set(keys) <= set(option_ids):
            issues.append("answer identifiers do not resolve to displayed options")
    if item["type"] == "classification":
        category_ids = {row["id"] for row in item["task_payload"]["categories"]}
        if not set(item["scoring"]["key_or_rubric"].values()) <= category_ids:
            issues.append("classification mapping references an undisplayed category")
    return issues


def student_projection(response, request=None):
    """A pre-attempt learner packet with no keys, feedback, author notes or traces."""
    items = []
    for item in response["items"]:
        projected = {field: copy.deepcopy(item[field]) for field in STUDENT_FIELDS if field in item and field not in {"options", "task_payload"}}
        if "options" in item:
            projected["options"] = [{"id": option["id"], "text": option["text"]} for option in item["options"]]
        allowed_payload = PAYLOAD_FIELDS.get(item["type"], set())
        unknown_payload = set(item.get("task_payload", {})) - allowed_payload
        if unknown_payload:
            raise InputError(f"Unknown learner payload fields require an explicit delivery contract: {sorted(unknown_payload)}")
        payload = {field: copy.deepcopy(value) for field, value in item.get("task_payload", {}).items() if field in allowed_payload}
        if "categories" in payload:
            payload["categories"] = [{"id": row["id"], "label": row["label"]} for row in payload["categories"]]
        if "entries" in payload:
            payload["entries"] = [{"id": row["id"], "text": row["text"]} for row in payload["entries"]]
        projected["task_payload"] = payload
        if request is not None:
            sources = {row["id"]: row for row in request["course_context"]["source_assets"]}
            projected["stimuli"] = []
            for source_id in item["source_refs"]:
                source = sources.get(source_id)
                if not source or not isinstance(source.get("text"), str):
                    raise InputError(f"Learner delivery cannot resolve source {source_id}")
                stimulus = {field: copy.deepcopy(source[field]) for field in ("id", "text", "revision", "media_kind") if field in source}
                stimulus["text_sha256"] = hashlib.sha256(source["text"].encode()).hexdigest()
                projected["stimuli"].append(stimulus)
        items.append(projected)
    return {
        "protocol": response["protocol"], "request_id": response["request_id"],
        "items": items,
    }


def generate(spec, formats, generation_standard):
    """Return a bounded teacher sequence or typed hold; never consult a judge."""
    _reject_private(spec)
    _reject_private(formats, "formats")
    _reject_private(generation_standard, "generation_standard")
    if not isinstance(generation_standard.get("cards"), list) or not generation_standard["cards"]:
        raise InputError("A public generation-method snapshot is required")
    request = spec.get("request", {})
    trace = {
        "generator_version": VERSION, "attempt": 1, "candidate_count": 0,
        "selection": [], "repairs": [], "source_mode": "authored-semantic-kernels-and-exact-public-source",
        "model_calls": 0, "semantic_quality": "not independently verified",
        "input_sha256": _digest(spec), "format_catalog_sha256": _digest(formats),
        "first_attempt": [], "refused_candidates": [],
        "methods": [card["id"] for card in generation_standard["cards"]],
        "public_generation_standard_sha256": _digest(generation_standard),
    }
    response = {
        "protocol": PROTOCOL, "request_id": request.get("request_id", "missing-request-id"),
        "items": [], "generation_trace": trace, "status": "held", "holds": [],
        "trust_scope": "Construction-tested authored prototype; academic quality and individual challenge fit are unverified.",
    }
    try:
        if request.get("protocol") != PROTOCOL:
            raise InputError("Unsupported public generation protocol")
        notes = spec.get("content_notes", {})
        if notes.get("version") != "bounded-authored/0.1":
            raise InputError("A supported explicit semantic authoring packet is required")
        if notes.get("domain") not in {"character-inference", "observation-causality"}:
            raise InputError("Domain is not implemented by this bounded compiler")
        format_ids = _catalog_ids(formats)
        context = request["course_context"]
        sources = {row["id"]: row for row in context["source_assets"]}
        if len(sources) != len(context["source_assets"]):
            raise InputError("Duplicate source identifiers")
        phases = {row["id"]: row for row in context["lesson_plan"]["phases"]}
        targets = {row["id"] for row in context["core_knowledge"]}
        keys = {row["id"] for row in context["content_keys"]}
        kernels = {row["id"]: row for row in notes["kernels"]}
        planned = request["sequence_blueprint"]
        if len(planned) != 7:
            raise InputError("This prototype requires the seven-role lesson sequence")
        if [step.get("role") for step in planned] != list(ROLE_FORMAT):
            raise InputError("Sequence roles or order are not implemented by this bounded compiler")
        pairings = [pair for table in context["pairing_tables"] for pair in table["pairs"]]
        previously_exposed = set()
        for exposure in context.get("prior_exposure", []):
            previously_exposed.update(exposure.get("source_refs", []))
        practice_sources = set()
        for number, step in enumerate(planned, 1):
            phase_list = [phase for phase in phases.values() if phase["role"] == step["role"]]
            if len(phase_list) != 1:
                raise InputError(f"{step['role']}: a unique matching lesson phase is required")
            phase = phase_list[0]
            if not set(step["target"]) <= targets or not set(phase["content_key_refs"]) <= keys:
                raise InputError(f"{step['role']}: unknown target or content key")
            selected_kernels = [kernel for kernel in kernels.values() if kernel["source_ref"] in phase["source_refs"]]
            if len(selected_kernels) != 1:
                raise InputError(f"{step['role']}: a unique source-matched semantic kernel is required")
            kernel = selected_kernels[0]
            if ROLE_FORMAT[step["role"]] not in step["formats"]:
                raise InputError(f"{step['role']}: requested format does not match the observable-performance route")
            for target in step["target"]:
                if not any(pair["target_ref"] == target and pair["source_ref"] == kernel["source_ref"] and pair.get("phase_ref") == phase["id"] and pair.get("content_key_ref") in phase["content_key_refs"] for pair in pairings):
                    raise InputError(f"{step['role']}: target/source/phase/content-key pairing is missing")
            if step["role"] == "transfer":
                if kernel["source_ref"] in practice_sources | previously_exposed:
                    raise InputError("Transfer requires a fresh source, not a source already modeled or practiced")
                source_text = sources[kernel["source_ref"]]["text"]
                if any(source_text == sources[source]["text"] for source in practice_sources):
                    raise InputError("Transfer source is a renamed duplicate of a practiced passage")
                if any(source_text in exposure.get("content", "") for exposure in context.get("prior_exposure", [])):
                    raise InputError("Transfer source was included in prior exposure")
            else:
                practice_sources.add(kernel["source_ref"])
            variants = ["direct", "careful"] if step["role"] == "claim" else ["direct"]
            accepted = []
            for variant in variants:
                item = _build_candidate(request, kernel, step, phase, f"{spec['id']}-{number:02}", variant)
                issues = _construction_issues(item, kernel, phase, sources, format_ids)
                candidate = {"variant": variant, "item": copy.deepcopy(item), "construction_issues": issues}
                trace["first_attempt"].append(candidate)
                trace["candidate_count"] += 1
                if issues:
                    trace["refused_candidates"].append({"id": item["id"], "variant": variant, "reasons": issues})
                else:
                    accepted.append((variant, item))
            if not accepted:
                raise InputError(f"{step['role']}: all candidates failed construction constraints")
            variant, item = accepted[0]
            response["items"].append(item)
            trace["selection"].append({
                "item_id": item["id"], "variant": variant,
                "rule": "First declared format-eligible candidate satisfying exact-source and reference constraints; no semantic judge or best-of-N quality claim.",
            })
        response["status"] = "prepared-for-review"
    except (InputError, KeyError, TypeError, IndexError) as error:
        response["holds"].append({"code": "construction-prerequisite", "detail": str(error)})
        # Atomic sequence refusal; earlier drafts remain auditable but are not served.
        response["items"] = []
    response["student_view"] = student_projection(response, request)
    return response
