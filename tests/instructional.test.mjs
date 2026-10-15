import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { compileInstructionalPlan, proposeInstructionalPlan } from '../instructional_plan.mjs';
import { compileContextPlan } from '../context_intake.mjs';
import { nativeWriterMessages, validateNativeInputs, validateNativeResponse, adaptNativeResponse, nativeLearnerPacket } from '../native_formats.mjs';
import { mockNativeResponse } from '../native_smoke.mjs';
import { execute } from '../model_generate.mjs';
const read = async path => JSON.parse(await readFile(new URL(`../${path}`, import.meta.url)));
const originalRequest = await read('examples/current-native-request.json'), originalContext = await read('examples/current-native-context.json');
const formats = await read('public/formats.json'), methods = await read('public/generation-standard.json'), schema = await read('schema/native-writer-response.schema.json');
const fixture = () => ({ request: structuredClone(originalRequest), context: structuredClone(originalContext) });
const sync = (r, c) => { c.native.course_context = structuredClone(r.course_context); };
const packet = (r, c) => JSON.parse(nativeWriterMessages(r, c, schema, methods, formats)[1].content);

test('declared events preserve exact supplied teaching text and bounded caption availability without source expansion', async () => {
  for (const prefix of ['current-native', 'othello-1-1']) {
    const request = await read(`examples/${prefix}-request.json`), context = await read(`examples/${prefix}-context.json`);
    const plan = proposeInstructionalPlan(request, context);
    for (const event of plan.events) {
      const source = request.course_context.source_assets.find(row => row.id === event.source_refs[0]);
      assert.equal(event.content, source.text);
      assert.equal(event.status, 'declared');
      assert.match(event.provenance, /individual exposure unknown/);
      if (source.kind === 'media-transcript') assert.ok(event.provenance.includes(JSON.stringify(source.time_range)));
    }
    if (prefix === 'current-native') {
      const before = ref => plan.events.find(event => event.source_refs.includes(ref)).before_item_id;
      assert.equal(before('unit-caption-6'), 'N05');
      assert.equal(before('unit-caption-7'), 'N05');
      assert.equal(before('unit-caption-3'), 'N03');
      assert.equal(before('reading-2-intro-captions'), 'N11');
    } else {
      for (const ref of ['S-MODEL', 'S-WRITING']) {
        const source = request.course_context.source_assets.find(row => row.id === ref);
        assert.ok(request.course_context.prior_exposure.some(row => row.content === source.text));
        assert.equal(plan.events.find(event => event.source_refs.includes(ref)).content, source.text);
      }
    }
    request.course_context.source_assets[0].text = 'Only this supplied excerpt is available.';
    assert.equal(proposeInstructionalPlan(request, context).events.find(event => event.source_refs.includes(request.course_context.source_assets[0].id)).content, 'Only this supplied excerpt is available.');
    delete request.course_context.source_assets[0].text;
    assert.match(proposeInstructionalPlan(request, context).events.find(event => event.source_refs.includes(request.course_context.source_assets[0].id)).content, /text unavailable/);
  }
});

test('lesson purpose, prior instruction and prerequisite changes reach resolved writer context and invalidate stale return contracts', () => {
  const { request, context } = fixture(), response = mockNativeResponse(request);
  const before = packet(request, context).resolved_slot_contexts;
  request.course_context.instructional_plan.lesson.objective = 'Explain how the supplied evidence supports and limits a claim about professed loyalty.';
  request.course_context.instructional_plan.events[0].content = 'Prior instruction explicitly asks learners to distinguish a speaker claim from an established event.';
  request.course_context.prerequisites[0].description = 'Locate the dramatic speaker before interpreting the supplied statement; no learner mastery is asserted.';
  sync(request, context);
  const after = packet(request, context).resolved_slot_contexts;
  assert.notEqual(after.instructional_plan.context_sha256, before.instructional_plan.context_sha256);
  assert.equal(after.instructional_plan.lesson.objective, request.course_context.instructional_plan.lesson.objective);
  assert.equal(after.instructional_plan.events[0].content, request.course_context.instructional_plan.events[0].content);
  assert.throws(() => validateNativeResponse(response, request), /objective|context binding/);
});

