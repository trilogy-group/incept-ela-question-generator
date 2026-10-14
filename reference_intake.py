"""Offline, whitelisted public-reference intake; no writer or evaluator execution."""

import copy
import hashlib
import json

from generator import InputError, _catalog_ids


VERSION = "reference-intake/0.1"
READING_PAGES = ("reading-1", "reading-2", "reading-3", "reading-4")
TARGETS = (
    "Recognize the opening characters and the marriage news.",
    "Distinguish Iago's promotion grievance from Roderigo's grievance.",
    "Recognize Iago's stated self-interest behind his apparent service.",
    "Distinguish Iago's declared hatred from the loyalty he displays.",
    "Classify current role, wanted role, outward display and stated purpose.",
)
CATEGORIES = (
    ("iago-current-role", "Iago's current military role"),
    ("iago-wanted-role", "The military role Iago wanted"),
    ("iago-display", "The loyalty Iago says he displays to Othello"),
    ("iago-purpose", "The purpose Iago states privately to Roderigo"),
    ("roderigo-aim", "The marriage Roderigo wanted"),
)
PENDING = {
    "writing": "pending", "evaluation": "pending", "model_calls": 0,
    "academic_quality": "not-qualified", "learner_readiness": "not-established",
}
SUPPORT = "Visible source and authored explanations remain available; interpretations may already be revealed. This is supported practice, not independent mastery evidence."


def value_digest(value):
    return hashlib.sha256(json.dumps(value, ensure_ascii=False, sort_keys=True).encode()).hexdigest()


def resolve(document, pointer):
    try:
        value = document
        for part in pointer.split("/")[1:]:
            part = part.replace("~1", "/").replace("~0", "~")
            value = value[int(part)] if isinstance(value, list) else value[part]
        return value
    except (KeyError, IndexError, TypeError, ValueError) as error:
        raise InputError("Reference fact pointer does not resolve") from error


def _text(value, label):
    if not isinstance(value, str) or not value.strip():
        raise InputError(f"{label}: required source text is missing")
    return value


def _source_assets(reference):
    pages = reference.get("native", {}).get("pages", [])
    selected = [(index, page) for index, page in enumerate(pages) if page.get("id") in READING_PAGES]
    if tuple(page["id"] for _, page in selected) != READING_PAGES:
        raise InputError("The four reference reading pages must each occur once in learner order")
    assets, facts = [], []
    for page_index, page in selected:
        nodes = [(index, node) for index, node in enumerate(page.get("nodes", [])) if node.get("type") == "reading"]
        if len(nodes) != 1:
            raise InputError(f"{page['id']}: one reading source asset is required")
        node_index, node = nodes[0]
        blocks = node.get("blocks")
        if not isinstance(blocks, list) or not blocks:
            raise InputError(f"{page['id']}: reading blocks are missing")
        asset = {"id": page["id"], "media_kind": "text", "source_pointer": f"/native/pages/{page_index}/nodes/{node_index}", "blocks": []}
        for block_index, block in enumerate(blocks):
            base = f"/native/pages/{page_index}/nodes/{node_index}/blocks/{block_index}"
            kind = block.get("kind")
            cleaned = {"kind": kind}
            spans = []
            if kind in {"para", "heading"}:
                cleaned["text"] = _text(block.get("text"), base)
                if kind == "para":
                    spans.append((base + "/text", cleaned["text"], "authored-exposition", None))
            elif kind == "title":
                cleaned["title"] = _text(block.get("title"), base)
                if "by" in block:
                    cleaned["by"] = _text(block["by"], base)
            elif kind == "archivist":
                lines = block.get("lines")
                if not isinstance(lines, list) or not lines:
                    raise InputError(f"{base}: authored reading explanation is missing")
                cleaned["lines"] = []
                for index, line in enumerate(lines):
                    line = _text(line, base)
                    cleaned["lines"].append(line)
                    spans.append((f"{base}/lines/{index}", line, "authored-exposition", None))
            elif kind == "script":
                lines = block.get("lines")
                if not isinstance(lines, list) or not lines:
                    raise InputError(f"{base}: dramatic source lines are missing")
                cleaned["lines"], speaker = [], None
                for index, line in enumerate(lines):
                    if "stage" in line:
                        text = _text(line["stage"], base)
                        cleaned["lines"].append({"stage": text})
                        spans.append((f"{base}/lines/{index}/stage", text, "authored-stage-direction", None))
                    else:
                        text = _text(line.get("line"), base)
                        if line.get("who") is not None:
                            speaker = _text(line["who"], base)
                        if speaker is None:
                            raise InputError(f"{base}: dramatic line has no identified speaker")
                        cleaned["lines"].append({"who": speaker, "line": text})
                        spans.append((f"{base}/lines/{index}/line", text, "dramatic-dialogue", speaker))
            else:
                raise InputError(f"{base}: unsupported reading block kind; no text fallback")
            asset["blocks"].append(cleaned)
            for pointer, text, origin, speaker in spans:
                if resolve(reference, pointer) != text:
                    raise InputError("A factual anchor differs from its exact reference source")
                fact = {
                    "id": f"fact-{len(facts) + 1:03}", "source_asset_ref": page["id"],
                    "source_pointer": pointer, "text": text, "origin": origin,
                    "text_sha256": hashlib.sha256(text.encode()).hexdigest(),
                    "authority": "Exact public authored-reference span; not independently verified historical fact or an approved interpretation.",
                }
                if speaker is not None:
                    fact["speaker"] = speaker
                facts.append(fact)
        if not any(fact["source_asset_ref"] == page["id"] for fact in facts):
            raise InputError(f"{page['id']}: no factual source anchors")
        asset["sha256"] = value_digest(asset["blocks"])
        assets.append(asset)
    return assets, facts


