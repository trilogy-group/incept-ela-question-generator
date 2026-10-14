import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { rotateChoiceDisplays } from '../display_rotation.mjs';
import { reviseSourceCourse } from '../editorial_revision.mjs';

test('balanced display positions preserve option-rationale-binding tuples and keyed content', () => {
  const supplied = { items: Array.from({ length: 5 }, (_, rank) => ({
    id: `Q${rank}`, kind: 'reading_mcq',
    view: { options: ['A', 'B', 'C', 'D'], option_feedback: ['why A', 'why B', 'why C', 'why D'], key: [rank % 2] },
    source_bindings: Array.from({ length: 4 }, (_, i) => ({ field_ref: `/view/options/${i}`, quote: `quote ${i}` })).concat([{ field_ref: '/view/option_feedback/1', quote: 'rationale B evidence' }]),
  })) };
  const original = structuredClone(supplied);
  const rotated = rotateChoiceDisplays(supplied);
  assert.deepEqual(supplied, original);
  assert.deepEqual(rotated.response.items.map(item => item.view.key[0]), [0, 1, 2, 3, 0]);
  assert.deepEqual(rotateChoiceDisplays(rotated.response).response, rotated.response);
  for (const [rank, item] of rotated.response.items.entries()) {
    const prior = supplied.items[rank];
    assert.equal(item.view.options[item.view.key[0]], prior.view.options[prior.view.key[0]]);
    for (let i = 0; i < 4; i++) {
      const current = item.view.options.indexOf(prior.view.options[i]);
      assert.equal(item.view.option_feedback[current], prior.view.option_feedback[i]);
      assert.equal(item.source_bindings.find(binding => binding.field_ref === `/view/options/${current}`).quote, `quote ${i}`);
    }
    const rationaleIndex = item.view.options.indexOf('B');
    assert.equal(item.source_bindings.find(binding => binding.quote === 'rationale B evidence').field_ref, `/view/option_feedback/${rationaleIndex}`);
  }
});

test('ordinary editorial revision does not mutate inputs or introduce unbound source quotations', async () => {
  const request = JSON.parse(await readFile(new URL('../examples/othello-1-1-request.json', import.meta.url)));
  const notes = JSON.parse(await readFile(new URL('../editorial-revision.json', import.meta.url)));
  const service = request.course_context.source_assets.find(row => row.id === 'S-SERVICE');
  const source = { items: Object.keys(notes.edits).map(id => ({ id, kind: id === 'Q06' ? 'reading_mcq' : 'open_check', view: { option_feedback: ['a', 'b', 'c', 'd'], rubric: { criteria: [] } }, source_bindings: id === 'Q06' ? [{ field_ref: '/view/options/2', source_ref: service.id, quote: service.text }] : [] })) };
  const before = structuredClone(source);
  const result = reviseSourceCourse(source, request, notes);
  assert.deepEqual(source, before);
  for (const item of result.response.items) for (const binding of item.source_bindings) {
    const asset = request.course_context.source_assets.find(row => row.id === binding.source_ref);
    assert.ok(asset.text.includes(binding.quote));
  }
  const q14 = result.response.items.find(item => item.id === 'Q14');
  assert.equal(q14.view.rubric.policy_bindings[0].policy_text, request.sequence_blueprint[13].support);
  assert.equal(q14.view.rubric.format_condition.status, 'proposed-local-course-policy');
});
