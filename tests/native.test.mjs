import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile, rm } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import { FORMAT_DISPATCH, adaptNativeResponse, nativeLearnerPacket, validateNativeInputs, validateNativeResponse } from '../native_formats.mjs';
import { formatCoverage, mockNativeResponse } from '../native_smoke.mjs';
import { kindCase, missingPrerequisiteCase, smokeKindMatrix } from '../native_breadth.mjs';
import { execute, executeNativeOffline, writeSequence } from '../model_generate.mjs';
import { resolve, validate } from '../model_contract.mjs';

const j = async name => JSON.parse(await readFile(new URL(`../${name}`, import.meta.url)));
const originalRequest = await j('examples/current-native-request.json');
const originalContext = await j('examples/current-native-context.json');
const catalog = await j('public/formats.json');
const inventory = await j('examples/native-format-inventory.json');
const schema = await j('schema/native-writer-response.schema.json');
const fixture = () => { const request = structuredClone(originalRequest), context = structuredClone(originalContext); return { request, context, response: mockNativeResponse(request) }; };

test('all 50 current native activities have explicit public format, scope, source context and original pin', () => {
  const { request, context, response } = fixture();
  assert.equal(validateNativeInputs(request, context, catalog), 50);
  validate(response, schema); assert.equal(validateNativeResponse(response, request), 50);
  assert.equal(request.source_provenance.commit, '1e4f4343ed33f1094741f007df43a0773f5e642c');
  assert.equal(request.source_provenance.sha256, inventory.source_sha256);
  const counts = Object.fromEntries(Object.keys(inventory.current_by_kind).map(kind => [kind, request.sequence_blueprint.filter(row => row.native_kind === kind).length]));
  assert.deepEqual(counts, inventory.current_by_kind);
  assert.equal(new Set(request.sequence_blueprint.map(row => row.native_kind)).size, 14);
  assert.ok(['classification', 'single_choice', 'evidence_selection', 'short_explanation', 'learner_question', 'rebuttal', 'integrated_response'].every(format => request.sequence_blueprint.some(row => row.public_format === format)));
});

test('current reading introduction retains timed source-bound captions and raw pending capture provenance', () => {
  const { request, context } = fixture();
  const media = request.course_context.media_assets.find(row => row.id === 'reading-2-intro-video');
  assert.equal(media.src, 'archivist/reading-2-intro.mp4?v=025533ce97');
  assert.equal(media.poster, 'archivist/reading-2-intro-poster.jpg?v=1444a20a01');
  assert.equal(media.original_pointer, '/pages/7/nodes/0/intro_video');
  assert.equal(media.provenance.sha256, inventory.source_sha256);
  assert.equal(media.transcript_status, 'supplied');
  assert.equal(media.captions.length, 9);
  const source = request.course_context.source_assets.find(row => row.id === media.transcript_source_ref);
  assert.deepEqual(source.timed_captions, media.captions);
  assert.deepEqual(source.time_range, [0, 42.42]);
  source.caption_anchors.forEach((anchor, i) => { assert.equal(source.text.slice(anchor.start, anchor.end), media.captions[i].line); assert.deepEqual(anchor.time_range, [media.captions[i].from, media.captions[i].to]); assert.equal(anchor.original_pointer, `/pages/7/nodes/0/intro_video/captions/${i}/line`); });
  assert.equal(source.playback_equivalence, 'not verified');
  assert.equal(request.source_provenance.capture_provenance_as_at_capture.admission_status, 'pending-root-review');
  assert.equal(request.source_provenance.capture_provenance_as_at_capture.default_positive, false);
  assert.equal(request.source_provenance.capture_receipt_state.admission_status, 'pending-root-review');
  assert.equal(media.reported_capture_integrity.evidence.find(row => row.field === 'src').manifest_equal, true);
  assert.equal(media.reported_capture_integrity.evidence.find(row => row.field === 'poster').manifest_equal, null);
  assert.ok(context.native.pages.find(row => row.id === 'reading-2').nodes.some(row => row.type === 'media-introduction' && row.media_ref === media.id));
  const slot = request.sequence_blueprint.find(row => row.page_ref === 'reading-2');
  const phase = request.course_context.lesson_plan.phases.find(row => row.id === slot.phase_ref);
  assert.ok(phase.media_context_refs.includes(media.id));
  assert.ok(phase.source_refs.includes(source.id));
  slot.native_context.required_media_refs = [media.id];
  validateNativeInputs(request, context, catalog);
  for (const mutate of [r => r.course_context.source_assets.find(row => row.id === source.id).timed_captions[0].line += ' Invented.', r => r.course_context.source_assets.find(row => row.id === source.id).caption_anchors[0].time_range[1] += 1, r => r.course_context.media_assets[0].transcript_source_ref = 'missing', r => r.course_context.lesson_plan.phases.find(row => row.id === slot.phase_ref).source_refs = ['reading-1']]) {
    const altered = structuredClone(request); mutate(altered); const c = structuredClone(context); c.native.course_context = structuredClone(altered.course_context); assert.throws(() => validateNativeInputs(altered, c, catalog));
  }
  const response = mockNativeResponse(request);
  const early = response.items.find(row => row.kind === 'reading_mcq');
  early.source_bindings[0] = { source_ref: source.id, quote: media.captions[0].line, field_ref: '/view/options/0', relation: 'A future caption must not bind an earlier phase.' };
  assert.throws(() => validateNativeResponse(response, request), /visible source/);
});