def check_preparation(writer, reference):
    """Check source identity, order and available exposure; not question quality."""
    course = writer["lesson_context"]["native"]["course_context"]
    assets = {asset["id"]: asset for asset in course["source_assets"]}
    if tuple(assets) != READING_PAGES or len(course["source_assets"]) != len(READING_PAGES):
        raise InputError("Reading source identifiers/order are missing, changed or duplicated")
    expected_assets, expected_facts = _source_assets(reference)
    if course["source_assets"] != expected_assets:
        raise InputError("Prepared source bodies, hashes or metadata differ from the whitelisted reference")
    facts = writer["facts"]["facts"]
    by_id = {fact["id"]: fact for fact in facts}
    if not facts or len(by_id) != len(facts):
        raise InputError("Factual source anchor identifiers are missing or duplicated")
    for fact in facts:
        if fact["source_asset_ref"] not in assets:
            raise InputError("Factual anchor has an unknown source asset")
        if not fact["source_pointer"].startswith(assets[fact["source_asset_ref"]]["source_pointer"] + "/blocks/"):
            raise InputError("Factual anchor points into a different reading source")
        if resolve(reference, fact["source_pointer"]) != fact["text"]:
            raise InputError("Factual anchor is not the exact reference text")
        if hashlib.sha256(fact["text"].encode()).hexdigest() != fact["text_sha256"]:
            raise InputError("Factual anchor text hash changed")
    if facts != expected_facts:
        raise InputError("Factual anchor origin, speaker, text or order differs from the reference")
    plan = writer["sequence_blueprint"]
    expected_pages = (*READING_PAGES, "classification")
    if tuple(step.get("page") for step in plan) != expected_pages:
        raise InputError("The five preparation slots must remain in learner order")
    for index, step in enumerate(plan):
        expected_sources = list(READING_PAGES[:min(index + 1, 4)])
        expected_prior = list(READING_PAGES[:min(index, 4)])
        expected_facts = [fact["id"] for fact in facts if fact["source_asset_ref"] in expected_sources]
        if type(step.get("order")) is not int or step["order"] != index + 1 or step.get("source_refs") != expected_sources or step.get("prior_source_refs") != expected_prior:
            raise InputError("A preparation slot changes its order or exposes future/unknown sources")
        if step.get("fact_refs") != expected_facts or any(ref not in by_id for ref in step.get("fact_refs", [])):
            raise InputError("A preparation slot has missing, unknown or future factual anchors")
        if step.get("native_format") != ("single_choice" if index < 4 else "classification"):
            raise InputError("Unsupported operation in the bounded five-item preparation")
        if step.get("target") != TARGETS[index] or step.get("support") != SUPPORT or step.get("writing_status") != "pending":
            raise InputError("Preparation target, supported exposure or pending writing status changed")
    context = writer["lesson_context"]
    expected_native_pages = [{"id": step["page"], "source_refs": step["source_refs"], "questions": [], "writing_status": "pending"} for step in plan]
    expected_exposure = [{"slot_ref": step["id"], "prior_source_refs": step["prior_source_refs"], "visible_source_refs": step["source_refs"], "support": step["support"]} for step in plan]
    if context["native"]["pages"] != expected_native_pages or course["exposure_history"] != expected_exposure:
        raise InputError("Context pages/exposure differ from the pending zero-question sequence")
    if course["teaching_procedure"] != reference["native"]["procedure"]:
        raise InputError("The teaching procedure differs from the reference")
    if context["source"] != writer["source"] or writer["facts"]["source"] != writer["source"]:
        raise InputError("Preparation artifacts have different provenance")
    if writer["classification_categories"] != [{"id": identifier, "label": label} for identifier, label in CATEGORIES]:
        raise InputError("The bounded classification categories changed")
    if writer["status"] != "writer-request-prepared" or writer["execution"] != "offline-preparation" or writer["progress"] != PENDING:
        raise InputError("Preparation must keep actual writing, evaluation and qualification pending")
    if context["progress"] != PENDING or context["preparation_status"] != "writer-request-prepared" or writer["attempt_policy"]["actual_attempts"] != 0:
        raise InputError("Preparation context cannot contain an actual writer attempt or qualification")
    return len(plan)


