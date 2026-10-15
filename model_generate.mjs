#!/usr/bin/env node
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { dirname, resolve as absolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { connect, credentials } from './gateway.mjs';
import { adaptResponse, learnerPacket, StructuralError, validate, validateInputs, validateResponse } from './model_contract.mjs';
import { rotateChoiceDisplays } from './display_rotation.mjs';
import { NATIVE_PROTOCOL, adaptNativeResponse, nativeLearnerPacket, nativeWriterMessages, validateNativeInputs, validateNativeResponse } from './native_formats.mjs';
import { formatCoverage, mockNativeResponse, mockTextResponse } from './native_smoke.mjs';
import { smokeKindMatrix } from './native_breadth.mjs';
import { compileContextPlan, checkResponseConstraints, contextConsumptionAudit } from './context_intake.mjs';
import { INSTRUCTIONAL_WRITER_RULES } from './instructional_plan.mjs';

const ROOT = dirname(fileURLToPath(import.meta.url));
export const VERSION = 'source-grounded-writer/0.2';
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const json = async path => JSON.parse(await readFile(path, 'utf8'));
const save = async (path, value) => writeFile(path, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600, flag: 'wx' });

function localPath(path, label) {
  const selected = absolute(path);
  if (!selected.startsWith(`${ROOT}/`)) throw new StructuralError(`${label} must be an explicit file or directory inside this repository`);
  return selected;
}

export function normalizeTransport(content) {
  if (typeof content !== 'string') throw new StructuralError('Writer did not return text content');
  const operations = [];
  let text = content.trim();
  const fenced = text.match(/^```(?:json)?\s*\n([\s\S]*?)\n```$/);
  if (fenced) { text = fenced[1]; operations.push({ operation: 'remove-json-code-fence', path: '', meaning_changed: false }); }
  const response = JSON.parse(text);
  if (Array.isArray(response.items)) response.items.forEach((item, i) => {
    if (['reading_mcq', 'key_term_mcq'].includes(item.kind) && Number.isInteger(item.view?.key)) {
      operations.push({ operation: 'scalar-choice-key-to-array', path: `/items/${i}/view/key`, from: item.view.key, to: [item.view.key], meaning_changed: false });
      item.view.key = [item.view.key];
    }
  });
  return { response, operations };
}

function cost(value) { return value.cost ?? value.usage?.cost ?? value.usage?.costInUSD ?? null; }

