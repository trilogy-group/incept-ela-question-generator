#!/usr/bin/env python3
"""Project original public authoring context into a question-free writer packet.

Reads two explicitly supplied files; no Git history, evaluator or model access.
The original pin remains provenance of the source, not of the projected bytes.
"""
import argparse
import hashlib
import json
from pathlib import Path

PIN = "f1565047f1ab75f2cead15699546bc8723ac4e39"
SHA = "50b6d44f206b3d4a6e27030b5cc6fd170c9d7c1b616f4d0ecd241839407b5d96"


def flatten(value):
    if isinstance(value, str):
        return value
    if isinstance(value, list):
        return "\n".join(flatten(x) for x in value)
    if isinstance(value, dict):
        # Reading blocks only. Do not traverse authored questions or rubrics.
        return "\n".join(flatten(value[k]) for k in ("title", "by", "text", "who", "line", "lines") if k in value)
    return ""


def prepare(source_bytes, receipt, counterpart):
    if hashlib.sha256(source_bytes).hexdigest() != SHA or receipt["source"]["commit"] != PIN or receipt["source"]["sha256"] != SHA:
        raise ValueError("Explicit current reference differs from the frozen authored source pin")
    original = json.loads(source_bytes)
    provenance = {"repository": receipt["repository"], "commit": PIN, "path": receipt["source"]["path"], "sha256": SHA, "version_role": "frozen-current-hosted-source", "comparison": "Original supplied source bytes checked; no external Git comparison or media execution ran."}
    sources, phases, slots, pages, keys = [], [], [], [], []
    source_ids = []

    def asset(identifier, text, pointer, kind="text", **extra):
        if not text.strip():
            raise ValueError(f"{pointer}: source context is empty")
        sources.append({"id": identifier, "kind": kind, "text": text, "original_pointer": pointer, "provenance": provenance, **extra})
        source_ids.append(identifier)
        keys.append({"id": "C-" + identifier, "claim": text.splitlines()[0], "source_refs": [identifier]})
        return identifier

    def activity(kind, role, pointer, context_pointer, family, public_format, objective, operation, native_context=None, visible=None, depends=None):
        identifier = f"N{len(slots) + 1:02d}"
        phase = "F-" + identifier
        refs = list(visible or source_ids)
        if not refs:
            raise ValueError(f"{pointer}: no visible source")
        target = "K-media" if kind == "film_mcq" else "K-language" if kind in {"word_web", "key_term_mcq", "quote_word_selection", "rebuild_choice", "say_back"} else "K-evidence"
        phases.append({"id": phase, "role": role, "target_refs": [target], "source_refs": refs, "exposure_order": len(slots) + 1, "support": "Declared preceding teaching and visible source only; no learner performance history is supplied."})
        slot = {"id": identifier, "native_kind": kind, "family": family, "public_format": public_format, "role": role, "operation": operation, "objective": objective, "page_ref": pages[-1]["id"], "phase_ref": phase, "target_refs": [target], "content_key_refs": ["C-" + ref for ref in refs], "pair_refs": ["P-evidence-language"] if target != "K-media" else [], "support": phases[-1]["support"], "source_pointer": pointer, "context_pointer": context_pointer, "native_context": native_context or {}, "depends_on": depends or []}
        slots.append(slot)
        pages[-1]["question_slots"].append({"id": identifier})
        return identifier

    last_reading = []
    for p, page in enumerate(original["pages"]):
        pages.append({"id": page["id"], "nodes": [], "question_slots": []})
        for n, node in enumerate(page["nodes"]):
            pointer = f"/pages/{p}/nodes/{n}"
            kind = node["type"]
            if kind == "intro_film":
                ref = asset("intro-caption", "\n".join(x["line"] for x in node["captions"]), pointer + "/captions", "media-transcript", media_ref=node["src"], time_range=[node["captions"][0]["from"], node["captions"][-1]["to"]])
                pages[-1]["nodes"].append({"type": "media", "source_ref": ref, "original_pointer": pointer, "media_ref": node["src"]})
            elif kind == "unit_film":
                for j, segment in enumerate(node["segments"]):
                    ref = asset(f"unit-caption-{j}", "\n".join(x["line"] for x in node["captions"] if x["from"] < segment["to"]), pointer + "/captions", "media-transcript", media_ref=node["src"], time_range=[0, segment["to"]], author_segment_pointer=pointer + f"/segments/{j}")
                    pages[-1]["nodes"].append({"type": "media-segment", "source_ref": ref, "original_pointer": pointer + f"/segments/{j}", "media_ref": node["src"], "time_range": [segment["from"], segment["to"]]})
                    for q in range(len(segment.get("mcq", []))):
                        activity("film_mcq", "question", pointer + f"/segments/{j}/mcq/{q}", pointer + f"/segments/{j}", "single_choice", "single_choice", "Check a distinct unit-context fact or relationship present in the supplied captions up to this pause.", "recognition", {"pause": segment["to"]}, [ref])
            elif kind == "word_web":
                ref = asset("word-web-context", "\n".join(str(node[k]) for k in ("idea", "centre", "hint") if k in node), pointer)
                pages[-1]["nodes"].append({"type": "retrieval-context", "source_ref": ref})
                activity("word_web", "guided_task", pointer, pointer, "word_web", "adapter_extension/word_web", "Elicit linked vocabulary for the declared central concept, then explain a word's meaning and a semantic relation.", "semantic-association", {"centre": node["centre"], "history_status": "Author says prior encounters; no individual exposure record supplied.", "stages": ["initial-vocabulary-elicitation", "authored-bank-expansion", "word-meaning-turn"], "authored_bank_available_after_seconds": node["add_after_s"], "bank_status": "Original answer bank omitted; writer must author a source-supported teaching bank if needed."}, [ref])
            elif kind == "key_term":
                ref = asset("term-context", f"{node['term']}: {node['meaning']}", pointer + "/meaning")
                pages[-1]["nodes"].append({"type": "definition", "source_ref": ref, "exposure_status": "Authored definition available as declared guided support; no independent recall claim."})
                activity("key_term_mcq", "question", pointer, pointer, "single_choice", "single_choice", "Check a source-grounded application of the taught key term.", "recognition", {"term": node["term"]}, [ref])
            elif kind == "reading":
                ref = asset(page["id"], flatten(node["blocks"]), pointer + "/blocks")
                last_reading.append(ref)
                pages[-1]["nodes"].append({"type": "reading", "source_ref": ref, "part": node["part"]})
                for q in range(len(node["mcqs"])):
                    activity("reading_mcq", "question", pointer + f"/mcqs/{q}", pointer, "single_choice", "single_choice", "Check a distinct source-grounded relationship in this reading section, distinguishing speech claims from established events.", "recognition", visible=last_reading)
                activity("open_check", "question", pointer + "/rubric", pointer, "written_response", "short_explanation", "Explain a relationship established in this reading section with relevant evidence and its warrant.", "explanation", visible=last_reading)
            elif kind == "dose":
                before = list(source_ids)
                evidence = activity("evidence_select", "guided_task", pointer, pointer, "evidence_selection", "evidence_selection", "Select source quotations relevant to a declared claim about professed service and personal motive.", "evidence-selection", {"scene_refs": last_reading}, before)
                activity("open_prompt", "question", pointer, pointer, "written_response", "short_explanation", "Explain how selected source evidence relates to the declared interpretation.", "explanation", visible=before, depends=[evidence])
                counterclaim = counterpart["claim"]
                # Explicit input supplies context absent from the original runtime dialogue.
                counter = asset("counterpart", counterclaim, pointer + "/excuse_label", "authored-counterpart", authored_for_packet=True, source_status="Supplied hypothetical claim, not dramatic text or historical event.")
                sources[-1]["provenance"] = {"kind": "packet-authoring", "input": "native-counterpart.json", "original_reference_relation": "Original dose names an excuse but supplies no frozen counterpart speech."}
                sources[-1]["original_pointer"] = "/claim"
                activity("open_prompt", "question", pointer, pointer, "written_response", "rebuttal", "Assess the frozen counterpart claim against the source, accepting justified rejection, support or qualification.", "rebut", {"counterclaim": counterclaim, "counterclaim_source_ref": counter}, source_ids)
                activity("open_check", "question", pointer + "/verdict", pointer, "written_response", "integrated_response", "Combine a supported claim, quotation and reasoning about apparent loyalty and declared motive.", "integrated", visible=source_ids)
                previous = []
                for q, (operation, fmt, objective) in enumerate([("ask", "learner_question", "Form an answerable question exposing the relationship between professed service and personal purpose."), ("explain", "short_explanation", "Explain the relevance of one visible source quotation to the declared relationship."), ("rebut", "rebuttal", "Evaluate the supplied counterpart claim using source evidence.")]):
                    ctx = {"composite_parent": pointer, "round": q + 1, "native_tasks_are_composite": True}
                    ctx["response_parts"] = {"ask": ["learner_question"], "explain": ["selected_quotation", "warrant"], "rebut": ["verdict", "source_evidence", "reason"]}[operation]
                    if operation == "rebut": ctx.update({"counterclaim": counterclaim, "counterclaim_source_ref": counter})
                    dependencies = previous[-1:] + ([evidence] if operation == "explain" else [])
                    identifier = activity("argument_round", "subcheck", pointer + f"/tasks/{q}", pointer, "written_response", fmt, objective, operation, ctx, source_ids, dependencies); previous.append(identifier)
            elif kind == "model":
                # Worked teaching is retained; rebuild original choices/keys are omitted.
                worked = "\n".join("\n".join([*screen["quote"], screen["context"], screen["means"], *[word["line"] for word in screen["words"]]]) for screen in node["screens"])
                ref = asset("worked-teaching", worked, pointer + "/screens", "worked-teaching")
                pages[-1]["nodes"].append({"type": "worked-teaching", "source_ref": ref, "before_response": True})
                surrounding = "".join(row.get("text", "[blank]") for row in node["rebuild"])
                for q, row in enumerate(node["rebuild"]):
                    if "options" in row:
                        activity("rebuild_choice", "recall_task", pointer + f"/rebuild/{q}", pointer + "/rebuild", "inline_choice", "adapter_extension/inline_choice", "Rebuild one semantic or grammatical component of the previously shown worked sentence.", "assembly", {"surrounding_text": surrounding, "blank_source_index": q, "composite_parent": pointer + "/rebuild"}, [ref])
            elif kind == "independent":
                activity("open_check", "question", pointer + "/rubric", pointer, "written_response", "integrated_response", "Produce a supported paragraph relating apparent loyalty to motive and character; prior worked teaching is declared.", "integrated", visible=source_ids)
                for q, row in enumerate(node["moves"]["rubrics"]):
                    if row is not None:
                        activity("open_check", "subcheck", pointer + f"/moves/rubrics/{q}", pointer + "/moves", "written_response", "short_explanation", "Check one declared component of the developing paragraph in its parent paragraph context.", "paragraph-component", {"composite_parent": pointer, "component_index": q}, source_ids)
                for label, breakdown in node["breakdown"].items():
                    original_quote = next(row["quote"] for row in node["quotes"] if row["label"] == label)
                    quote = original_quote
                    ref = asset("selected-quote-" + label, quote, pointer + "/quotes", "selected-quote")
                    selected = activity("quote_word_selection", "guided_task", pointer + f"/breakdown/{label}/words", pointer + f"/breakdown/{label}", "word_selection", "adapter_extension/word_selection", "Select a significant word and its class from the supplied quotation for subsequent language analysis.", "word-selection", {"quote": quote, "quote_markup": "Exact authored string retained, including quote marks and slash line-break markup.", "allowed_words": list(breakdown["words"]), "composite_parent": pointer, "branch": label, "branch_group": "selected-paragraph-quote", "branch_policy": "Retained alternative; follow only the learner-selected quote branch.", "selection_operation": "word-and-class", "word_class_options": ["noun", "verb", "adverb", "adjective", "pronoun", "other"]}, source_ids)
                    prior = selected
                    for scope in ("means", "shows"):
                        prior = activity("quote_analysis", "subcheck", pointer + f"/breakdown/{label}/{scope}", pointer + f"/breakdown/{label}", "written_response", "short_explanation", "Paraphrase the exact quotation in context." if scope == "means" else "Explain what the quotation supports about character, distinguishing interpretation from paraphrase.", "paraphrase" if scope == "means" else "interpretation", {"quote": quote, "composite_parent": pointer, "selected_word_slot": selected, "branch": label, "branch_group": "selected-paragraph-quote", "branch_policy": "Retained alternative; follow only the learner-selected quote branch."}, source_ids, [prior])
            elif kind == "mimicry":
                ref = asset("recall-statement", node["repeat"], pointer + "/repeat", "taught-recall-statement")
                pages[-1]["nodes"].append({"type": "recall-model", "source_ref": ref})
                activity("say_back", "recall_task", pointer, pointer, "say_back", "adapter_extension/say_back", "Repeat the supplied taught statement; record recall only, without an independent reasoning claim.", "repetition", {"recall_source_ref": ref}, [ref])
            elif kind == "apply":
                for q in range(len(node["rubrics"])):
                    activity("open_check", "question", pointer + f"/rubrics/{q}", pointer, "written_response", "short_explanation", "Apply a taught term to the same supplied scene and explain its evidential basis.", "application", visible=source_ids)
            elif kind == "evaluate":
                activity("open_check", "question", pointer + "/rubric", pointer, "written_response", "integrated_response", "Assess a source-grounded claim using relevant evidence and reasoning; no changed-text transfer claim.", "integrated", visible=source_ids)
            elif kind == "pin_words":
                categories = [{"entity": entity, "relation": relation} for entity, boxes in node["boxes"].items() for relation in ("is", "seems", "wanted") if relation in boxes]
                activity("classify", "guided_task", pointer, pointer, "classification", "classification", "Classify source-grounded descriptions by both character and semantic relation, without fixed category quotas.", "classification", {"category_dimensions": categories}, source_ids)
                activity("open_check", "question", pointer + "/verdict", pointer, "written_response", "integrated_response", "Explain the relation between a classified appearance and reality using source evidence.", "integrated", visible=source_ids)
            elif kind == "record":
                activity("open_check", "question", pointer + "/rubric", pointer, "written_response", "integrated_response", "Synthesize the lesson's declared knowledge with a claim, evidence and reason.", "integrated", visible=source_ids)
    # This original row sits outside the page array and remains an unscored report.
    activity("confidence_self_report", "self_report", "/record/confidence", "/record", "self_report", "adapter_extension/self_report", "Report confidence about answering the lesson question; confidence is not correctness evidence.", "self-report", {"scale": original["record"]["scale"]}, source_ids)
    expected = receipt["current_counts"]["by_kind"]
    actual = {kind: sum(row["native_kind"] == kind for row in slots) for kind in expected}
    if actual != expected or len(slots) != 50 or len(pages) != 19:
        raise ValueError(f"Native activity inventory differs: {actual}")
    goals = [
        {"id": "K-media", "claim": "The supplied unit introduction sets out the play's context and unit purpose.", "performance": "Recognize a caption-supported fact or relationship at the declared pause.", "source_refs": [row["id"] for row in sources if row["id"].startswith("unit-caption-")]},
        {"id": "K-language", "claim": "Taught words, word relations and quotations support precise discussion of the lesson.", "performance": "Recall, classify or explain language as required by the declared native operation.", "source_refs": [row["id"] for row in sources if row["id"] in {"word-web-context", "term-context", "worked-teaching", "recall-statement"}]},
        {"id": "K-evidence", "claim": "Source-supported claims require relevant evidence and an explanation of its relation to the claim.", "performance": "Explain or qualify a character interpretation using the supplied dramatic context.", "source_refs": last_reading},
    ]
    course = {"lesson_id": original["lessonId"], "learning_question": original["question"], "core_knowledge": goals, "source_assets": sources, "prerequisites": [{"id": "prior-literature", "status": "author-declared-only", "description": "Author references prior literary study; no individual mastery record supplied."}], "learner_constraints": {"status": "partially-specified", "grade": 9, "language": "English", "accessibility_needs": "unknown", "individual_reading_level": "unknown", "response_support": "Declared per slot; no additional learner history inferred."}, "prior_exposure": {"status": "authored-plan-not-individual-record", "events": [{"source_ref": row["id"], "original_pointer": row["original_pointer"], "availability": "Only when listed by the current phase; worked teaching, captions and support are not evidence of mastery."} for row in sources], "conditional_feedback_history": "not supplied", "individual_submitted_responses": "not supplied"}, "content_keys": keys, "knowledge_map": [{"knowledge_ref": goal["id"], "content_key_ref": "C-" + ref} for goal in goals for ref in goal["source_refs"]], "pairing_map": [{"id": "P-evidence-language", "knowledge_refs": ["K-language", "K-evidence"], "relation": "Use precise source language to support and explain a claim."}], "lesson_plan": {"id": original["lessonId"], "phases": phases}}
    delivery = {"inventory_order": "Original authoring extraction order, not a claim that all rows are completed sequentially.", "branch_groups": [{"id": "selected-paragraph-quote", "policy": "choose-one", "branches": ["A", "B"], "source_offers_additional_quote_C": "Quote C has no authored breakdown in this source pin; no missing subchecks invented."}], "runtime_followups": "Not captured and not generated by this packet.", "media_timing_status": "Original timing preserved. Runtime label and captions differ; unit segment 4/5 numeric timing differs from array order. No playback-equivalence claim."}
    course["delivery_context"] = delivery
    request = {"protocol": "question-lane-native/0.2", "request_id": "current-reference-all-native-formats", "course_context": course, "sequence_blueprint": slots, "source_provenance": provenance, "intake_limits": ["No original question, key, feedback or rubric copied into this writer packet.", "Objectives are explicit proposed generation intentions, not recovered author answers.", "Original authored activities include guided tasks and dependent subchecks; 50 is not a mastery-measurement count.", "Media captions are supplied authoring data; video playback and audiovisual equivalence were not verified.", "Hypothetical counterpart claim is supplied packet authoring, not a source quotation.", "Question quality and learner outcomes await later independent evaluation."]}
    context = {"contract": "lesson-context 0.1", "source": provenance, "lesson": {"id": original["lessonId"], "title": original["title"], "learning_question": original["question"], "keywords": original["keywords"]}, "native": {"course_context": course, "pages": pages}, "adapter_extension": "native-activity-transport/0.2", "preparation_status": "neutral-writer-context"}
    return request, context


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", required=True)
    parser.add_argument("--receipt", required=True)
    parser.add_argument("--output-dir", required=True)
    parser.add_argument("--counterpart", required=True, help="Explicit packet-authored frozen counterpart, absent from original runtime dialogue")
    args = parser.parse_args()
    source = Path(args.source).read_bytes()
    request, context = prepare(source, json.loads(Path(args.receipt).read_text()), json.loads(Path(args.counterpart).read_text()))
    directory = Path(args.output_dir)
    directory.mkdir(parents=True, exist_ok=True)
    for name, packet in [("current-native-request.json", request), ("current-native-context.json", context)]:
        (directory / name).write_text(json.dumps(packet, ensure_ascii=False, indent=2) + "\n")
    if Path(args.source).read_bytes() != source:
        raise ValueError("Original authored source changed during preparation")
    print(json.dumps({"status": "writer-request-prepared", "native_activities": len(request["sequence_blueprint"]), "native_kinds": len({x["native_kind"] for x in request["sequence_blueprint"]}), "model_calls": 0, "output": str(directory)}))


if __name__ == "__main__":
    main()