test('missing knowledge, media transcript, phase, maps, constraints, support and counterpart context refuse intake', () => {
  const mutations = [
    r => delete r.course_context.core_knowledge,
    r => delete r.course_context.prerequisites,
    r => delete r.course_context.learner_constraints,
    r => delete r.course_context.prior_exposure,
    r => delete r.course_context.knowledge_map,
    r => r.course_context.knowledge_map[0].content_key_ref = 'missing',
    r => delete r.course_context.pairing_map,
    r => r.sequence_blueprint[0].phase_ref = 'future',
    r => r.sequence_blueprint[0].support = '',
    r => r.course_context.source_assets.filter(s => s.kind === 'media-transcript').forEach(s => delete s.media_ref),
    r => r.course_context.source_assets[1].text = '',
    r => delete r.sequence_blueprint.find(s => s.public_format === 'rebuttal').native_context.counterclaim,
  ];
  for (const mutate of mutations) { const { request, context } = fixture(); mutate(request); context.native.course_context = request.course_context; assert.throws(() => validateNativeInputs(request, context, catalog)); }
});

test('composite rounds, quote branches and reconstruction keep their distinct operations and dependencies', () => {
  const { request, context } = fixture();
  const rounds = request.sequence_blueprint.filter(s => s.native_kind === 'argument_round');
  assert.deepEqual(rounds.map(s => s.public_format), ['learner_question', 'short_explanation', 'rebuttal']);
  assert.deepEqual(rounds.map(s => s.operation), ['ask', 'explain', 'rebut']);
  assert.equal(rounds[1].depends_on[0], rounds[0].id);
  assert.equal(rounds[2].depends_on[0], rounds[1].id);
  const analyses = request.sequence_blueprint.filter(s => s.native_kind === 'quote_analysis');
  assert.deepEqual(analyses.map(s => s.operation), ['paraphrase', 'interpretation', 'paraphrase', 'interpretation']);
  assert.ok(analyses.every(s => s.native_context.quote && s.depends_on.length));
  assert.ok(request.sequence_blueprint.filter(s => s.native_kind === 'rebuild_choice').every(s => s.native_context.surrounding_text.includes('[blank]')));
  for (const change of [r => r.sequence_blueprint.find(s => s.native_kind === 'argument_round').operation = 'generic', r => r.sequence_blueprint.find(s => s.native_kind === 'quote_analysis').operation = 'whole-paragraph', r => r.sequence_blueprint[1].depends_on = [r.sequence_blueprint.at(-1).id]]) { const altered = structuredClone(request); change(altered); const c = structuredClone(context); c.native.course_context = altered.course_context; assert.throws(() => validateNativeInputs(altered, c, catalog)); }
});