function instructions() {
  return `Write a complete, ordered English literature lesson question sequence from the supplied public course context. Return only one JSON object matching writer_response_schema. Write each declared slot once in order; do not choose, score or judge candidate quality. You may return a typed held response with no items if the supplied source makes a task unanswerable.

Use source_assets[].text as the sole factual and quotation authority. The supplied lesson-context is public instruction, not a bank of questions to copy. Treat dramatic speech as what a named speaker claims, not an established impartial fact. Keep rival interpretations open where supported. Do not invent a new passage, event, production detail or learner history. Follow the declared lesson plan, targets, support and exposure order. Full synthesis is on the same taught text; do not call it transfer or independent mastery. Different questions should require distinct useful work across context, relationships, promotion grievance, mockery, professed motives, service/self-interest, appearance/reality, Brabantio action, later confession and close language analysis. Use Praveen format shapes solely for presentation. Learner wording should be concise and understandable to the declared age. A distractor should be plausible from a specific source detail, have one clear reason it fails this question, and avoid invented trivia.

Each item has exactly id,kind,view,source_bindings. Use the slot ID from position.id and a kind from that slot's formats. All learner-visible task information belongs in view. Attach evidence to every material factual answer, distractor explanation, feedback and rubric requirement with source_bindings entries {source_ref,quote,field_ref,relation}. quote must be an EXACT substring of a visible source asset text, preserving punctuation and typography. field_ref is a resolving JSON pointer within this item, such as /view/options/0. relation explains whether the quotation supports, contradicts or limits the field; wrong options are not source-endorsed facts. Use only phase.source_refs visible to that slot.

For reading_mcq/key_term_mcq, view has stem:string, options:3-5 distinct strings, key:[one zero-based integer], option_feedback:one nonempty source-backed explanation per option including the correct one, correct_feedback:string. Bind each /view/options/N separately, plus explanatory fields.
For classify, view has prompt:string, categories:[{id,label,description}], entries:[{id,text}], mapping:{entryID:categoryID}, entry_feedback:{entryID:source-backed reason}, correct_feedback:string. State one category per entry and no assumed quotas. Keep category definitions sufficient to distinguish entries.
For evidence_select, view has prompt:string, claim:string, candidates:3-5 exact source quotations, key:[all and only supported zero-based positions], selection_rule:string, option_feedback:[source-backed explanation per candidate], correct_feedback:string. Include relevant and irrelevant evidence. Bind /view/candidates/N with quote equal to that candidate. Be explicit about what each quoted line can prove in context; avoid paraphrases presented as quotations.
For open_check/open_prompt, view has prompt:string, response_mode:"written", suggested_length:string, sample_answer:string, feedback:string, rubric:{id,criteria:[{id,requirement,points,full_credit,partial_credit,no_credit,accept_alternative}],allocation:string,combination_rules:string,status:string}. points is 1 or 2; partial_credit is required for 2 points. Requirements must name the exact knowledge or inferential relation the response needs. Distinguish a quotation from its explained relevance. Explain additive points and how contradictions, missing evidence, unsupported assertions and defensible alternatives are handled. Do not award semantic credit through keyword matching or response length. Each /view/rubric/criteria/N needs its own source binding. sample_answer is an illustrative source-supported answer, not the only accepted wording. Keep the rubric a proposed marking illustration, not a measured learning standard.

Feedback is teacher material and is withheld until the whole sequence is complete. The supplied worked teaching exposures remain visible at the specified points; account for their support without inventing independent-performance claims. Preserve all known constraints and unresolved assumptions; do not silently settle them. Do not address an evaluator, assign quality scores or call any tools.`;
}

export function writerMessages(request, context, schema, publicMethods, publicFormats) {
  return [
    { role: 'system', content: `${instructions()}\n\n${INSTRUCTIONAL_WRITER_RULES}` },
    { role: 'user', content: JSON.stringify({ request, lesson_context: context, resolved_slot_contexts: compileContextPlan(request, context), writer_response_schema: schema, public_methods: publicMethods.cards.map(({ id, claim, actions, limits }) => ({ id, claim, actions, limits })), presentation_formats: publicFormats.formats.map(({ id, required_payload, teacher_key, conditions }) => ({ id, required_payload, teacher_key, conditions })) }) },
  ];
}