test('assessment permits taught-target retrieval; only explicit task-answer withholding changes eligibility', () => {
  const { request, context } = fixture(), p = request.course_context.instructional_plan, first = p.items[0];
  p.lesson.purpose = 'assessment'; first.purpose = 'assessment'; first.measurement_intent = 'Retrieve a previously taught relationship using visible source support.';
  first.support.answer_exposure = 'withheld'; p.events[0].revealed_target_refs = [...first.goal_refs];
  sync(request, context); validateNativeInputs(request, context, formats);
  p.events[0].disclosed_item_ids = [first.item_id]; sync(request, context);
  assert.throws(() => validateNativeInputs(request, context, formats), /withheld task answer/);
  first.support.answer_exposure = 'allowed'; sync(request, context);
  validateNativeInputs(request, context, formats); validateNativeResponse(mockNativeResponse(request), request);
});

test('anchored observed and conditional interactions remain distinct and alter later output obligations', () => {
  const { request, context } = fixture(), response = mockNativeResponse(request), p = request.course_context.instructional_plan;
  const target = p.items[1].goal_refs[0], source = request.course_context.lesson_plan.phases[1].source_refs[0];
  const event = { id: 'SUPPLIED-RESPONSE', order: 1, before_item_id: p.items[1].item_id, kind: 'response', status: 'observed', content: 'A supplied anonymous response distinguishes professed service from private purpose.', source_refs: [source], target_refs: [target], revealed_target_refs: [], provenance: 'Synthetic supplied interaction record for this offline regression; no real learner observation claimed.', disclosed_item_ids: [] };
  const conditional = { ...event, id: 'POSSIBLE-FEEDBACK', kind: 'feedback', status: 'conditional', content: 'Feedback may be released after an attempted response; no release is known.' };
  p.events.push(event, conditional);
  const index = id => id === 'END' ? p.items.length : p.items.findIndex(row => row.item_id === id);
  p.events.sort((a, b) => index(a.before_item_id) - index(b.before_item_id)); p.events.forEach((row, i) => row.order = i + 1);
  sync(request, context);
  const plan = compileInstructionalPlan(request, context);
  assert.equal(plan.items[0].known_interactions.length, 0);
  assert.equal(plan.items[1].known_interactions[0].id, event.id);
  assert.equal(plan.items[1].conditional_events[0].id, conditional.id);
  assert.throws(() => validateNativeResponse(response, request), /context binding/);
  const fresh = mockNativeResponse(request); validateNativeResponse(fresh, request);
  assert.ok(fresh.sequence_plan.items[1].context_event_refs.includes(event.id));
});

test('a new evidence requirement needs a new bound marking criterion, not only an echoed plan label', () => {
  const { request, context } = fixture(), response = mockNativeResponse(request);
  const i = request.sequence_blueprint.findIndex(row => row.family === 'written_response');
  const item = request.course_context.instructional_plan.items[i], original = item.expected_evidence[0];
  item.expected_evidence.push({ ...structuredClone(original), id: `${original.id}-LIMIT`, claim: 'Distinguish the supplied speaker claim from what this source independently establishes.' });
  sync(request, context);
  assert.throws(() => validateNativeResponse(response, request), /context binding|evidence/);
  const fresh = mockNativeResponse(request); validateNativeResponse(fresh, request);
  assert.equal(fresh.items[i].view.rubric.criteria.length, 2);
  assert.equal(fresh.items[i].view.rubric.criteria[1].requirement, item.expected_evidence[1].claim);
  fresh.items[i].view.rubric.criteria.pop();
  assert.throws(() => validateNativeResponse(fresh, request), /pointer|marking requirement|bind/);
  for (const change of [r => r.sequence_plan.items[0] = null, r => r.sequence_plan.items[0].expected_evidence[0] = null, r => r.sequence_plan.items[0].expected_evidence[0].field_refs = [null], r => r.items[0] = null, r => r.items[0].source_bindings[0] = null, r => { r.status = 'held'; r.items = []; r.holds = [null]; }]) { const invalid = mockNativeResponse(request); change(invalid); assert.throws(() => validateNativeResponse(invalid, request), error => error.constructor.name === 'StructuralError'); }
});

test('future task intent cannot grant future source exposure and sequence coverage/transitions cannot silently disappear', () => {
  const { request, context } = fixture(), p = request.course_context.instructional_plan;
  p.items[0].prepares_for_item_ids = [p.items.at(-1).item_id]; sync(request, context);
  validateNativeInputs(request, context, formats);
  p.items[0].expected_evidence[0].source_refs = ['reading-4']; sync(request, context);
  assert.throws(() => validateNativeInputs(request, context, formats), /source scope/);
  p.items[0].expected_evidence[0].source_refs = originalRequest.course_context.instructional_plan.items[0].expected_evidence[0].source_refs;
  p.sequence.support_transitions.pop(); sync(request, context);
  assert.throws(() => validateNativeInputs(request, context, formats), /support transitions/);
});