test('native contracts reject bad choice keys, classification dimensions, rubric bindings, future evidence and invented quotes', () => {
  const { request, response } = fixture();
  const changes = [
    r => r.items.find(i => i.family === 'single_choice').view.key = [100],
    r => r.items.find(i => i.family === 'classification').view.mapping['entry-1'] = 'unknown',
    r => delete r.items.find(i => i.family === 'classification').view.categories[0].entity,
    r => r.items.find(i => i.family === 'written_response').source_bindings.pop(),
    r => r.items[0].source_bindings[0].source_ref = 'reading-4',
    r => r.items[0].source_bindings[0].quote = 'An invented speech never supplied.',
    r => r.items[0].source_bindings[0].field_ref = '/view/absent',
    r => r.items.find(i => i.family === 'evidence_selection').view.options[0] = 'Paraphrase passed as exact quote',
    r => r.items.find(i => i.family === 'inline_choice').view.blanks[0].key = 9,
    r => r.items.find(i => i.family === 'word_selection').view.word_classes[0] = 'invented-class',
    r => r.items.find(i => i.family === 'written_response').view.rubric.criteria[0].accept_alternative = '',
    r => r.items.reverse(),
  ];
  for (const change of changes) { const altered = structuredClone(response); change(altered); assert.throws(() => validateNativeResponse(altered, request)); }
});

test('self-report and say-back have no correctness rubric and cannot become reasoning measurements', () => {
  const { request, response } = fixture();
  const report = response.items.find(i => i.kind === 'confidence_self_report'), recall = response.items.find(i => i.kind === 'say_back');
  assert.equal(report.view.scoring, 'none'); assert.equal(recall.view.scoring, 'unscored-recall');
  for (const kind of ['confidence_self_report', 'say_back']) { const altered = structuredClone(response); altered.items.find(i => i.kind === kind).view.rubric = {}; assert.throws(() => validateNativeResponse(altered, request)); }
  const changed = structuredClone(response); changed.items.find(i => i.kind === 'say_back').view.statement += ' Invented ending.'; assert.throws(() => validateNativeResponse(changed, request));
});

test('finished native transport preserves source context and pointers while learner output recursively withholds keys', () => {
  const { request, context, response } = fixture();
  const pair = adaptNativeResponse(request, context, response, { kind: 'offline-fixture', model_calls: 0 });
  assert.deepEqual(pair.context.native.course_context, request.course_context);
  assert.deepEqual(pair.context.source.lesson_source, context.source);
  pair.questionSet.items.forEach((item, i) => { assert.deepEqual(resolve(pair.context.native, item.pointer), item.native); assert.deepEqual(item.native.source_context, request.sequence_blueprint[i]); });
  const learner = nativeLearnerPacket(pair.context, pair.questionSet);
  const prohibited = new Set(['key', 'mapping', 'entry_feedback', 'option_feedback', 'correct_feedback', 'sample_answer', 'rubric', 'feedback', 'source_bindings', 'source_context', 'word_classes']);
  const check = value => { if (Array.isArray(value)) value.forEach(check); else if (value && typeof value === 'object') Object.entries(value).forEach(([key, child]) => { assert.equal(prohibited.has(key), false, key); check(child); }); };
  learner.native.pages.forEach(page => page.question_slots.forEach(check));
  assert.ok(learner.native.pages.some(page => page.nodes.some(node => node.type === 'worked-teaching')));
  assert.equal(pair.questionSet.contract, 'question-set native 0.2');
});

test('62-kind inventory is exhaustive and matrix explicitly separates prepared coverage from remaining dispatch only', () => {
  assert.deepEqual(Object.keys(FORMAT_DISPATCH).sort(), Object.keys(inventory.collected_by_kind).sort());
  const coverage = formatCoverage(originalRequest, inventory.collected_by_kind, true);
  assert.equal(coverage.rows.length, 62);
  assert.equal(coverage.rows.filter(r => r.status === 'context-prepared-and-mock-transport-checked').length, 14);
  assert.equal(coverage.rows.filter(r => r.status === 'instruction-only-route-no-current-example').length, 2);
  assert.ok(coverage.rows.every(r => r.actual_model_generation === 'not run' && r.quality === 'unmeasured'));
  assert.equal(formatCoverage(originalRequest, inventory.collected_by_kind).rows.filter(r => r.status === 'context-prepared-writing-and-smoke-pending').length, 14);
});