export async function writeSequence({ request, context, schema, config, messages, route, journal }) {
  const trace = { generator_version: VERSION, writer_attempts: 1, candidate_count: 1, model_calls: 0, first_attempt: null, repairs: [], transport_normalizations: [], selection: [], refusals: [], quality_status: 'unmeasured; no evaluator or self-judge call', requested_model: config.model, decoding: { temperature: config.temperature, max_tokens: config.max_tokens }, calls: [] };
  let currentMessages = messages;
  let response;
  for (let attempt = 0; attempt <= config.structural_repairs; attempt++) {
    const name = attempt === 0 ? 'first-attempt' : `structural-repair-${attempt}`;
    const body = { model: config.model, temperature: config.temperature, max_tokens: config.max_tokens, messages: currentMessages, stream: false };
    await journal(`${name}.request.json`, body);
    if (config.offline_mock) trace.mocked_provider_calls = (trace.mocked_provider_calls ?? 0) + 1;
    else trace.model_calls++;
    let completion;
    try { completion = await route.complete(body); }
    catch (error) {
      trace.failure = error.message;
      await journal('trace.json', trace);
      throw error;
    }
    await journal(`${name}.provider.json`, completion.value);
    await journal(`${name}.provider.raw.json`, completion.raw, { raw: true });
    const choice = completion.value.choices?.[0];
    const content = choice?.message?.content;
    const call = { name, requested_model: config.model, reported_model: completion.value.model ?? null, finish_reason: choice?.finish_reason ?? null, usage: completion.value.usage ?? null, reported_cost: cost(completion.value), cost_status: cost(completion.value) === null ? 'not reported by gateway' : 'gateway reported', provider_response_sha256: sha256(completion.raw) };
    trace.calls.push(call);
    if (attempt === 0) trace.first_attempt = call; else trace.repairs.push({ ...call, allowed_scope: 'JSON shape, identifier/reference integrity and exact quote binding only' });
    if (choice?.message?.refusal) {
      trace.refusals.push({ attempt: name, refusal: choice.message.refusal });
      response = { protocol: request.protocol, request_id: request.request_id, status: 'held', holds: [{ code: 'writer-refusal', detail: choice.message.refusal }], items: [] };
      break;
    }
    await journal(`${name}.content.json`, { content: content ?? null });
    try {
      const normalized = normalizeTransport(content);
      response = normalized.response;
      if (normalized.operations.length) trace.transport_normalizations.push({ attempt: name, operations: normalized.operations, allowed_scope: 'Unwrap a JSON code fence and represent the same scalar choice index as a one-element array; no content or key position changes.' });
      if (request.protocol === NATIVE_PROTOCOL) { validate(response, schema, 'native writer response'); validateNativeResponse(response, request); }
      else { validateResponse(response, request, schema); if (response.status === 'prepared-for-review') { const plan = compileContextPlan(request, context); response.items.forEach((item, i) => checkResponseConstraints(item.view, plan.slots[i])); } }
      if (response.status === 'held') trace.refusals.push({ attempt: name, holds: response.holds });
      break;
    } catch (error) {
      if (!(error instanceof StructuralError || error instanceof SyntaxError)) throw error;
      call.structural_error = error.message;
      if (attempt === config.structural_repairs) {
        response = { protocol: request.protocol, request_id: request.request_id, status: 'held', holds: [{ code: 'structural-validation', detail: error.message }], items: [] };
        trace.refusals.push({ attempt: name, holds: response.holds });
      } else {
        currentMessages = [...messages, { role: 'assistant', content: typeof content === 'string' ? content : JSON.stringify(content ?? null) }, { role: 'user', content: `The response failed a deterministic structural check: ${error.message}. Repair only this structural failure and any same-kind failures in the response. Preserve substantive questions, keys, interpretations and feedback wording wherever structure permits. No quality judgment or new candidate selection is authorized. Return the complete corrected JSON object only.` }];
      }
    }
  }
  trace.status = response.status;
  await journal('trace.json', trace);
  return { response, trace };
}

async function verifyPublicPins() {
  const manifest = await json(absolute(ROOT, 'public/knowledge-manifest.json'));
  for (const row of manifest.files) {
    if (sha256(await readFile(absolute(ROOT, row.path))) !== row.sha256) throw new StructuralError('A pinned public snapshot differs from its manifest');
  }
  return manifest;
}

