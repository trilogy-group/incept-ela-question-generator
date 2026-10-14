import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { compileContextPlan, contextConsumptionAudit } from '../context_intake.mjs';
import { validateNativeInputs, validateNativeResponse, nativeWriterMessages, adaptNativeResponse, nativeLearnerPacket } from '../native_formats.mjs';
import { mockNativeResponse } from '../native_smoke.mjs';
import { writerMessages } from '../model_generate.mjs';
const j = async path => JSON.parse(await readFile(new URL(`../${path}`, import.meta.url)));
const request = await j('examples/current-native-request.json'), context = await j('examples/current-native-context.json');
const formats = await j('public/formats.json'), methods = await j('public/generation-standard.json'), schema = await j('schema/native-writer-response.schema.json');

test('public proposal graph, content keys and concrete pairing tables resolve into each writer slot', async () => {
  const legacy = await j('examples/othello-1-1-request.json'), c = await j('examples/othello-1-1-context.json');
  const plan = compileContextPlan(legacy, c);
  assert.equal(plan.slots.length, 14);
  const first = plan.slots[0];
  assert.equal(first.targets[0].id, 'K-CONTEXT'); assert.equal(first.content_keys[0].id, 'C-CONTEXT'); assert.equal(first.concrete_pairs[0].id, 'T-02');
  assert.ok(first.targets[0].performance); assert.ok(first.content_keys[0].claim); assert.ok(first.knowledge_graph_edges.length);
  const packet = JSON.parse(writerMessages(legacy, c, {}, methods, formats)[1].content);
  assert.deepEqual(packet.resolved_slot_contexts.slots[0].concrete_pairs, first.concrete_pairs);
  const changed = structuredClone(legacy); changed.course_context.pairing_tables[0].pairs.find(row => row.id === 'T-02').phase_ref = 'F-PROMOTION';
  assert.throws(() => compileContextPlan(changed, c), /pair contradicts/);
});

test('native graph-shaped knowledge maps and supplied concrete tables influence the resolved slot context', () => {
  const r = structuredClone(request), c = structuredClone(context), course = r.course_context, links = course.knowledge_map;
  course.content_keys.forEach(key => key.target_refs = links.filter(row => row.content_key_ref === key.id).map(row => row.knowledge_ref));
  course.core_knowledge[0].prerequisite_refs = ['prior-literature'];
  course.knowledge_map = { nodes: [...course.core_knowledge.map(row => ({ id: row.id, role: 'core', claim: row.claim })), { id: 'prior-literature', role: 'prerequisite', claim: 'Declared prior study, without individual evidence.' }], edges: [{ from: 'prior-literature', to: 'K-media', relation: 'prerequisite-for' }] };
  course.pairing_tables = [{ id: 'T-explicit', pairs: [{ id: 'PAIR-explicit', target_ref: 'K-media', source_ref: 'unit-caption-2', content_key_ref: 'C-unit-caption-2', phase_ref: 'F-N01', rationale: 'Explicit supplied association; no mastery claim.' }] }];
  r.sequence_blueprint[0].pairing_table_pair_refs = ['PAIR-explicit']; c.native.course_context = structuredClone(course);
  validateNativeInputs(r, c, formats);
  const plan = compileContextPlan(r, c); assert.equal(plan.slots[0].concrete_pairs[0].id, 'PAIR-explicit'); assert.equal(plan.slots[0].knowledge_graph_edges[0].from, 'prior-literature');
  const packet = JSON.parse(nativeWriterMessages(r, c, schema, methods, formats)[1].content);
  assert.equal(packet.resolved_slot_contexts.slots[0].content_keys[0].id, 'C-unit-caption-2');
  assert.match(packet.resolved_slot_contexts.slots[0].qualification, /no mastery, ZPD/);
  const invalid = structuredClone(r); invalid.course_context.pairing_tables[0].pairs[0].source_ref = 'reading-4'; const invalidContext = structuredClone(c); invalidContext.native.course_context = structuredClone(invalid.course_context);
  assert.throws(() => validateNativeInputs(invalid, invalidContext, formats), /pair contradicts/);
});

test('all 19 reproduced context/version/ordering/return contradictions are typed offline refusals', () => {
  const report = contextConsumptionAudit(request, context, { validateInputs: validateNativeInputs, validateResponse: validateNativeResponse, mockResponse: mockNativeResponse, catalog: formats });
  assert.equal(report.regression_cases_checked, 19); assert.equal(report.model_calls, 0);
  assert.ok(report.regression_cases.every(row => row.detail && row.model_calls === 0));
  assert.ok(report.regression_cases.some(row => row.id === 'source-version'));
  assert.ok(report.regression_cases.some(row => row.id === 'knowledge-content-join'));
  assert.ok(report.regression_cases.some(row => row.id === 'response-option-cap'));
  assert.equal(report.independent_quality_labels, 0);
});

test('supplied learner history is phase-filtered and declared answer exposure changes the unexposed-target route', () => {
  const r = structuredClone(request), c = structuredClone(context);
  r.course_context.learner_history = { responses: [{ id: 'anonymous-response', knowledge_ref: 'K-media', source_refs: ['unit-caption-2'], before_phase_ref: 'F-N02', response: 'A recorded response; correctness is not inferred.' }] };
  r.course_context.prior_exposure.events.push({ source_ref: 'unit-caption-2', before_phase_ref: 'F-N02', revealed_target_refs: ['K-media'], availability: 'Explicit supplied answer exposure.' });
  c.native.course_context = structuredClone(r.course_context);
  let plan = compileContextPlan(r, c); assert.equal(plan.slots[0].learner_responses.length, 0); assert.equal(plan.slots[1].learner_responses.length, 1);
  r.sequence_blueprint[0].native_context.requires_unexposed_targets = true; validateNativeInputs(r, c, formats);
  r.sequence_blueprint[1].native_context.requires_unexposed_targets = true; assert.throws(() => validateNativeInputs(r, c, formats), /prior declared answer exposure/);
  delete r.sequence_blueprint[1].native_context.requires_unexposed_targets; r.sequence_blueprint[0].native_context.requires_individual_readiness = true;
  assert.throws(() => validateNativeInputs(r, c, formats), /individual readiness cannot be established/);
});

test('resolved teacher context survives adaptation without entering learner question payloads', () => {
  const pair = adaptNativeResponse(request, context, mockNativeResponse(request), { model_calls: 0, academic_quality: 'unmeasured' });
  assert.equal(pair.context.native.resolved_slot_contexts.length, 50);
  assert.ok(pair.questionSet.context_consumption.lesson_plan.includes('consumed'));
  const learner = nativeLearnerPacket(pair.context, pair.questionSet); assert.equal('resolved_slot_contexts' in learner.native, false);
  assert.deepEqual(pair.context.native.resolved_slot_contexts[0].visible_source_refs, request.course_context.lesson_plan.phases[0].source_refs);
  assert.equal(pair.questionSet.generation_metadata.model_calls, 0);
});