test('one mocked provider return passes the same writer transport without live model, judge or selection', async () => {
  const { request, context, response } = fixture(); let calls = 0; const journal = new Map();
  const result = await writeSequence({ request, context, schema, config: { model: 'offline', offline_mock: true, structural_repairs: 1 }, messages: [], route: { async complete() { calls++; const value = { choices: [{ message: { content: JSON.stringify(response) } }] }; return { value, raw: JSON.stringify(value) }; } }, journal: async (name, value) => journal.set(name, value) });
  assert.equal(calls, 1); assert.equal(result.trace.model_calls, 0); assert.equal(result.trace.mocked_provider_calls, 1); assert.deepEqual(result.trace.selection, []); assert.deepEqual(result.trace.repairs, []); assert.ok(journal.has('first-attempt.provider.raw.json'));
});

test('real and offline CLIs refuse missing required context before credential/provider access', async () => {
  const directory = new URL(`../.local/test-native-${randomUUID()}/`, import.meta.url);
  await mkdir(directory, { recursive: true }); const { request, context } = fixture(); delete request.course_context.core_knowledge; context.native.course_context = request.course_context;
  const r = new URL('request.json', directory), c = new URL('context.json', directory);
  await writeFile(r, JSON.stringify(request)); await writeFile(c, JSON.stringify(context));
  try {
    const options = { request: r.pathname, context: c.pathname };
    const realHold = await execute({ ...options, envFile: 'a-credential-file-that-must-not-be-read' });
    assert.equal(realHold.status, 'held'); assert.match(realHold.holds[0].detail, /knowledge goals/); assert.equal(realHold.model_calls, 0); assert.equal(realHold.mocked_provider_calls, 0);
    const result = await executeNativeOffline({ ...options, offlineSmoke: true }); assert.equal(result.status, 'held'); assert.equal(result.model_calls, 0); assert.equal(result.mocked_provider_calls, 0); assert.equal(result.items, 0);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('portable Node CLI smoke needs no credentials or sibling repository', async () => {
  const run = promisify(execFile);
  const { stdout } = await run(process.execPath, ['model_generate.mjs', '--offline-smoke', '--request', 'examples/current-native-request.json', '--context', 'examples/current-native-context.json'], { cwd: new URL('..', import.meta.url).pathname, env: { PATH: process.env.PATH } });
  const result = JSON.parse(stdout); assert.equal(result.status, 'mock-transport-checked'); assert.equal(result.items, 50); assert.equal(result.native_kinds, 14); assert.equal(result.model_calls, 0); assert.equal(result.mocked_provider_calls, 1);
});

test('every collected kind has a separate source or synthetic context and a specific missing-prerequisite hold', () => {
  let captured = 0, synthetic = 0;
  for (const kind of Object.keys(FORMAT_DISPATCH)) {
    const sample = kindCase(kind, originalRequest, originalContext);
    validateNativeInputs(sample.request, sample.context, catalog);
    const response = mockNativeResponse(sample.request); validate(response, schema); validateNativeResponse(response, sample.request);
    if (sample.captured_occurrences) captured++; else { synthetic++; assert.match(sample.context_origin, /synthetic.*not-golden/); assert.equal(sample.request.source_provenance.kind, 'synthetic-offline-fixture'); }
    const missing = missingPrerequisiteCase(sample); assert.ok(missing.missing.trim()); assert.throws(() => validateNativeInputs(missing.request, missing.context, catalog), undefined, kind);
  }
  assert.equal(captured, 14); assert.equal(synthetic, 48);
});

test('all kinds reject invalid family keys/rubrics and unexposed source bindings', () => {
  for (const kind of Object.keys(FORMAT_DISPATCH)) {
    const sample = kindCase(kind, originalRequest, originalContext), response = mockNativeResponse(sample.request);
    const item = response.items.find(row => row.kind === kind);
    const altered = structuredClone(response), changed = altered.items.find(row => row.kind === kind);
    const family = changed.family;
    if (['single_choice', 'multiple_select', 'evidence_selection', 'word_selection'].includes(family)) changed.view.key = [999];
    else if (family === 'classification') changed.view.categories[0].entity = 'undeclared-entity';
    else if (['written_response', 'oral_response', 'word_web'].includes(family)) changed.view.rubric.criteria[0].accept_alternative = '';
    else if (family === 'inline_choice') changed.view.blanks[0].key = 999;
    else if (family === 'shared_cloze') changed.view.blanks[1].key = changed.view.blanks[0].key;
    else if (family === 'matching') changed.view.mapping['entry-1'] = 'missing-option';
    else if (family === 'sequence') changed.view.key = ['entry-1', 'entry-1'];
    else if (family === 'say_back') changed.view.statement += ' Invented ending.';
    else changed.view.key = [0];
    assert.throws(() => validateNativeResponse(altered, sample.request), undefined, kind);
    if (item.source_bindings.length) {
      const futureRequest = structuredClone(sample.request), futureResponse = structuredClone(response);
      futureRequest.course_context.source_assets.push({ id: 'UNEXPOSED', text: 'The future source is unseen.', original_pointer: '/synthetic/unexposed', provenance: { kind: 'synthetic-negative-context' } });
      const target = futureResponse.items.find(row => row.kind === kind); target.source_bindings[0].source_ref = 'UNEXPOSED'; target.source_bindings[0].quote = 'The future source is unseen.';
      assert.throws(() => validateNativeResponse(futureResponse, futureRequest), /visible source/, kind);
    }
  }
});

test('EBSR pairing, shared-bank cloze, matching alternatives and oral adapter preserve their distinct contracts', () => {
  const ebsr = kindCase('ebsr_part', originalRequest, originalContext);
  assert.equal(ebsr.request.sequence_blueprint.length, 2);
  for (const change of [r => r.sequence_blueprint[1].native_context.composite_parent = 'unrelated', r => r.sequence_blueprint[1].depends_on = [], r => r.sequence_blueprint[1].native_context.part = 'claim']) {
    const request = structuredClone(ebsr.request); change(request); assert.throws(() => validateNativeInputs(request, ebsr.context, catalog), /EBSR/);
  }
  const cloze = kindCase('cloze', originalRequest, originalContext), clozeResponse = mockNativeResponse(cloze.request);
  assert.equal(cloze.request.sequence_blueprint[0].family, 'shared_cloze'); assert.equal(clozeResponse.items[0].view.bank.length, 2); assert.equal(clozeResponse.items[0].view.reuse_policy, 'single-use');
  const match = kindCase('matching', originalRequest, originalContext), matchResponse = mockNativeResponse(match.request);
  for (const change of [r => delete r.items[0].view.options[0].text, r => r.items[0].source_bindings = r.items[0].source_bindings.filter(row => !row.field_ref.startsWith('/view/options/'))]) { const response = structuredClone(matchResponse); change(response); assert.throws(() => validateNativeResponse(response, match.request)); }
  const oral = kindCase('spoken_response', originalRequest, originalContext); assert.equal(oral.request.sequence_blueprint[0].public_format, 'adapter_extension/oral_response');
  const wrong = structuredClone(oral.request); wrong.sequence_blueprint[0].public_format = 'short_explanation'; assert.throws(() => validateNativeInputs(wrong, oral.context, catalog), /public format/);
});

test('breadth pipeline preserves one mocked provider journal and typed missing-context hold per kind', async () => {
  const files = new Map();
  const coverage = await smokeKindMatrix({ request: originalRequest, context: originalContext, catalog, schema, writeSequence, journalFor: async kind => async (name, value) => { const key = `${kind}/${name}`; assert.equal(files.has(key), false); files.set(key, structuredClone(value)); } });
  assert.equal(coverage.rows.length, 62); assert.equal(coverage.captured_activity_occurrences, 50); assert.equal(coverage.current_captured_kinds, 14); assert.equal(coverage.synthetic_kinds, 48); assert.equal(coverage.missing_context_holds_checked, 62); assert.equal(coverage.model_calls, 0); assert.equal(coverage.mocked_provider_calls, 62);
  coverage.rows.forEach(row => { assert.equal(row.academic_quality, 'unmeasured'); assert.equal(row.actual_model_generation, 'not run'); assert.ok(files.has(`${row.native_kind}/first-attempt.provider.raw.json`)); const hold = files.get(`${row.native_kind}/missing-context-hold.json`); assert.equal(hold.status, 'held'); assert.deepEqual(hold.items, []); const receipt = files.get(`${row.native_kind}/receipt.json`); assert.equal(receipt.missing_context.provider_calls, 0); });
});
