#!/usr/bin/env node
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve as absolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { connect, credentials } from './gateway.mjs';
import { adaptResponse, learnerPacket, StructuralError, validate, validateInputs, validateResponse } from './model_contract.mjs';

const ROOT = dirname(fileURLToPath(import.meta.url));
export const VERSION = 'source-grounded-writer/0.1';
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const json = async path => JSON.parse(await readFile(path, 'utf8'));
const save = async (path, value) => writeFile(path, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600, flag: 'wx' });

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
    { role: 'system', content: instructions() },
    { role: 'user', content: JSON.stringify({ request, lesson_context: context, writer_response_schema: schema, public_methods: publicMethods.cards.map(({ id, claim, actions, limits }) => ({ id, claim, actions, limits })), presentation_formats: publicFormats.formats.map(({ id, required_payload, teacher_key, conditions }) => ({ id, required_payload, teacher_key, conditions })) }) },
  ];
}

export async function writeSequence({ request, context, schema, config, messages, route, journal }) {
  const trace = { generator_version: VERSION, writer_attempts: 1, candidate_count: 1, model_calls: 0, first_attempt: null, repairs: [], selection: [], refusals: [], quality_status: 'unmeasured; no evaluator or self-judge call', requested_model: config.model, decoding: { temperature: config.temperature, max_tokens: config.max_tokens }, calls: [] };
  let currentMessages = messages;
  let response;
  for (let attempt = 0; attempt <= config.structural_repairs; attempt++) {
    const name = attempt === 0 ? 'first-attempt' : `structural-repair-${attempt}`;
    const body = { model: config.model, temperature: config.temperature, max_tokens: config.max_tokens, messages: currentMessages, stream: false };
    await journal(`${name}.request.json`, body);
    trace.model_calls++;
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
    const call = { name, requested_model: config.model, reported_model: completion.value.model ?? null, finish_reason: choice?.finish_reason ?? null, usage: completion.value.usage ?? null, reported_cost: completion.value.cost ?? completion.value.usage?.cost ?? null, cost_status: completion.value.cost === undefined && completion.value.usage?.cost === undefined ? 'not reported by gateway' : 'gateway reported', provider_response_sha256: sha256(completion.raw) };
    trace.calls.push(call);
    if (attempt === 0) trace.first_attempt = call; else trace.repairs.push({ ...call, allowed_scope: 'JSON shape, identifier/reference integrity and exact quote binding only' });
    if (choice?.message?.refusal) {
      trace.refusals.push({ attempt: name, refusal: choice.message.refusal });
      response = { protocol: request.protocol, request_id: request.request_id, status: 'held', holds: [{ code: 'writer-refusal', detail: choice.message.refusal }], items: [] };
      break;
    }
    await journal(`${name}.content.json`, { content: content ?? null });
    try {
      if (typeof content !== 'string') throw new StructuralError('Writer did not return text content');
      response = JSON.parse(content);
      validateResponse(response, request, schema);
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
  const configPath = absolute(options.config ?? absolute(ROOT, 'model-config.json'));
  const config = await json(configPath);
  if (!Number.isInteger(config.structural_repairs) || config.structural_repairs < 0 || config.structural_repairs > 1) throw new StructuralError('Structural repair count must be zero or one');
  const route = await connect(config, await credentials(options.envFile));
  const models = await route.models();
  if (options.listModels) return { available_models: models.map(({ id, owned_by }) => ({ id, owned_by })), model_calls: 0 };
  if (!models.some(model => model.id === config.model)) throw new StructuralError('Configured writer alias is not advertised by the gateway');
  if (/bedrock|\baws\b/i.test(config.model)) throw new StructuralError('Configured writer route is excluded');
  if (!config.route_evidence || config.route_evidence.model !== config.model || config.route_evidence.aws_bedrock !== false) throw new StructuralError('Explicit read-only non-Bedrock route evidence is required in model-config.json');
  const advertised = models.find(model => model.id === config.model);
  if (advertised.owned_by === 'virtual-model' || advertised.owned_by !== config.route_evidence.owned_by) throw new StructuralError('Configured direct provider evidence differs from current gateway metadata');
  const requestBytes = await readFile(absolute(options.request));
  const contextBytes = await readFile(absolute(options.context));
  const request = JSON.parse(requestBytes), context = JSON.parse(contextBytes);
  const requestSchema = await json(absolute(ROOT, 'schema/generator-request.schema.json'));
  const contextSchema = await json(absolute(ROOT, 'schema/lesson-context.schema.json'));
  const responseSchema = await json(absolute(ROOT, 'schema/writer-response.schema.json'));
  validateInputs(request, context, requestSchema, contextSchema);
  await verifyPublicPins();
  const methods = await json(absolute(ROOT, 'public/generation-standard.json'));
  const formats = await json(absolute(ROOT, 'public/formats.json'));
  const run = `${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}`;
  const directory = absolute(ROOT, config.run_root, run);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const journal = (name, value, options) => options?.raw ? writeFile(absolute(directory, name), value, { mode: 0o600, flag: 'wx' }) : save(absolute(directory, name), value);
  await journal('source-request.json', request);
  await journal('source-context.json', context);
  await journal('config.json', config);
  await journal('models.json', { checked_at: new Date().toISOString(), models: models.map(({ id, owned_by }) => ({ id, owned_by })) });
  const messages = writerMessages(request, context, responseSchema, methods, formats);
  const { response, trace } = await writeSequence({ request, context, schema: responseSchema, config, messages, route, journal });
  await journal('writer-response.json', response);
  const codeHashes = {};
  for (const name of ['model_generate.mjs', 'model_contract.mjs', 'gateway.mjs']) codeHashes[name] = sha256(await readFile(absolute(ROOT, name)));
  const provenance = { kind: 'generator-run', run, generator_version: VERSION, request_sha256: sha256(requestBytes), source_context_sha256: sha256(contextBytes), config_sha256: sha256(await readFile(configPath)), code_sha256: codeHashes, requested_model: config.model, reported_models: trace.calls.map(call => call.reported_model), route_evidence: config.route_evidence, model_calls: trace.model_calls, first_attempt_count: 1, structural_repair_count: trace.repairs.length, candidate_count: 1, writer_response_sha256: sha256(JSON.stringify(response)), knowledge_baseline_sha256: sha256(await readFile(absolute(ROOT, 'public/knowledge-baseline.json'))), source_comparison: 'Local public pinned bytes checked; original external source pin preserved, no new external Git comparison ran.', academic_quality: 'pending independent review', learner_outcome: 'unmeasured' };
  const receipt = { ...provenance, writer_family: config.writer_family, status: response.status, items: response.items.length, calls: trace.calls.map(({ name, requested_model, reported_model, finish_reason, usage, reported_cost, cost_status }) => ({ name, requested_model, reported_model, finish_reason, usage, reported_cost, cost_status })), transport_hashes: {} };
  if (response.status === 'prepared-for-review') {
    const { context: finishedContext, questionSet } = adaptResponse(request, context, response, provenance);
    validate(finishedContext, contextSchema);
    validate(questionSet, await json(absolute(ROOT, 'schema/question-set.schema.json')));
    await journal('lesson-context.json', finishedContext);
    await journal('question-set.json', questionSet);
    await journal('learner.json', learnerPacket(finishedContext, questionSet));
    for (const name of ['lesson-context.json', 'question-set.json', 'learner.json']) receipt.transport_hashes[name] = sha256(await readFile(absolute(directory, name)));
  }
  await journal('receipt.json', receipt);
  return { status: response.status, items: response.items.length, model_calls: trace.model_calls, structural_repairs: trace.repairs.length, directory, receipt: absolute(directory, 'receipt.json') };
}

async function main() {
  const options = {};
  const flags = { '--request': 'request', '--context': 'context', '--config': 'config', '--env-file': 'envFile' };
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--list-models') options.listModels = true;
    else if (flags[args[i]] && args[i + 1]) options[flags[args[i]]] = args[++i];
    else throw new StructuralError('Usage: node model_generate.mjs --request request.json --context context.json [--env-file file] [--config file], or --list-models');
  }
  if (!options.listModels && (!options.request || !options.context)) throw new StructuralError('Both --request and --context must be supplied explicitly');
  const result = await execute(options);
  console.log(JSON.stringify(result, null, 2));
  if (result.status === 'held') process.exitCode = 2;
}

if (process.argv[1] && absolute(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => { console.error(error.message); process.exitCode = 1; });
