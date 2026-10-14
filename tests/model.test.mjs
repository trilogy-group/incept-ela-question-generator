import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { adaptResponse, learnerPacket, resolve, validate, validateInputs, validateResponse } from '../model_contract.mjs';
import { normalizeTransport, writeSequence } from '../model_generate.mjs';

const responseSchema = JSON.parse(await readFile(new URL('../schema/writer-response.schema.json', import.meta.url)));
const requestSchema = JSON.parse(await readFile(new URL('../schema/generator-request.schema.json', import.meta.url)));
const contextSchema = JSON.parse(await readFile(new URL('../schema/lesson-context.schema.json', import.meta.url)));
function fixture() {
  const source = 'I follow him to serve my turn upon him.';
  const course = { core_knowledge: [{ id: 'K1', claim: 'A source relationship', performance: 'Explain the relationship' }], source_assets: [{ id: 'S1', text: source }], lesson_plan: { id: 'L1', phases: [{ id: 'F1', role: 'source-reading', target_refs: ['K1'], source_refs: ['S1'] }] } };
  const slots = Array.from({ length: 12 }, (_, i) => ({ role: 'check', target: ['K1'], formats: ['reading_mcq'], support: 'Visible text, no hint', position: { id: `Q${i + 1}`, page: 'P1', phase_ref: 'F1', alignment: { phase_ref: 'F1', target_refs: ['K1'], source_refs: ['S1'], content_key_refs: [], pair_refs: [], role: 'check', support: 'Visible text, no hint' } } }));
  const request = { protocol: 'question-lane-generation/0.1', request_id: 'test', course_context: course, sequence_blueprint: slots };
  const context = { contract: 'lesson-context 0.1', source: { commit: 'original' }, lesson: { id: 'L1', learning_question: 'What relationship?', keywords: [] }, native: { course_context: structuredClone(course), pages: [{ id: 'P1', nodes: [{ type: 'source', text: source }], question_slots: slots.map(slot => ({ id: slot.position.id })) }] } };
  const response = { protocol: request.protocol, request_id: request.request_id, status: 'prepared-for-review', holds: [], items: slots.map(slot => ({ id: slot.position.id, kind: 'reading_mcq', view: { stem: 'What relationship is described?', options: ['A', 'B', 'C'], key: [0], option_feedback: ['Reason A', 'Reason B', 'Reason C'], correct_feedback: 'Explanation' }, source_bindings: Array.from({ length: 3 }, (_, j) => ({ source_ref: 'S1', quote: source, field_ref: `/view/options/${j}`, relation: 'Source relationship' })) })) };
  return { request, context, response };
}

test('typed request and response reject unresolved sources, future evidence, broken keys and unsupported schema constraints', () => {
  const { request, context, response } = fixture();
  validateInputs(request, context, requestSchema, contextSchema);
  assert.equal(validateResponse(response, request, responseSchema), 12);
  for (const mutate of [r => r.items[0].view.key = [8], r => r.items[0].source_bindings[0].source_ref = 'future', r => r.items[0].source_bindings[0].quote = 'Invented', r => r.items[0].source_bindings[0].field_ref = '/view/missing', r => r.items.reverse()]) {
    const changed = structuredClone(response); mutate(changed); assert.throws(() => validateResponse(changed, request, responseSchema));
  }
  assert.throws(() => validate(response, { type: 'object', unimplemented: true }), /unsupported schema/);
});

test('observed JSON fences and scalar keys normalize without changing answer positions or content', () => {
  const { response } = fixture();
  response.items.forEach(item => item.view.key = 2);
  const raw = `\`\`\`json\n${JSON.stringify(response)}\n\`\`\``;
  const normalized = normalizeTransport(raw);
  assert.equal(normalized.operations.length, 13);
  for (const item of normalized.response.items) {
    assert.deepEqual(item.view.key, [2]);
    const original = response.items.find(row => row.id === item.id);
    assert.deepEqual({ ...item.view, key: 2 }, original.view);
  }
  assert.ok(raw.startsWith('```json'));
});

test('finished transport preserves sources, alignment, instruction order and exact native pointers; learner projection withholds answers', () => {
  const { request, context, response } = fixture();
  const pair = adaptResponse(request, context, response, { run: 'one' });
  assert.deepEqual(pair.context.native.course_context, request.course_context);
  assert.deepEqual(pair.context.native.pages[0].nodes, context.native.pages[0].nodes);
  for (const item of pair.questionSet.items) {
    assert.deepEqual(resolve(pair.context.native, item.pointer), item.native);
    assert.deepEqual(item.alignment, request.sequence_blueprint[item.order - 1].position.alignment);
  }
  const learner = learnerPacket(pair.context, pair.questionSet);
  const question = learner.native.pages[0].question_slots[0];
  for (const field of ['key', 'option_feedback', 'correct_feedback', 'source_bindings']) assert.equal(field in question, false);
  assert.deepEqual(question.options, ['A', 'B', 'C']);
});

test('one writer call is preserved and no semantic selection or internal judge runs', async () => {
  const { request, context, response } = fixture(); const files = new Map(); let calls = 0;
  const result = await writeSequence({ request, context, schema: responseSchema, config: { model: 'writer', structural_repairs: 1, temperature: 0.4, max_tokens: 1000 }, messages: [], route: { async complete() { calls++; const value = { model: 'reported-version', choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(response) } }], usage: { total_tokens: 100 } }; return { value, raw: JSON.stringify(value) }; } }, journal: async (name, value) => { assert.equal(files.has(name), false); files.set(name, structuredClone(value)); } });
  assert.equal(calls, 1); assert.equal(result.trace.model_calls, 1); assert.deepEqual(result.trace.selection, []); assert.deepEqual(result.trace.repairs, []);
  assert.equal(files.get('first-attempt.provider.json').model, 'reported-version'); assert.deepEqual(result.response, response);
});

test('a structural repair retains both raw attempts and is bounded to one call', async () => {
  const { request, context, response } = fixture(); const files = new Map(); let calls = 0;
  const run = validRepair => writeSequence({ request, context, schema: responseSchema, config: { model: 'writer', structural_repairs: 1 }, messages: [], route: { async complete() { calls++; const value = { model: 'writer', choices: [{ message: { content: calls === 1 || !validRepair ? 'invalid JSON' : JSON.stringify(response) } }] }; return { value, raw: JSON.stringify(value) }; } }, journal: async (name, value) => { files.set(name, structuredClone(value)); } });
  const repaired = await run(true); assert.equal(calls, 2); assert.equal(repaired.trace.repairs.length, 1); assert.ok(files.has('first-attempt.provider.json')); assert.ok(files.has('structural-repair-1.provider.json'));
  calls = 0; files.clear(); const held = await run(false); assert.equal(calls, 2); assert.equal(held.response.status, 'held'); assert.deepEqual(held.response.items, []);
});

test('a typed or provider refusal remains a hold without a repair or fallback', async () => {
  const { request, context } = fixture();
  for (const content of [{ refusal: 'Source unavailable' }, { content: JSON.stringify({ protocol: request.protocol, request_id: request.request_id, status: 'held', holds: [{ code: 'missing-source', detail: 'Required text missing' }], items: [] }) }]) {
    let calls = 0;
    const result = await writeSequence({ request, context, schema: responseSchema, config: { model: 'writer', structural_repairs: 1 }, messages: [], route: { async complete() { calls++; const value = { choices: [{ message: content }] }; return { value, raw: JSON.stringify(value) }; } }, journal: async () => {} });
    assert.equal(calls, 1); assert.equal(result.response.status, 'held'); assert.equal(result.trace.refusals.length, 1);
  }
});
