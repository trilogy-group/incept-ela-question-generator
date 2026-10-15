// Every absent source example stays explicitly synthetic, outside the golden authoring reference.
import { FORMAT_DISPATCH, NATIVE_PROTOCOL, adaptNativeResponse, nativeLearnerPacket, validateNativeInputs, validateNativeResponse } from './native_formats.mjs';
import { mockNativeResponse } from './native_smoke.mjs';
import { StructuralError, validate } from './model_contract.mjs';
import { createHash } from 'node:crypto';
import { proposeInstructionalPlan } from './instructional_plan.mjs';
const packetHash = value => createHash('sha256').update(`${JSON.stringify(value, null, 2)}\n`).digest('hex');

function currentKindCase(kind, request, context) {
  const ids = new Set(request.sequence_blueprint.filter(row => row.native_kind === kind).map(row => row.id));
  if (!ids.size) return null;
  let expanded;
  do {
    expanded = false;
    request.sequence_blueprint.filter(row => ids.has(row.id)).forEach(row => row.depends_on.forEach(ref => { if (!ids.has(ref)) { ids.add(ref); expanded = true; } }));
  } while (expanded);
  const selected = structuredClone(request); selected.request_id = `captured-kind-${kind}`;
  selected.sequence_blueprint = selected.sequence_blueprint.filter(row => ids.has(row.id));
  const c = structuredClone(context); c.native.pages.forEach(page => { page.question_slots = page.question_slots.filter(row => ids.has(row.id)); });
  selected.course_context.instructional_plan = proposeInstructionalPlan(selected, c, { authorityKind: 'source-projected', note: 'Explicit subset of source-projected practice inventory; not authoritative curriculum goals.' });
  c.native.course_context = structuredClone(selected.course_context);
  return { kind, request: selected, context: c, context_origin: 'retained-current-authoring-context', captured_occurrences: selected.sequence_blueprint.filter(row => row.native_kind === kind).length, dependency_items: selected.sequence_blueprint.filter(row => row.native_kind !== kind).length, native_source_shape: 'Source pointers and native subcheck context retained; output is the explicit adapter extension.' };
}