export async function execute(options) {
  if (options.contextCoverage) return executeContextCoverage(options);
  if (options.offlineKindMatrix) return executeNativeKindMatrix(options);
  if (options.offlineSmoke || options.prepareNative) return executeNativeOffline(options);
  const configPath = localPath(options.config ?? absolute(ROOT, 'model-config.json'), 'Config');
  const config = await json(configPath);
  if (!Number.isInteger(config.structural_repairs) || config.structural_repairs < 0 || config.structural_repairs > 1) throw new StructuralError('Structural repair count must be zero or one');
  // Validate required context before credentials, gateway discovery or paid calls.
  let requestBytes, contextBytes, request, context, requestSchema, contextSchema, responseSchema, methods, formats;
  if (!options.listModels) {
    requestBytes = await readFile(localPath(options.request, 'Request')); contextBytes = await readFile(localPath(options.context, 'Context'));
    request = JSON.parse(requestBytes); context = JSON.parse(contextBytes);
    requestSchema = await json(absolute(ROOT, 'schema/contextual-generator-request.schema.json')); contextSchema = await json(absolute(ROOT, 'schema/lesson-context.schema.json'));
    responseSchema = await json(absolute(ROOT, request.protocol === NATIVE_PROTOCOL ? 'schema/native-writer-response.schema.json' : 'schema/writer-response.schema.json'));
    formats = await json(absolute(ROOT, 'public/formats.json')); methods = await json(absolute(ROOT, 'public/generation-standard.json'));
    if (request.protocol === NATIVE_PROTOCOL) {
      try { validateNativeInputs(request, context, formats); }
      catch (error) { if (!(error instanceof StructuralError)) throw error; return executeNativeOffline({ request: options.request, context: options.context, prepareNative: true }); }
    }
    else {
      try { validateInputs(request, context, requestSchema, contextSchema); compileContextPlan(request, context); }
      catch (error) {
        if (!(error instanceof StructuralError)) throw error;
        const directory = absolute(ROOT, '.local/context-holds', `${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}`);
        await mkdir(directory, { recursive: true, mode: 0o700 });
        const receipt = { kind: 'context-intake-hold', status: 'held', model_calls: 0, provider_calls: 0, items: 0, holds: [{ code: 'missing-required-instructional-context', detail: error.message }], request_sha256: sha256(requestBytes), context_sha256: sha256(contextBytes), academic_quality: 'unmeasured' };
        await save(absolute(directory, 'source-request.json'), request); await save(absolute(directory, 'source-context.json'), context); await save(absolute(directory, 'receipt.json'), receipt);
        return { ...receipt, directory };
      }
    }
    await verifyPublicPins();
  }
  const route = await connect(config, await credentials(options.envFile));
  const models = await route.models();
  if (options.listModels) return { available_models: models.map(({ id, owned_by }) => ({ id, owned_by })), model_calls: 0 };
  if (!models.some(model => model.id === config.model)) throw new StructuralError('Configured writer alias is not advertised by the gateway');
  if (/bedrock|\baws\b/i.test(config.model)) throw new StructuralError('Configured writer route is excluded');
  if (!config.route_evidence || config.route_evidence.model !== config.model || config.route_evidence.aws_bedrock !== false) throw new StructuralError('Explicit read-only non-Bedrock route evidence is required in model-config.json');
  const advertised = models.find(model => model.id === config.model);
  if (advertised.owned_by === 'virtual-model' || advertised.owned_by !== config.route_evidence.owned_by) throw new StructuralError('Configured direct provider evidence differs from current gateway metadata');
  const run = `${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}`;
  const directory = localPath(absolute(ROOT, config.run_root, run), 'Run directory');
  if (!directory.startsWith(`${ROOT}/.local/`)) throw new StructuralError('Model journals must stay inside private .local/');
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const journal = (name, value, options) => options?.raw ? writeFile(absolute(directory, name), value, { mode: 0o600, flag: 'wx' }) : save(absolute(directory, name), value);
  await journal('source-request.json', request);
  await journal('source-context.json', context);
  await journal('config.json', config);
  await journal('models.json', { checked_at: new Date().toISOString(), models: models.map(({ id, owned_by }) => ({ id, owned_by })) });
  const nativeExtension = request.protocol === NATIVE_PROTOCOL;
  const messages = nativeExtension ? nativeWriterMessages(request, context, responseSchema, methods, formats) : writerMessages(request, context, responseSchema, methods, formats);
  const { response, trace } = await writeSequence({ request, context, schema: responseSchema, config, messages, route, journal });
  await journal('writer-response.json', response);
  const displayed = response.status === 'prepared-for-review' ? rotateChoiceDisplays(response) : { response, rotations: [] };
  await journal('display-rotation.json', { rotations: displayed.rotations, meaning_changed: false, model_calls_added: 0 });
  await journal('display-response.json', displayed.response);
  const codeHashes = {};
  for (const name of ['model_generate.mjs', 'model_contract.mjs', 'native_formats.mjs', 'context_intake.mjs', 'instructional_plan.mjs', 'schema/instructional-plan.schema.json', 'gateway.mjs', 'display_rotation.mjs']) codeHashes[name] = sha256(await readFile(absolute(ROOT, name)));
  const provenance = { kind: 'generator-run', run, generator_version: VERSION, request_sha256: sha256(requestBytes), source_context_sha256: sha256(contextBytes), config_sha256: sha256(await readFile(configPath)), code_sha256: codeHashes, requested_model: config.model, reported_models: trace.calls.map(call => call.reported_model), route_evidence: config.route_evidence, model_calls: trace.model_calls, first_attempt_count: 1, model_structural_repair_count: trace.repairs.length, deterministic_transport_repair_count: trace.transport_normalizations.length, structural_repair_count: trace.repairs.length + trace.transport_normalizations.length, candidate_count: 1, writer_response_sha256: sha256(JSON.stringify(response)), display_response_sha256: sha256(JSON.stringify(displayed.response)), display_rotation: displayed.rotations, knowledge_baseline_sha256: sha256(await readFile(absolute(ROOT, 'public/knowledge-baseline.json'))), source_comparison: 'Local public pinned bytes checked; original external source pin preserved, no new external Git comparison ran.', academic_quality: 'pending independent review', learner_outcome: 'unmeasured' };
  const receipt = { ...provenance, writer_family: config.writer_family, status: response.status, items: response.items.length, calls: trace.calls.map(({ name, requested_model, reported_model, finish_reason, usage, reported_cost, cost_status }) => ({ name, requested_model, reported_model, finish_reason, usage, reported_cost, cost_status })), transport_hashes: {} };
  if (response.status === 'prepared-for-review') {
    const { context: finishedContext, questionSet } = nativeExtension ? adaptNativeResponse(request, context, displayed.response, provenance) : adaptResponse(request, context, displayed.response, provenance);
    if (!nativeExtension) { validate(finishedContext, contextSchema); validate(questionSet, await json(absolute(ROOT, 'schema/question-set.schema.json'))); }
    await journal('lesson-context.json', finishedContext);
    await journal('question-set.json', questionSet);
    await journal('learner.json', nativeExtension ? nativeLearnerPacket(finishedContext, questionSet) : learnerPacket(finishedContext, questionSet));
    for (const name of ['lesson-context.json', 'question-set.json', 'learner.json']) receipt.transport_hashes[name] = sha256(await readFile(absolute(directory, name)));
  }
  await journal('receipt.json', receipt);
  return { status: response.status, items: response.items.length, model_calls: trace.model_calls, structural_repairs: trace.repairs.length, directory, receipt: absolute(directory, 'receipt.json') };
}