def prepare_reference(reference, formats, methods, provenance):
    if reference.get("contract") != "lesson-context 0.1":
        raise InputError("Preparation requires the public lesson-context 0.1 reference")
    if not {"single_choice", "classification"} <= _catalog_ids(formats):
        raise InputError("The public format catalog is missing the bounded preparation operations")
    cards = methods.get("cards", [])
    if [card.get("id") for card in cards] != [f"G{index:02}" for index in range(1, 9)]:
        raise InputError("Preparation requires the eight pinned public method cards")
    for field in ("knowledge_baseline_sha256", "reference_context_sha256", "reference_source"):
        if not provenance.get(field):
            raise InputError(f"Preparation provenance is missing {field}")
    lesson = reference.get("lesson", {})
    _text(lesson.get("id"), "lesson identifier")
    _text(lesson.get("learning_question"), "lesson direction")
    assets, facts = _source_assets(reference)
    procedure = reference["native"].get("procedure")
    if not isinstance(procedure, list) or not procedure or not all(isinstance(row, str) and row for row in procedure):
        raise InputError("The public reference teaching procedure is missing")
    plan = []
    for index, page in enumerate((*READING_PAGES, "classification")):
        source_refs = list(READING_PAGES[:min(index + 1, 4)])
        plan.append({
            "id": f"reference-proof-{index + 1:02}", "order": index + 1, "page": page,
            "native_format": "single_choice" if index < 4 else "classification",
            "contract_kind": "reading_mcq" if index < 4 else "classify",
            "target": TARGETS[index], "target_authority": "bounded prototype target derived from the public reference; not a new adopted curriculum ruling",
            "source_refs": source_refs, "prior_source_refs": list(READING_PAGES[:min(index, 4)]),
            "fact_refs": [fact["id"] for fact in facts if fact["source_asset_ref"] in source_refs],
            "support": SUPPORT,
            "writing_status": "pending",
        })
    course = {
        "source_assets": assets, "teaching_procedure": list(procedure),
        "procedure_source_pointer": "/native/procedure",
        "sequence_scope": "Four reading checks followed by classification; not the full reference lesson or forty independent mastery checks.",
        "learner_context": {
            "prerequisite_attainment": "unknown", "individual_challenge_fit": "not-established",
            "interpretation": "Author-described supported reading practice; no learner outcome has been measured.",
        },
        "exposure_history": [{"slot_ref": step["id"], "prior_source_refs": step["prior_source_refs"], "visible_source_refs": step["source_refs"], "support": step["support"]} for step in plan],
    }
    context = {
        "contract": "lesson-context 0.1", "source": copy.deepcopy(provenance),
        "lesson": {key: copy.deepcopy(lesson[key]) for key in ("id", "title", "subtitle", "learning_question") if key in lesson},
        "native": {"course_context": course, "pages": [{"id": step["page"], "source_refs": step["source_refs"], "questions": [], "writing_status": "pending"} for step in plan]},
        "preparation_status": "writer-request-prepared", "progress": dict(PENDING),
    }
    context["lesson"]["keywords"] = [
        {**{key: copy.deepcopy(row[key]) for key in ("word", "meaning", "link", "cls") if key in row}, "source_pointer": f"/lesson/keywords/{index}", "origin": "authored-lesson-definition"}
        for index, row in enumerate(lesson.get("keywords", []))
    ]
    fact_packet = {
        "version": "reference-facts/0.1", "source": copy.deepcopy(provenance), "facts": facts,
        "meaning": "Exact source spans with field-level origin; the writer must distinguish speaker statements, authored glosses and stage directions. Substring integrity does not establish entailment or question quality.",
    }
    method_fields = ("id", "title", "claim", "unit", "applies_when", "actions", "checks", "refusal_or_fallback", "limits", "canonical_record")
    format_fields = ("id", "cognitive_operation", "required_payload", "teacher_key", "conditions", "quality_risks", "status")
    catalog = formats.get("formats", [])
    if not isinstance(catalog, list):
        raise InputError("Preparation requires explicit list-based public format descriptors")
    writer = {
        "version": "reference-writer-request/0.1", "intake_version": VERSION,
        "status": "writer-request-prepared", "execution": "offline-preparation", "progress": dict(PENDING),
        "source": copy.deepcopy(provenance), "lesson_context": context, "facts": fact_packet,
        "sequence_blueprint": plan,
        "generation_methods": [{key: copy.deepcopy(card[key]) for key in method_fields if key in card} for card in cards],
        "format_descriptors": [{key: copy.deepcopy(row[key]) for key in format_fields if key in row} for row in catalog if row["id"] in {"single_choice", "classification"}],
        "classification_categories": [{"id": identifier, "label": label} for identifier, label in CATEGORIES],
        "response_contract": {
            "version": "reference-writer-response/0.1", "items_required": 5,
            "item_fields": ["id", "page", "order", "native_format", "stem", "fact_refs", "source_bindings", "task_payload", "scoring", "feedback"],
            "source_bindings": "Every material claim, key and option rationale must cite allowed fact IDs and exact source spans. Deliberately incorrect choices are labelled alternatives, not asserted source facts.",
            "single_choice": "Four uniquely identified options, one resolving key and source-grounded rationale for each option; no speculative learner diagnosis.",
            "classification": "Source-grounded entries and the declared category IDs, each entry with one resolving mapping; do not require a fixed number per category.",
            "hold": "If a required source, operation or justified key is unavailable, return a typed hold with no delivered items. Retain the unmodified first response for separate review.",
        },
        "attempt_policy": {"planned_writer_attempts": 1, "retries": 0, "repairs": 0, "reranking": False, "model_judge": False, "actual_attempts": 0, "model_selection": "pending"},
        "boundary": "Public teaching inputs only. No private evaluator material or feedback is an input; no writer or evaluator is called by preparation.",
    }
    check_preparation(writer, reference)
    return writer, context, fact_packet