test('static unknown learner history is valid while individualized/mastery scopes and missing authority hold', () => {
  const { request, context } = fixture();
  validateNativeInputs(request, context, formats);
  assert.ok(compileInstructionalPlan(request).goal_authority.every(row => row.kind === 'source-projected'));
  for (const scope of ['individualized', 'mastery-claim']) { const r = structuredClone(request), c = structuredClone(context); r.course_context.instructional_plan.items[0].scope = scope; sync(r, c); assert.throws(() => validateNativeInputs(r, c, formats), /unsupported/); }
  request.course_context.instructional_plan.goal_authority.pop(); sync(request, context);
  assert.throws(() => validateNativeInputs(request, context, formats), /authority/);
  const dropped = fixture(); dropped.request.course_context.instructional_plan.items[0].expected_evidence[0].source_refs = []; sync(dropped.request, dropped.context);
  assert.throws(() => validateNativeInputs(dropped.request, dropped.context, formats), /knowledge evidence/);
});

test('legacy prerequisite response evidence is joined or typed-held rather than silently carried as opaque metadata', async () => {
  const request = await read('examples/othello-1-1-request.json'), context = await read('examples/othello-1-1-context.json');
  request.student_context.prerequisite_response_evidence = { responses: [{ id: 'R-PRIOR', knowledge_ref: 'K-CONTEXT', response: 'A supplied anonymous response relates the two named characters.', before_phase_ref: 'F-CONTEXT' }] };
  sync(request, context); assert.equal(compileContextPlan(request, context).slots[0].learner_responses[0].id, 'R-PRIOR');
  for (const invalid of ['Unstructured asserted readiness', false, 0, '']) { request.student_context.prerequisite_response_evidence = invalid; sync(request, context); assert.throws(() => compileContextPlan(request, context), /typed response records/); }
});

test('teacher plans, expectations, future intent and supplied response history stay out of learner exports', () => {
  const { request, context } = fixture();
  request.course_context.learner_history = { responses: [] }; sync(request, context);
  const pair = adaptNativeResponse(request, context, mockNativeResponse(request), { kind: 'offline-test', model_calls: 0 });
  assert.equal(pair.context.native.sequence_plan.plan_id, request.course_context.instructional_plan.id);
  const learner = nativeLearnerPacket(pair.context, pair.questionSet);
  for (const key of ['instructional_plan', 'learner_history']) assert.equal(key in learner.native.course_context, false);
  assert.equal('sequence_plan' in learner.native, false); assert.equal('resolved_slot_contexts' in learner.native, false);
  assert.equal(JSON.stringify(learner).includes('expected_evidence'), false);
});

test('missing legacy instructional context produces a saved typed hold before credentials/provider access', async () => {
  const request = await read('examples/othello-1-1-request.json'), context = await read('examples/othello-1-1-context.json');
  delete request.course_context.instructional_plan; sync(request, context);
  const directory = new URL(`../.local/instructional-test-${randomUUID()}/`, import.meta.url); await mkdir(directory, { recursive: true });
  try {
    const r = new URL('request.json', directory), c = new URL('context.json', directory);
    await writeFile(r, JSON.stringify(request)); await writeFile(c, JSON.stringify(context));
    const result = await execute({ request: r.pathname, context: c.pathname, envFile: 'MUST-NOT-BE-READ' });
    assert.equal(result.status, 'held'); assert.equal(result.provider_calls, 0); assert.equal(result.model_calls, 0);
    assert.match(result.holds[0].detail, /instructional plan/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('the same offline CLI route exports complete text input/source packets and finished context-bound output', async () => {
  const result = await execute({ offlineSmoke: true, request: new URL('../examples/othello-1-1-request.json', import.meta.url).pathname, context: new URL('../examples/othello-1-1-context.json', import.meta.url).pathname });
  assert.equal(result.status, 'mock-transport-checked'); assert.equal(result.items, 14); assert.equal(result.model_calls, 0); assert.equal(result.mocked_provider_calls, 1);
  const readOutput = async name => JSON.parse(await readFile(`${result.directory}/${name}`));
  const request = await readOutput('course-request.json'), packet = await readOutput('course-source-packet.json'), context = await readOutput('lesson-context.json'), set = await readOutput('question-set.json');
  assert.deepEqual(request.course_context, packet.native.course_context);
  assert.deepEqual(request.course_context, context.native.course_context);
  assert.deepEqual(request.student_context, context.native.student_context);
  assert.equal(set.sequence_plan.context_sha256, compileInstructionalPlan(request).context_sha256);
  assert.equal(set.items.length, 14); assert.equal(packet.source.commit, '3ed708e126aec14b7456679b9236e01c1081df16');
});