export async function executeContextCoverage(options) {
  if (options.envFile || options.listModels || options.finalizeRun || options.config) throw new StructuralError('Offline context coverage accepts only explicit request and context files');
  const request = await json(localPath(options.request, 'Request')), context = await json(localPath(options.context, 'Context'));
  await verifyPublicPins();
  const report = contextConsumptionAudit(request, context, { validateInputs: validateNativeInputs, validateResponse: validateNativeResponse, mockResponse: mockNativeResponse, catalog: await json(absolute(ROOT, 'public/formats.json')) });
  const legacy = compileContextPlan(await json(absolute(ROOT, 'examples/othello-1-1-request.json')), await json(absolute(ROOT, 'examples/othello-1-1-context.json')));
  report.public_protocol_example = { slots_checked: legacy.slots.length, coverage: legacy.coverage, qualification: 'Historical public proposal shape checked locally; original source pin retained and no questions/model calls added.' };
  report.code_sha256 = {};
  for (const name of ['context_intake.mjs', 'native_formats.mjs', 'native_smoke.mjs', 'model_generate.mjs']) report.code_sha256[name] = sha256(await readFile(absolute(ROOT, name)));
  const directory = absolute(ROOT, '.local/B1011'); await mkdir(directory, { recursive: true, mode: 0o700 });
  const destination = absolute(directory, 'context-coverage.json'), temporary = absolute(directory, `context-coverage-${randomUUID()}.json`);
  await save(temporary, report);
  try { await rename(destination, absolute(directory, `context-coverage-previous-${randomUUID()}.json`)); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  await rename(temporary, destination);
  return { status: report.status, slots_checked: report.slots_checked, regression_cases_checked: report.regression_cases_checked, model_calls: 0, coverage: destination, coverage_sha256: sha256(await readFile(destination)), semantic_quality: 'unmeasured' };
}

export async function executeNativeKindMatrix(options) {
  if (options.envFile || options.listModels || options.finalizeRun || options.config) throw new StructuralError('Offline kind matrix accepts only explicit request and context files');
  const requestBytes = await readFile(localPath(options.request, 'Request')), contextBytes = await readFile(localPath(options.context, 'Context'));
  const request = JSON.parse(requestBytes), context = JSON.parse(contextBytes);
  await verifyPublicPins();
  const catalog = await json(absolute(ROOT, 'public/formats.json')), schema = await json(absolute(ROOT, 'schema/native-writer-response.schema.json'));
  validateNativeInputs(request, context, catalog);
  const directory = absolute(ROOT, '.local/native-kind-matrices', `${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}`);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const journalFor = async kind => {
    const destination = absolute(directory, kind); await mkdir(destination, { mode: 0o700 });
    return (name, value, opts) => opts?.raw ? writeFile(absolute(destination, name), value, { mode: 0o600, flag: 'wx' }) : save(absolute(destination, name), value);
  };
  const coverage = await smokeKindMatrix({ request, context, catalog, schema, writeSequence, journalFor });
  await save(absolute(directory, 'coverage.json'), coverage);
  const { rows, ...summary } = coverage;
  const codeHashes = {};
  for (const name of ['model_generate.mjs', 'model_contract.mjs', 'native_formats.mjs', 'context_intake.mjs', 'instructional_plan.mjs', 'schema/instructional-plan.schema.json', 'native_smoke.mjs', 'native_breadth.mjs']) codeHashes[name] = sha256(await readFile(absolute(ROOT, name)));
  const receipt = { ...summary, input_hashes: { request: sha256(requestBytes), context: sha256(contextBytes) }, code_sha256: codeHashes, coverage_sha256: sha256(await readFile(absolute(directory, 'coverage.json'))), quality: 'unmeasured', independent_quality_labels: 0, original_captured_runs_preserved: true };
  await save(absolute(directory, 'receipt.json'), receipt);
  return { ...receipt, directory, coverage: absolute(directory, 'coverage.json'), receipt: absolute(directory, 'receipt.json') };
}

export async function executeNativeOffline(options) {
  if (options.envFile || options.listModels || options.finalizeRun) throw new StructuralError('Offline native preparation/smoke accepts only request and context inputs');
  const requestBytes = await readFile(localPath(options.request, 'Request')), contextBytes = await readFile(localPath(options.context, 'Context'));
  const request = JSON.parse(requestBytes), context = JSON.parse(contextBytes);
  const nativeExtension = request.protocol === NATIVE_PROTOCOL;
  const directory = absolute(ROOT, '.local/native-runs', `${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}`);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const journal = (name, value, opts) => opts?.raw ? writeFile(absolute(directory, name), value, { mode: 0o600, flag: 'wx' }) : save(absolute(directory, name), value);
  await journal('source-request.json', request); await journal('source-context.json', context);
  await journal('course-request.json', requestBytes, { raw: true });
  await journal('course-source-packet.json', contextBytes, { raw: true });
  await verifyPublicPins();
  const methods = await json(absolute(ROOT, 'public/generation-standard.json')), formats = await json(absolute(ROOT, 'public/formats.json'));
  try {
    if (nativeExtension) validateNativeInputs(request, context, formats);
    else { validateInputs(request, context, await json(absolute(ROOT, 'schema/contextual-generator-request.schema.json')), await json(absolute(ROOT, 'schema/lesson-context.schema.json'))); compileContextPlan(request, context); }
  }
  catch (error) {
    const receipt = { status: 'held', model_calls: 0, mocked_provider_calls: 0, holds: [{ code: 'missing-required-context', detail: error.message }], items: 0, academic_quality: 'unmeasured' };
    await journal('receipt.json', receipt); return { ...receipt, directory };
  }
  const schema = await json(absolute(ROOT, nativeExtension ? 'schema/native-writer-response.schema.json' : 'schema/writer-response.schema.json'));
  await journal('writer-response-schema.json', schema);
  const counts = (await json(absolute(ROOT, 'examples/native-format-inventory.json'))).collected_by_kind;
  const coverage = nativeExtension ? formatCoverage(request, counts) : { version: 'text-context-coverage/0.1', items: request.sequence_blueprint.length, response_kinds: [...new Set(request.sequence_blueprint.flatMap(slot => slot.formats))], source: context.source, qualification: 'Explicit offline text fixture; source/purpose/expected-evidence contracts only. Academic quality unmeasured.' };
  if (options.prepareNative && !options.offlineSmoke) {
    await journal('coverage.json', coverage);
    const receipt = { status: 'writer-request-prepared', model_calls: 0, mocked_provider_calls: 0, planned_items: request.sequence_blueprint.length, academic_quality: 'pending later independent evaluation', source: request.source_provenance, input_hashes: { request: sha256(requestBytes), context: sha256(contextBytes) } };
    await journal('receipt.json', receipt); return { ...receipt, directory };
  }
  const response = nativeExtension ? mockNativeResponse(request) : mockTextResponse(request);
  const route = { async complete() { const value = { model: 'offline-mocked-provider', choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(response) } }] }; return { value, raw: JSON.stringify(value) }; } };
  const result = await writeSequence({ request, context, schema, config: { model: 'offline-mocked-provider', offline_mock: true, structural_repairs: 1 }, messages: nativeExtension ? nativeWriterMessages(request, context, schema, methods, formats) : writerMessages(request, context, schema, methods, formats), route, journal });
  const provenance = { kind: 'offline-mocked-provider', model_calls: 0, mocked_provider_calls: result.trace.mocked_provider_calls, academic_quality: 'unmeasured; synthetic transport fixture, not a generated teaching result', learner_outcome: 'unmeasured', request_sha256: sha256(requestBytes), context_sha256: sha256(contextBytes), source: request.source_provenance ?? context.source };
  if (result.response.status === 'held') { const receipt = { ...provenance, status: 'held', items: 0, holds: result.response.holds }; await journal('receipt.json', receipt); return { ...receipt, directory }; }
  const { context: finished, questionSet } = nativeExtension ? adaptNativeResponse(request, context, result.response, provenance) : adaptResponse(request, context, result.response, provenance);
  await journal('coverage.json', nativeExtension ? formatCoverage(request, counts, true) : coverage);
  await journal('writer-response.json', result.response); await journal('lesson-context.json', finished); await journal('question-set.json', questionSet); await journal('learner.json', nativeExtension ? nativeLearnerPacket(finished, questionSet) : learnerPacket(finished, questionSet));
  const receipt = { ...provenance, status: 'mock-transport-checked', items: result.response.items.length, ...(nativeExtension ? { native_kinds: coverage.current_native_kinds } : { response_kinds: coverage.response_kinds }), structural_repairs: result.trace.repairs.length, instructional_plan: { id: result.response.sequence_plan.plan_id, context_sha256: result.response.sequence_plan.context_sha256, lesson: result.response.sequence_plan.lesson, goal_authority: result.response.sequence_plan.goal_authority, qualification: 'Declarations and output bindings only; semantic quality and learner outcomes unmeasured.' }, coverage: 'coverage.json', transport_hashes: {} };
  for (const name of ['lesson-context.json', 'question-set.json', 'learner.json']) receipt.transport_hashes[name] = sha256(await readFile(absolute(directory, name)));
  await journal('receipt.json', receipt); return { ...receipt, directory };
}