function syntheticKindCase(kind) {
  const d = FORMAT_DISPATCH[kind];
  const family = d.family === 'composite' ? 'single_choice' : d.family;
  const publicFormat = d.family === 'composite' ? 'single_choice' : d.public_format;
  const source = 'Mira lends Jon a book.\nJon returns the book on Tuesday.\nMira thanks Jon for returning it.\nThe verb lends describes giving something for a time.\nA claim to discuss: returning an object always proves care.\nSupplied fictional counterpart turn: Mira asks why the book was returned.';
  const provenance = { kind: 'synthetic-offline-fixture', source_status: 'Explicitly authored fiction for transport; not a captured teaching example or independent quality label.' };
  const nativeContext = {
    category_dimensions: [{ entity: 'Mira', relation: 'action' }, { entity: 'Jon', relation: 'action' }], match_relation: 'Match the named character to the explicitly supplied action.', ordering_rule: 'Order only the supplied events by their stated sequence.', tie_policy: 'No equal event positions are declared; alternative orders need a changed source context.', selection_rule: 'Select all supported choices; more than one choice may be correct.', shared_bank_policy: 'single-use', centre: 'returning a borrowed book', quote: 'Mira lends Jon a book.', allowed_words: ['Mira', 'lends', 'Jon', 'book'], word_class_options: ['noun', 'verb'], surrounding_text: 'Mira [blank] Jon a book.', scale: ['Not yet', 'Sure'], recall_source_ref: 'S1', response_mode: 'spoken', counterpart_turn: 'Mira asks why the book was returned.', counterpart_source_ref: 'S1', counterclaim: 'Returning an object always proves care.', native_shape_status: 'Synthetic family contract only; the original native source schema is not asserted.', course_owned_operation: 'Synthetic source-supported recognition/classification operation; original source-native semantics are unverified.', exposure_placement: 'declared-before-response',
  };
  if (family === 'shared_cloze') { nativeContext.surrounding_text = '[blank-1] lends [blank-2] a book.'; nativeContext.blank_ids = ['blank-1', 'blank-2']; }
  const slots = (d.family === 'composite' ? ['claim', 'evidence'] : ['task']).map((part, i) => ({ id: `SLOT-${i + 1}`, native_kind: kind, family, public_format: publicFormat, role: d.family === 'nonresponse' ? 'instruction' : d.family === 'composite' ? 'subcheck' : family === 'self_report' ? 'self_report' : 'synthetic-transport-task', operation: d.family === 'composite' ? part : 'declared-synthetic-family-operation', objective: 'Exercise the declared source-bound response family on supplied fictional context; no educational quality claim.', page_ref: 'P1', phase_ref: 'F1', target_refs: ['K1'], content_key_refs: ['C1'], pair_refs: ['PAIR1'], support: 'Visible fictional text and explicitly declared support; no learner mastery history.', source_pointer: `/synthetic/${kind}/${part}`, context_pointer: `/synthetic/${kind}`, native_context: { ...structuredClone(nativeContext), ...(d.family === 'composite' ? { part, composite_parent: `/synthetic/${kind}` } : {}) }, depends_on: i ? ['SLOT-1'] : [] }));
  const course = { core_knowledge: [{ id: 'K1', claim: 'The supplied text distinguishes character actions and their order.', performance: 'Perform the explicitly declared family operation using only the supplied text.', source_refs: ['S1'] }], source_assets: [{ id: 'S1', text: source, original_pointer: '/synthetic/source', provenance, ...(kind.includes('film') || kind === 'video_mcq' ? { kind: 'media-transcript', media_ref: 'synthetic://offline-film', time_range: [0, 10], media_status: 'Fictional fixture reference; no media file or playback claimed.' } : { kind: 'text' }) }, { id: 'FUTURE', text: 'This future source has not been exposed to the learner.', original_pointer: '/synthetic/future', provenance }], prerequisites: [{ id: 'READ', status: 'unknown', description: 'No prior individual mastery is asserted.' }], learner_constraints: { status: 'synthetic-declared', language: 'English', response_modes: ['written', 'spoken', 'selection', 'recall', 'self_report', 'instruction'], reading_level: 'unknown', accessibility_needs: 'unknown' }, prior_exposure: { status: 'explicit-synthetic-plan', events: [{ source_ref: 'S1', availability: 'Visible for this task.' }], individual_submitted_responses: 'not supplied', conditional_feedback_history: 'not supplied' }, content_keys: [{ id: 'C1', claim: 'Actions are explicit in the supplied fictional source.', source_refs: ['S1'] }], knowledge_map: [{ knowledge_ref: 'K1', content_key_ref: 'C1' }], pairing_map: [{ id: 'PAIR1', knowledge_refs: ['K1'], relation: 'Use supplied facts to perform the declared response operation.' }], lesson_plan: { phases: [{ id: 'F1', role: 'synthetic-family-smoke', target_refs: ['K1'], source_refs: ['S1'] }] }, delivery_context: { status: 'Synthetic sequence only; no actual learner exposure or source-native renderer equivalence claimed.' } };
  const request = { protocol: NATIVE_PROTOCOL, request_id: `synthetic-kind-${kind}`, course_context: course, sequence_blueprint: slots, source_provenance: provenance };
  const context = { contract: 'lesson-context 0.1', source: provenance, lesson: { id: `synthetic-${kind}`, learning_question: 'What does the supplied source establish?', keywords: [] }, native: { course_context: structuredClone(course), pages: [{ id: 'P1', nodes: [{ type: 'fictional-source', source_ref: 'S1' }], question_slots: slots.map(row => ({ id: row.id })) }] }, adapter_extension: 'native-activity-transport/0.2' };
  course.instructional_plan = proposeInstructionalPlan(request, context, { note: 'Explicit synthetic family transport proposal, not golden teaching material or authoritative curriculum.' });
  context.native.course_context = structuredClone(course);
  return { kind, request, context, context_origin: 'synthetic-family-fixture-not-golden-example', captured_occurrences: 0, dependency_items: 0, native_source_shape: 'Not supplied by the retained current reference; this exercises only the declared adapter family contract.' };
}

