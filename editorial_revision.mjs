#!/usr/bin/env node
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve as absolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { adaptResponse, learnerPacket, StructuralError, validate, validateInputs, validateResponse } from './model_contract.mjs';
import { rotateChoiceDisplays } from './display_rotation.mjs';

const ROOT = dirname(fileURLToPath(import.meta.url));
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const json = async path => JSON.parse(await readFile(path, 'utf8'));
const save = async (path, value) => writeFile(path, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600, flag: 'wx' });

function local(path) {
  const selected = absolute(path);
  if (!selected.startsWith(`${ROOT}/.local/`)) throw new StructuralError('An editorial revision reads an explicit preserved private run inside this repository');
  return selected;
}

function changes(before, after, pointer = '') {
  if (JSON.stringify(before) === JSON.stringify(after)) return [];
  if (before && after && typeof before === 'object' && typeof after === 'object' && Array.isArray(before) === Array.isArray(after)) {
    return [...new Set([...Object.keys(before), ...Object.keys(after)])].flatMap(key => changes(before[key], after[key], `${pointer}/${key.replace(/~/g, '~0').replace(/\//g, '~1')}`));
  }
  return [{ pointer, before: before ?? null, after: after ?? null }];
}

export function reviseSourceCourse(original, request, notes) {
  const response = structuredClone(original);
  const byId = new Map(response.items.map(item => [item.id, item]));
  const sources = new Map(request.course_context.source_assets.map(source => [source.id, source.text]));
  const quotation = (ref, text) => {
    const start = sources.get(ref)?.indexOf(text);
    if (start === undefined || start < 0) throw new StructuralError(`Editorial source span is absent from ${ref}`);
    return sources.get(ref).slice(start, start + text.length);
  };
  const bind = (ref, quote, pointer, relation = 'Source evidence for the stated relationship; not an exhaustive answer key.') => ({ source_ref: ref, quote: quotation(ref, quote), field_ref: pointer, relation });
  for (const [id, edit] of Object.entries(notes.edits)) {
    const item = byId.get(id);
    if (!item) throw new StructuralError('Editorial note refers to an absent item');
    if (id === 'Q06') item.view.option_feedback[edit.feedback_index] = edit.feedback;
    else if (id === 'Q12') { item.view.feedback = edit.feedback; item.view.rubric.combination_rules = edit.combination_rules; }
    else Object.assign(item.view, structuredClone(edit));
  }
  const promotion = quotation('S-PROMOTION', "...He, in good time, must his lieutenant be,\nAnd I, God bless the mark, his Moorship's ancient.");
  const favoritism = quotation('S-PROMOTION', 'Preferment goes by letter and affection,\nAnd not by old gradation');
  const contrast = quotation('S-PROMOTION', '...That never set a squadron in the field...\nAnd I, of whom his eyes had seen the proof\nAt Rhodes, at Cyprus, and on other grounds');
  byId.get('Q05').source_bindings = [
    bind('S-PROMOTION', promotion, '/view/rubric/criteria/0'),
    bind('S-PROMOTION', favoritism, '/view/rubric/criteria/0'),
    bind('S-PROMOTION', contrast, '/view/rubric/criteria/0'),
    bind('S-PROMOTION', contrast, '/view/sample_answer', "Supports the contrast attributed to Iago, not an independently established judgment of Cassio's competence."),
  ];
  const masters = quotation('S-SERVICE', 'We cannot all be masters, nor all masters\nCannot be truly followed.');
  const myself = quotation('S-SERVICE', 'In following him, I follow but myself.');
  const purpose = quotation('S-SERVICE', 'Heaven is my judge, not I for love and duty,\nBut seeming so for my peculiar end.');
  const q06 = byId.get('Q06');
  q06.source_bindings.find(binding => binding.field_ref === '/view/options/2').relation = 'The lines do not state an automatic-reward rule; the option adds a claim outside what Iago says here.';
  q06.source_bindings.push(bind('S-SERVICE', masters, '/view/option_feedback/2', 'Exact displayed wording; these lines do not promise rewards to followers.'), bind('S-SERVICE', myself, '/view/option_feedback/2', "Supports the account of Iago's stated personal purpose."));
  const q08 = byId.get('Q08');
  q08.source_bindings = ['e1', 'e2', 'e3', 'e4'].flatMap((id, i) => {
    const quote = id === 'e2' ? myself : purpose;
    return [bind('S-SERVICE', quote, `/view/entries/${i}/text`), bind('S-SERVICE', quote, `/view/entry_feedback/${id}`)];
  });
  const necessity = quotation('S-FLAG', 'Yet, for necessity of present life,\nI must show out a flag and sign of love—\nWhich is indeed but sign.');
  byId.get('Q12').source_bindings.push(bind('S-FLAG', necessity, '/view/rubric/criteria/1', 'Supports the necessity alternative already permitted by the criterion.'), bind('S-FLAG', necessity, '/view/rubric/combination_rules', 'The second point accepts the explained necessity link, alongside the hatred alternative.'));
  const identity = quotation('S-SERVICE', 'I am not what I am.');
  const flag = quotation('S-FLAG', 'I must show out a flag and sign of love—\nWhich is indeed but sign.');
  byId.get('Q13').source_bindings = [
    bind('S-SERVICE', identity, '/view/rubric/criteria/0', 'One available quotation, not the sole accepted evidence or interpretation.'),
    bind('S-FLAG', flag, '/view/rubric/criteria/0', 'Another available quotation; its relevance depends on the learner’s actual interpretation.'),
    bind('S-SERVICE', purpose, '/view/rubric/criteria/1', 'Illustrates an interpretable relation between displayed duty and admitted purpose; the criterion accepts other supported readings.'),
    bind('S-SERVICE', identity, '/view/sample_answer', 'Exact evidence used by the illustrative answer.'),
  ];
  const q14 = byId.get('Q14');
  q14.source_bindings = [
    bind('S-FLAG', flag, '/view/rubric/criteria/0'),
    bind('S-SERVICE', identity, '/view/rubric/criteria/0'),
    bind('S-FLAG', flag, '/view/rubric/criteria/1', 'The illustrative words show and but are in this quotation; other meaningful word pairs from supported quotations count.'),
    bind('S-FLAG', flag, '/view/rubric/criteria/2', 'Evidence can support the closing claim. The requirement to close the paragraph is declared separately in the original course policy.'),
    bind('S-FLAG', flag, '/view/sample_answer', 'Exact quotation used in the illustrative five-author-sentence response.'),
  ];
  q14.view.rubric.policy_bindings = [{ policy_ref: '/native/sequence_blueprint/13/support', policy_text: request.sequence_blueprint[13].support, field_refs: ['/view/prompt', '/view/rubric/format_condition', '/view/rubric/criteria/2'], authority: 'Original proposed Q14 course-placement policy, not a claim made by the dramatic text or a universal assessment rule.' }];
  return { response, edits: changes(original, response) };
}