export async function finalizeRecordedRun(runDirectory) {
  const original = localPath(runDirectory, 'Recorded run');
  if (!original.startsWith(`${ROOT}/.local/model-runs/`)) throw new StructuralError('Finalization reads only an explicit recorded model run');
  const previous = await json(absolute(original, 'receipt.json'));
  const trace = await json(absolute(original, 'trace.json'));
  const request = await json(absolute(original, 'source-request.json'));
  const context = await json(absolute(original, 'source-context.json'));
  const attempt = trace.calls.at(-1)?.name;
  if (!attempt || !/^(first-attempt|structural-repair-1)$/.test(attempt)) throw new StructuralError('No supported preserved writer return exists');
  const normalized = normalizeTransport((await json(absolute(original, `${attempt}.content.json`))).content);
  validateInputs(request, context, await json(absolute(ROOT, 'schema/contextual-generator-request.schema.json')), await json(absolute(ROOT, 'schema/lesson-context.schema.json')));
  validateResponse(normalized.response, request, await json(absolute(ROOT, 'schema/writer-response.schema.json')));
  if (normalized.response.status !== 'prepared-for-review') throw new StructuralError('A writer refusal cannot be normalized into a delivered sequence');
  await verifyPublicPins();
  const normalizationRun = `transport-normalization-${randomUUID().slice(0, 8)}`;
  const directory = absolute(original, normalizationRun);
  await mkdir(directory, { mode: 0o700 });
  const calls = previous.calls.map(call => ({ ...call, reported_cost: cost({ usage: call.usage, cost: call.reported_cost ?? undefined }), cost_status: cost({ usage: call.usage, cost: call.reported_cost ?? undefined }) === null ? 'not reported by gateway' : 'gateway reported' }));
  const { calls: ignoredCalls, transport_hashes: ignoredHashes, status: ignoredStatus, items: ignoredItems, ...originalProvenance } = previous;
  const provenance = { ...originalProvenance, origin_run: previous.run, original_run_status: previous.status, raw_first_attempt_status: trace.first_attempt?.structural_error ? 'structural-check-failed' : 'structural-check-passed', raw_first_attempt_quality_status: 'unmeasured', run: `${previous.run}/${normalizationRun}`, model_structural_repair_count: trace.repairs.length, deterministic_transport_repair_count: 1, structural_repair_count: trace.repairs.length + 1, writer_response_sha256: sha256(JSON.stringify(normalized.response)), normalization_code_sha256: sha256(await readFile(absolute(ROOT, 'model_generate.mjs'))), academic_quality: 'pending independent review; transport normalization changes no substantive content or key positions' };
  const { context: finishedContext, questionSet } = adaptResponse(request, context, normalized.response, provenance);
  validate(finishedContext, await json(absolute(ROOT, 'schema/lesson-context.schema.json')));
  validate(questionSet, await json(absolute(ROOT, 'schema/question-set.schema.json')));
  await save(absolute(directory, 'normalization.json'), { source_attempt: attempt, operations: normalized.operations, model_calls_added: 0, candidate_selection: [], original_held_journal_preserved: true });
  await save(absolute(directory, 'writer-response.json'), normalized.response);
  await save(absolute(directory, 'lesson-context.json'), finishedContext);
  await save(absolute(directory, 'question-set.json'), questionSet);
  await save(absolute(directory, 'learner.json'), learnerPacket(finishedContext, questionSet));
  const receipt = { ...provenance, status: 'prepared-for-review', items: normalized.response.items.length, calls, cost_currency: 'USD', reported_total_cost: calls.every(call => typeof call.reported_cost === 'number') ? calls.reduce((sum, call) => sum + call.reported_cost, 0) : null, transport_hashes: {} };
  for (const name of ['lesson-context.json', 'question-set.json', 'learner.json']) receipt.transport_hashes[name] = sha256(await readFile(absolute(directory, name)));
  await save(absolute(directory, 'receipt.json'), receipt);
  return { status: receipt.status, items: receipt.items, model_calls: receipt.model_calls, model_structural_repairs: receipt.model_structural_repair_count, deterministic_transport_repairs: 1, directory, receipt: absolute(directory, 'receipt.json') };
}

async function main() {
  const options = {};
  const flags = { '--request': 'request', '--context': 'context', '--config': 'config', '--env-file': 'envFile', '--finalize-run': 'finalizeRun' };
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--list-models') options.listModels = true;
    else if (args[i] === '--offline-smoke') options.offlineSmoke = true;
    else if (args[i] === '--prepare-native') options.prepareNative = true;
    else if (args[i] === '--offline-kind-matrix') options.offlineKindMatrix = true;
    else if (args[i] === '--context-coverage') options.contextCoverage = true;
    else if (flags[args[i]] && args[i + 1]) options[flags[args[i]]] = args[++i];
    else throw new StructuralError('Usage: node model_generate.mjs --request request.json --context context.json [--env-file file] [--config file], or --list-models');
  }
  if (!options.finalizeRun && !options.listModels && (!options.request || !options.context)) throw new StructuralError('Both --request and --context must be supplied explicitly');
  const result = options.finalizeRun ? await finalizeRecordedRun(options.finalizeRun) : await execute(options);
  console.log(JSON.stringify(result, null, 2));
  if (result.status === 'held') process.exitCode = 2;
}

if (process.argv[1] && absolute(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => { console.error(error.message); process.exitCode = 1; });