export function kindCase(kind, currentRequest, currentContext) {
  if (!FORMAT_DISPATCH[kind]) throw new Error('Unknown collected kind');
  return currentKindCase(kind, currentRequest, currentContext) ?? syntheticKindCase(kind);
}

export function missingPrerequisiteCase(caseData) {
  const request = structuredClone(caseData.request), context = structuredClone(caseData.context), slot = request.sequence_blueprint.find(row => row.native_kind === caseData.kind);
  const family = slot.family; let missing;
  if (caseData.kind.includes('film') || caseData.kind === 'video_mcq') { const phase = request.course_context.lesson_plan.phases.find(row => row.id === slot.phase_ref); const media = request.course_context.source_assets.find(row => row.kind === 'media-transcript' && phase.source_refs.includes(row.id)); delete media.media_ref; missing = 'Supplied media reference, transcript and time range at the declared pause.'; }
  else if (FORMAT_DISPATCH[caseData.kind].family === 'composite' && caseData.kind !== 'argument_round') { delete slot.native_context.composite_parent; missing = 'Explicit same-parent claim/evidence parts with their dependency and native composite context.'; }
  else if (caseData.kind === 'argument_round') { slot.operation = 'unspecified'; missing = 'Explicit ask/explain/rebut operation and native response parts.'; }
  else if (caseData.kind === 'quote_analysis') { slot.operation = 'unspecified'; missing = 'Exact quotation branch and paraphrase/interpretation subcheck operation.'; }
  else if (family === 'classification') { delete slot.native_context.category_dimensions; missing = 'Supplied entity/relation category dimensions.'; }
  else if (family === 'matching') { delete slot.native_context.match_relation; missing = 'Supplied matching relation, entries and targets.'; }
  else if (family === 'sequence') { delete slot.native_context.ordering_rule; missing = 'Supplied ordering relation for the source events.'; }
  else if (['inline_choice', 'shared_cloze'].includes(family)) { delete slot.native_context.surrounding_text; missing = 'The surrounding taught sentence containing the blank and shared-bank policy where required.'; }
  else if (family === 'multiple_select') { delete slot.native_context.selection_rule; missing = 'A declared multiple-select selection rule visible to the learner.'; }
  else if (family === 'word_selection') { delete slot.native_context.allowed_words; missing = 'Exact quotation, allowed words and declared class options.'; }
  else if (family === 'self_report') { delete slot.native_context.scale; missing = 'Explicit self-report scale with no correctness key.'; }
  else if (family === 'say_back') { delete slot.native_context.recall_source_ref; missing = 'A supplied exact taught recall statement.'; }
  else { request.course_context.lesson_plan.phases.find(row => row.id === slot.phase_ref).source_refs = ['missing-source']; missing = 'A resolving source visible at this phase, before the response and feedback release.'; }
  context.native.course_context = structuredClone(request.course_context);
  return { request, context, missing };
}