export async function executeRevision(sourceRun) {
  const source = local(sourceRun);
  const originalReceiptBytes = await readFile(absolute(source, 'receipt.json'));
  const previous = JSON.parse(originalReceiptBytes);
  for (const [name, hash] of Object.entries(previous.transport_hashes)) if (digest(await readFile(absolute(source, name))) !== hash) throw new StructuralError('Original finished transport changed before editorial revision');
  const preservedWriter = await json(absolute(source, 'writer-response.json'));
  const original = previous.display_rotation?.length ? rotateChoiceDisplays(preservedWriter).response : preservedWriter;
  const originalQuestions = await json(absolute(source, 'question-set.json'));
  original.items.forEach((item, i) => { if (JSON.stringify(item.view) !== JSON.stringify(originalQuestions.items[i].view)) throw new StructuralError('Preserved writer content differs from the original finished view'); });
  const requestPath = absolute(ROOT, 'examples/othello-1-1-request.json');
  const contextPath = absolute(ROOT, 'examples/othello-1-1-context.json');
  if (digest(await readFile(requestPath)) !== previous.request_sha256 || digest(await readFile(contextPath)) !== previous.source_context_sha256) throw new StructuralError('Original neutral request or source context changed');
  const request = await json(requestPath), context = await json(contextPath);
  const requestSchema = await json(absolute(ROOT, 'schema/generator-request.schema.json'));
  const contextSchema = await json(absolute(ROOT, 'schema/lesson-context.schema.json'));
  const responseSchema = await json(absolute(ROOT, 'schema/writer-response.schema.json'));
  validateInputs(request, context, requestSchema, contextSchema);
  const notes = await json(absolute(ROOT, 'editorial-revision.json'));
  const revised = reviseSourceCourse(original, request, notes);
  validateResponse(revised.response, request, responseSchema);
  const displayed = rotateChoiceDisplays(revised.response);
  validateResponse(displayed.response, request, responseSchema);
  const run = `editorial-revision-1-${randomUUID().slice(0, 8)}`;
  const directory = absolute(ROOT, '.local/editorial-revisions', run);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await save(absolute(directory, 'source-writer-response.json'), original);
  await save(absolute(directory, 'editorial-notes.json'), notes);
  await save(absolute(directory, 'editorial-changes.json'), { authority: notes.authority, changes: revised.edits, model_calls_added: 0, quality_scores: [], candidate_selection: [] });
  await save(absolute(directory, 'editorial-response-before-display.json'), revised.response);
  await save(absolute(directory, 'display-rotation.json'), { policy: displayed.policy, rotations: displayed.rotations });
  await save(absolute(directory, 'writer-response.json'), displayed.response);
  const { calls, transport_hashes: ignoredHashes, status: ignoredStatus, items: ignoredItems, ...originMetadata } = previous;
  const provenance = { ...originMetadata, origin_run: previous.run, origin_receipt_sha256: digest(originalReceiptBytes), origin_transport_hashes: previous.transport_hashes, run, editorial_revision_count: 1, editorial_model_calls_added: 0, total_model_calls: previous.model_calls, editorial_authority: notes.authority, display_rotation: displayed.rotations, writer_response_sha256: digest(JSON.stringify(displayed.response)), original_writer_response_sha256: previous.writer_response_sha256, revision_code_sha256: {}, academic_quality: 'Pending independent review; revised from ordinary source/course notes, no self-judge or scored selection.' };
  for (const name of ['editorial_revision.mjs', 'editorial-revision.json', 'display_rotation.mjs']) provenance.revision_code_sha256[name] = digest(await readFile(absolute(ROOT, name)));
  const pair = adaptResponse(request, context, displayed.response, provenance);
  pair.questionSet.made_by.note = 'One preserved writer attempt and its recorded structural repair/normalization, followed by one ordinary source/course editorial revision and deterministic display rotation. No editorial model or quality-judge call.';
  validate(pair.context, contextSchema);
  validate(pair.questionSet, await json(absolute(ROOT, 'schema/question-set.schema.json')));
  await save(absolute(directory, 'lesson-context.json'), pair.context);
  await save(absolute(directory, 'question-set.json'), pair.questionSet);
  await save(absolute(directory, 'learner.json'), learnerPacket(pair.context, pair.questionSet));
  const receipt = { ...provenance, calls, status: 'prepared-for-review', items: displayed.response.items.length, edited_item_ids: Object.keys(notes.edits), editorial_model_calls: 0, transport_hashes: {} };
  for (const name of ['lesson-context.json', 'question-set.json', 'learner.json']) receipt.transport_hashes[name] = digest(await readFile(absolute(directory, name)));
  await save(absolute(directory, 'receipt.json'), receipt);
  for (const [name, hash] of Object.entries(previous.transport_hashes)) if (digest(await readFile(absolute(source, name))) !== hash) throw new StructuralError('Original transport changed during editorial revision');
  return { status: receipt.status, items: receipt.items, editorial_model_calls_added: 0, cumulative_model_calls: receipt.model_calls, directory };
}

if (process.argv[1] && absolute(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.length !== 2 || args[0] !== '--source-run') { console.error('Usage: node editorial_revision.mjs --source-run .local/model-runs/RUN/FINISHED_RUN'); process.exitCode = 1; }
  else executeRevision(args[1]).then(result => console.log(JSON.stringify(result, null, 2))).catch(error => { console.error(error.message); process.exitCode = 1; });
}