export async function smokeKindMatrix({ request, context, catalog, schema, writeSequence, journalFor }) {
  const rows = []; let mockedCalls = 0, transportedItems = 0;
  for (const kind of Object.keys(FORMAT_DISPATCH).sort()) {
    const sample = kindCase(kind, request, context); const journal = await journalFor(kind);
    await journal('source-request.json', sample.request); await journal('source-context.json', sample.context);
    validateNativeInputs(sample.request, sample.context, catalog);
    const response = mockNativeResponse(sample.request);
    validate(response, schema);
    const route = { async complete() { const value = { model: 'offline-mocked-provider', choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(response) } }] }; return { value, raw: JSON.stringify(value) }; } };
    const result = await writeSequence({ request: sample.request, context: sample.context, schema, config: { model: 'offline-mocked-provider', offline_mock: true, structural_repairs: 1 }, messages: [], route, journal });
    validateNativeResponse(result.response, sample.request);
    if (result.response.status !== 'prepared-for-review') throw new Error(`${kind}: mock output unexpectedly held`);
    const provenance = { kind: sample.context_origin, model_calls: 0, mocked_provider_calls: result.trace.mocked_provider_calls, academic_quality: 'unmeasured; source/family transport fixture only' };
    const pair = adaptNativeResponse(sample.request, sample.context, result.response, provenance);
    const learner = nativeLearnerPacket(pair.context, pair.questionSet);
    await journal('lesson-context.json', pair.context); await journal('question-set.json', pair.questionSet); await journal('learner.json', learner);
    const missing = missingPrerequisiteCase(sample); let hold;
    try { validateNativeInputs(missing.request, missing.context, catalog); throw new Error(`${kind}: missing prerequisite was accepted`); }
    catch (error) { if (!(error instanceof StructuralError)) throw error; hold = { protocol: NATIVE_PROTOCOL, request_id: missing.request.request_id, status: 'held', items: [], holds: [{ code: 'missing-required-context', detail: error.message }] }; }
    validate(hold, schema); validateNativeResponse(hold, missing.request);
    await journal('missing-context-hold.json', hold);
    const row = { native_kind: kind, family: FORMAT_DISPATCH[kind].family, context_origin: sample.context_origin, status: sample.captured_occurrences ? 'captured-context-mock-transport-checked' : FORMAT_DISPATCH[kind].family === 'nonresponse' ? 'synthetic-instruction-transport-checked' : 'synthetic-family-transport-checked', captured_occurrences: sample.captured_occurrences, transported_items: result.response.items.length, dependency_items: sample.dependency_items, public_formats: [...new Set(sample.request.sequence_blueprint.map(slot => slot.public_format))], native_source_shape: sample.native_source_shape, model_calls: 0, mocked_provider_calls: result.trace.mocked_provider_calls, missing_context: { status: 'typed-hold-checked', prerequisite: missing.missing, detail: hold.holds[0].detail, provider_calls: 0 }, finished_transport: `${kind}/question-set.json`, learner: `${kind}/learner.json`, source_scope: 'Exact quote and resolving field bindings checked against sources visible to each phase.', academic_quality: 'unmeasured', actual_model_generation: 'not run', production_native_renderer_compatibility: 'not asserted' };
    row.input_hashes = { request: packetHash(sample.request), context: packetHash(sample.context) };
    row.transport_hashes = { 'lesson-context.json': packetHash(pair.context), 'question-set.json': packetHash(pair.questionSet), 'learner.json': packetHash(learner) };
    row.real_source_prerequisite = sample.captured_occurrences ? 'Retained source context used; independent quality and production native rendering remain unverified.' : 'An actual source-native operation/payload and its course/media context are required before this synthetic alias fixture can support a real lesson claim.';
    await journal('receipt.json', row); rows.push(row); mockedCalls += result.trace.mocked_provider_calls; transportedItems += result.response.items.length;
  }
  return { version: 'native-kind-context-smoke/0.2', status: 'all-kind-offline-matrix-checked', collected_native_kinds: rows.length, current_captured_kinds: rows.filter(row => row.captured_occurrences).length, synthetic_kinds: rows.filter(row => !row.captured_occurrences).length, captured_activity_occurrences: rows.reduce((n, row) => n + row.captured_occurrences, 0), transported_items: transportedItems, dependency_item_appearances: rows.reduce((n, row) => n + row.dependency_items, 0), missing_context_holds_checked: rows.length, model_calls: 0, mocked_provider_calls: mockedCalls, current_source: request.source_provenance, qualification: 'Captured authoring context and explicitly synthetic transport contexts are separated. No real generation, question quality, native renderer compatibility or learner outcome is established.', rows };
}
