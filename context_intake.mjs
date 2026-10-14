// Deterministic context joins. These establish transport constraints, not semantic alignment or readiness.
import { StructuralError } from './model_contract.mjs';
const fail = (where, message) => { throw new StructuralError(`${where}: ${message}`); };
const rows = (value, where) => { if (!Array.isArray(value)) fail(where, 'explicit array required'); return value; };
const nonempty = (value, where) => { if (typeof value !== 'string' || !value.trim()) fail(where, 'nonempty text required'); };
const distinct = (values, where) => { if (new Set(values).size !== values.length) fail(where, 'duplicate references'); };
const mapById = (value, where) => { rows(value, where).forEach(row => nonempty(row.id, where)); distinct(value.map(row => row.id), where); return new Map(value.map(row => [row.id, row])); };

export function compileContextPlan(request, context = null) {
  const native = request.protocol === 'question-lane-native/0.2', c = request.course_context;
  const targets = mapById(c.core_knowledge, 'knowledge goals'), sources = mapById(c.source_assets, 'source assets'), phases = mapById(c.lesson_plan.phases, 'lesson phases');
  const keys = mapById(c.content_keys ?? [], 'content keys');
  const phaseIndex = new Map([...phases.keys()].map((id, i) => [id, i]));
  const checkRefs = (refs, index, where) => { rows(refs, where); distinct(refs, where); refs.forEach(ref => { if (!index.has(ref)) fail(where, `unresolved reference ${ref}`); }); };
  for (const phase of phases.values()) {
    checkRefs(phase.target_refs, targets, `${phase.id} targets`); checkRefs(phase.source_refs, sources, `${phase.id} sources`);
    if (phase.content_key_refs) checkRefs(phase.content_key_refs, keys, `${phase.id} content keys`);
    checkRefs(phase.after ?? [], phases, `${phase.id} dependencies`);
    if ((phase.after ?? []).some(ref => phaseIndex.get(ref) >= phaseIndex.get(phase.id))) fail(phase.id, 'phase dependency must precede the phase in the declared plan');
  }
  const graph = Array.isArray(c.knowledge_map) ? c.knowledge_graph : c.knowledge_map;
  let nodes = new Map(), edges = [];
  if (graph) {
    nodes = mapById(graph.nodes, 'knowledge graph nodes'); edges = rows(graph.edges, 'knowledge graph edges');
    for (const node of nodes.values()) { if (!['core', 'prerequisite'].includes(node.role)) fail(node.id, 'unknown knowledge graph role'); if (node.role === 'core' && !targets.has(node.id)) fail(node.id, 'graph core is not a declared goal'); checkRefs(node.source_refs ?? [], sources, `${node.id} sources`); }
    edges.forEach(edge => { nonempty(edge.relation, 'knowledge relation'); if (!nodes.has(edge.from) || !nodes.has(edge.to)) fail('knowledge graph', 'edge endpoint does not resolve'); });
  }
  const prerequisiteIds = new Set((c.prerequisites ?? []).map(row => typeof row === 'string' ? row : row.id));
  for (const node of nodes.values()) if (node.role === 'prerequisite') prerequisiteIds.add(node.id);
  for (const target of targets.values()) (target.prerequisite_refs ?? []).forEach(ref => { if (!prerequisiteIds.has(ref)) fail(target.id, 'declared prerequisite does not resolve'); });
  for (const key of keys.values()) { nonempty(key.claim, key.id); checkRefs(key.source_refs ?? [], sources, `${key.id} sources`); if (key.target_refs) checkRefs(key.target_refs, targets, `${key.id} targets`); if (key.phase_refs) checkRefs(key.phase_refs, phases, `${key.id} phases`); }
  const links = Array.isArray(c.knowledge_map) ? c.knowledge_map : [...keys.values()].flatMap(key => (key.target_refs ?? []).map(ref => ({ knowledge_ref: ref, content_key_ref: key.id })));
  links.forEach(link => { const key = keys.get(link.content_key_ref); if (!targets.has(link.knowledge_ref) || !key) fail('knowledge map', 'target/content-key link does not resolve'); const declared = targets.get(link.knowledge_ref).source_refs; if (declared && !key.source_refs?.some(ref => declared.includes(ref))) fail('knowledge map', 'linked target and content key have no shared declared source'); });
  distinct(links.map(link => `${link.knowledge_ref}\u0000${link.content_key_ref}`), 'knowledge links');
  const pairRelations = mapById(c.pairing_map ?? [], 'pair relations');
  for (const pair of pairRelations.values()) { nonempty(pair.relation, pair.id); checkRefs(pair.knowledge_refs, targets, `${pair.id} knowledge`); }
  const tables = mapById(c.pairing_tables ?? [], 'pairing tables');
  const tablePairs = mapById([...tables.values()].flatMap(table => rows(table.pairs, table.id)), 'table pairs');
  for (const pair of tablePairs.values()) {
    if (!targets.has(pair.target_ref) || !sources.has(pair.source_ref)) fail(pair.id, 'pair target/source does not resolve');
    if (pair.content_key_ref && (!keys.has(pair.content_key_ref) || !links.some(link => link.knowledge_ref === pair.target_ref && link.content_key_ref === pair.content_key_ref) || !keys.get(pair.content_key_ref).source_refs?.includes(pair.source_ref))) fail(pair.id, 'pair contradicts the target/content-key/source association');
    if (pair.phase_ref && (!phases.has(pair.phase_ref) || !phases.get(pair.phase_ref).source_refs.includes(pair.source_ref) || !phases.get(pair.phase_ref).target_refs.includes(pair.target_ref))) fail(pair.id, 'pair contradicts its declared phase');
  }
  const constraints = c.learner_constraints ?? request.student_context ?? {};
  if (constraints.response_modes) { rows(constraints.response_modes, 'response modes'); distinct(constraints.response_modes, 'response modes'); constraints.response_modes.forEach(mode => { if (!['written', 'spoken', 'selection', 'recall', 'self_report', 'instruction'].includes(mode)) fail('learner constraints', 'unsupported response mode'); }); }
  for (const field of ['max_option_count', 'max_prompt_characters', 'max_response_words']) if (constraints[field] !== undefined && (!Number.isInteger(constraints[field]) || constraints[field] < 1)) fail('learner constraints', `${field} must be a positive integer`);
  const exposures = Array.isArray(c.prior_exposure) ? c.prior_exposure : c.prior_exposure?.events ?? [];
  exposures.forEach(event => { if (event.source_ref && !sources.has(event.source_ref)) fail('exposure history', 'source does not resolve'); if (event.source_refs) checkRefs(event.source_refs, sources, 'exposure sources'); if (event.revealed_target_refs) checkRefs(event.revealed_target_refs, targets, 'revealed targets'); for (const field of ['before_phase_ref', 'at_phase_ref', 'after_phase_ref']) if (event[field] && !phases.has(event[field])) fail('exposure history', `${field} does not resolve`); });
  const history = c.learner_history ?? null;
  if (history) {
    const responses = mapById(history.responses ?? [], 'learner responses');
    for (const row of responses.values()) { nonempty(row.response, row.id); if (!targets.has(row.knowledge_ref)) fail(row.id, 'response knowledge reference does not resolve'); if (row.source_refs) checkRefs(row.source_refs, sources, `${row.id} sources`); for (const field of ['before_phase_ref', 'after_phase_ref']) if (row[field] && !phases.has(row[field])) fail(row.id, 'response timing phase does not resolve'); }
  }
  const firstPage = new Map();
  context?.native?.pages?.forEach((page, i) => (page.nodes ?? []).forEach(node => { for (const ref of [node.source_ref, node.transcript_source_ref].filter(Boolean)) if (!firstPage.has(ref)) firstPage.set(ref, i); }));
  const pageIndex = new Map((context?.native?.pages ?? []).map((page, i) => [page.id, i]));
  let previousPhase = -1;
  const slots = request.sequence_blueprint.map(slot => {
    const id = native ? slot.id : slot.position?.id, phaseRef = native ? slot.phase_ref : slot.position?.phase_ref;
    const phase = phases.get(phaseRef); if (!phase) fail(id, 'phase does not resolve');
    const order = phaseIndex.get(phaseRef); if (order < previousPhase) fail(id, 'slot order contradicts the declared phase order'); previousPhase = order;
    const targetRefs = native ? slot.target_refs : slot.target;
    checkRefs(targetRefs, targets, `${id} targets`); if (targetRefs.some(ref => !phase.target_refs.includes(ref))) fail(id, 'slot target is outside its phase');
    const selectedKeys = native ? slot.content_key_refs : slot.position?.alignment?.content_key_refs ?? phase.content_key_refs ?? [];
    checkRefs(selectedKeys, keys, `${id} content keys`);
    selectedKeys.forEach(ref => { const key = keys.get(ref); if (key.phase_refs && !key.phase_refs.includes(phaseRef)) fail(id, 'content key is outside its declared phase'); if ((key.source_refs ?? []).some(ref => !phase.source_refs.includes(ref))) fail(id, 'content key needs a source not visible in this phase'); });
    const mapped = links.filter(link => targetRefs.includes(link.knowledge_ref) && selectedKeys.includes(link.content_key_ref));
    if ((native || keys.size) && targetRefs.some(ref => !mapped.some(link => link.knowledge_ref === ref))) fail(id, 'declared target has no selected content-key association');
    const selectedPairs = native ? slot.pair_refs ?? [] : slot.position?.alignment?.pair_refs ?? [];
    const relations = [], concretePairs = [];
    selectedPairs.forEach(ref => {
      const relation = pairRelations.get(ref), pair = tablePairs.get(ref);
      if (relation) { if (!relation.knowledge_refs.some(target => targetRefs.includes(target))) fail(id, 'selected pair relation has no selected knowledge target'); relations.push(relation); }
      else if (pair) concretePairs.push(pair);
      else fail(id, 'selected pairing does not resolve');
    });
    (slot.pairing_table_pair_refs ?? []).forEach(ref => { if (!tablePairs.has(ref)) fail(id, 'selected concrete pairing does not resolve'); concretePairs.push(tablePairs.get(ref)); });
    concretePairs.forEach(pair => { if (!targetRefs.includes(pair.target_ref) || !phase.source_refs.includes(pair.source_ref) || pair.content_key_ref && !selectedKeys.includes(pair.content_key_ref) || pair.phase_ref && pair.phase_ref !== phaseRef) fail(id, 'selected concrete pairing contradicts slot target/source/key/phase'); });
    const page = pageIndex.get(native ? slot.page_ref : slot.position?.page);
    phase.source_refs.forEach(ref => { if (page !== undefined && firstPage.has(ref) && firstPage.get(ref) > page) fail(id, 'source instruction occurs after this slot page'); });
    const relevantExposures = exposures.filter(event => (event.source_refs ?? [event.source_ref]).some(ref => phase.source_refs.includes(ref)) || event.revealed_target_refs?.some(ref => targetRefs.includes(ref)));
    if (slot.native_context?.requires_unexposed_targets || slot.requires_unexposed_targets) relevantExposures.forEach(event => { if (!event.revealed_target_refs?.some(ref => targetRefs.includes(ref))) return; if (!event.before_phase_ref && !event.after_phase_ref) fail(id, 'unexposed-target claim lacks explicit reveal timing'); if (event.before_phase_ref && phaseIndex.get(event.before_phase_ref) <= order || event.after_phase_ref && phaseIndex.get(event.after_phase_ref) < order) fail(id, 'explicitly unexposed target has prior declared answer exposure'); });
    if (slot.native_context?.requires_individual_readiness || slot.requires_individual_readiness) fail(id, 'individual readiness cannot be established from declared targets, prerequisites or recorded responses by this source-only transport');
    const family = slot.family, mode = family === 'oral_response' ? 'spoken' : ['written_response', 'word_web'].includes(family) ? 'written' : family === 'say_back' ? 'recall' : family === 'self_report' ? 'self_report' : family === 'nonresponse' ? 'instruction' : 'selection';
    if (native && constraints.response_modes && !constraints.response_modes.includes(mode)) fail(id, 'requested response mode is excluded by supplied learner constraints');
    nonempty(slot.support, `${id} support`); if (native) nonempty(slot.operation, `${id} operation`);
    return { id, phase_ref: phaseRef, phase_role: phase.role, operation: slot.operation ?? slot.role, role: slot.role, support: slot.support, visible_source_refs: [...phase.source_refs], targets: targetRefs.map(ref => targets.get(ref)), content_keys: selectedKeys.map(ref => keys.get(ref)), target_content_links: mapped, pair_relations: relations, concrete_pairs: concretePairs, knowledge_graph_edges: edges.filter(edge => targetRefs.includes(edge.from) || targetRefs.includes(edge.to)), prerequisites: targetRefs.flatMap(ref => targets.get(ref).prerequisite_refs ?? []), response_mode: mode, learner_constraints: structuredClone(constraints), declared_exposures: structuredClone(relevantExposures), learner_responses: structuredClone((history?.responses ?? []).filter(row => targetRefs.includes(row.knowledge_ref) && (!row.before_phase_ref || phaseIndex.get(row.before_phase_ref) <= order) && (!row.after_phase_ref || phaseIndex.get(row.after_phase_ref) < order))), qualification: 'Declared goals, prerequisite links and learner response records are authoring inputs; no mastery, ZPD, semantic alignment or individual challenge judgment is inferred.' };
  });
  return { contract: 'resolved-course-context/0.1', source: structuredClone(request.source_provenance ?? context?.source ?? null), slots, coverage: { lesson_plan: 'phase order/targets/dependencies consumed', content_keys: keys.size ? 'selected source/phase/target associations consumed' : 'not supplied for this source-only packet', knowledge_map: links.length ? 'target/content-key joins consumed' : 'not supplied', prerequisite_graph: graph ? 'declared graph endpoints/links resolved; semantic meaning unmeasured' : 'not supplied; no graph or readiness inferred', pairing_tables: tables.size ? 'concrete source/target/key/phase joins consumed' : 'not supplied; native pair relations are distinct from source pairing tables', source_exposure: 'phase sources and explicit instruction pages restrict evidence; structured reveal timing enforced when supplied', learner_history: history ? 'supplied response records resolved and forwarded; correctness/readiness not inferred' : 'not supplied', learner_constraints: 'declared response modes/caps enforced; language/readability/difficulty semantics unmeasured', semantic_writer_adherence: 'not measured by offline transport or prompt inclusion' } };
}

export function checkResponseConstraints(view, resolved) {
  const c = resolved.learner_constraints;
  const prompt = view.prompt ?? view.stem ?? view.instruction;
  if (c.max_prompt_characters && prompt?.length > c.max_prompt_characters) fail(resolved.id, 'learner prompt exceeds supplied character cap');
  if (c.max_option_count && view.options?.length > c.max_option_count) fail(resolved.id, 'option count exceeds supplied learner cap');
  if (c.max_response_words && view.sample_answer && view.sample_answer.trim().split(/\s+/).length > c.max_response_words) fail(resolved.id, 'illustrative answer exceeds supplied response word cap');
}

export function contextConsumptionAudit(request, context, { validateInputs, validateResponse, mockResponse, catalog }) {
  validateInputs(request, context, catalog);
  const plan = compileContextPlan(request, context), cases = [];
  const checks = [
    ['phase-order', (r) => r.course_context.lesson_plan.phases.reverse()],
    ['phase-target', (r) => r.sequence_blueprint[0].target_refs = ['K-language']],
    ['content-source-scope', (r) => r.sequence_blueprint[0].content_key_refs = ['C-reading-4']],
    ['knowledge-content-join', (r) => r.course_context.knowledge_map = r.course_context.knowledge_map.filter(row => !(row.knowledge_ref === 'K-media' && row.content_key_ref === 'C-unit-caption-2'))],
    ['unrelated-pair-relation', (r) => r.sequence_blueprint[0].pair_refs = ['P-evidence-language']],
    ['graph-endpoint', (r) => r.course_context.knowledge_graph = { nodes: r.course_context.core_knowledge.map(row => ({ id: row.id, role: 'core' })), edges: [{ from: 'missing', to: 'K-media', relation: 'requires' }] }],
    ['concrete-pairing', (r) => r.course_context.pairing_tables = [{ id: 'synthetic-invalid-table', pairs: [{ id: 'synthetic-invalid-pair', target_ref: 'K-media', source_ref: 'reading-4', content_key_ref: 'C-reading-4', phase_ref: 'F-N01' }] }]],
    ['future-instruction-source', (r) => { const slot = r.sequence_blueprint.find(row => row.native_kind === 'reading_mcq'); r.course_context.lesson_plan.phases.find(row => row.id === slot.phase_ref).source_refs.push('worked-teaching'); }],
    ['source-version', (r) => r.source_provenance.sha256 = 'synthetic-wrong-version'],
    ['nonempty-input-slot', (r, c) => c.native.pages.find(row => row.question_slots.length).question_slots[0].view = { key: [0] }],
    ['exposure-reference', (r) => r.course_context.prior_exposure.events.push({ source_ref: 'missing-source' })],
    ['excluded-response-mode', (r) => r.course_context.learner_constraints.response_modes = ['written']],
    ['learner-history-reference', (r) => r.course_context.learner_history = { responses: [{ id: 'synthetic-history', knowledge_ref: 'missing', response: 'A supplied anonymous response.' }] }],
    ['individual-readiness-required', (r) => r.sequence_blueprint[0].native_context.requires_individual_readiness = true],
    ['missing-operation', (r) => delete r.sequence_blueprint[0].operation],
  ];
  for (const [id, change] of checks) {
    const r = structuredClone(request), c = structuredClone(context); change(r, c); c.native.course_context = structuredClone(r.course_context);
    try { validateInputs(r, c, catalog); throw new Error(`${id}: invalid context was accepted`); }
    catch (error) { if (!(error instanceof StructuralError)) throw error; cases.push({ id, status: 'typed-hold-checked', detail: error.message, model_calls: 0 }); }
  }
  for (const [id, change] of [['response-option-cap', (r, response) => r.course_context.learner_constraints.max_option_count = 2], ['unexpected-rubric-field', (r, response) => response.items.find(row => row.view.rubric).view.rubric.criteria[0].unsupported_metadata = 'not in the return contract'], ['frozen-counterclaim-missing-return', (r, response) => delete response.items.find(row => row.public_format === 'rebuttal').view.counterclaim], ['quote-branch-missing-return', (r, response) => delete response.items.find(row => row.kind === 'quote_analysis').view.quote]]) {
    const r = structuredClone(request), response = mockResponse(r); change(r, response);
    try { validateResponse(response, r); throw new Error(`${id}: invalid return was accepted`); }
    catch (error) { if (!(error instanceof StructuralError)) throw error; cases.push({ id, status: 'typed-return-refusal-checked', detail: error.message, model_calls: 0 }); }
  }
  return { contract: 'context-consumption-coverage/0.1', status: 'offline-context-transport-audited', source: request.source_provenance, slots_checked: plan.slots.length, coverage: plan.coverage, regression_cases: cases, regression_cases_checked: cases.length, model_calls: 0, independent_quality_labels: 0, limits: ['Resolved context and structural refusals are consumed deterministically; semantic writer adherence is unmeasured.', 'Current native content keys are source-anchor claims; their course-owned pedagogical sufficiency is not established.', 'Current native source has no supplied prerequisite graph, concrete source pairing tables or individual learner history. These inputs are supported when explicitly supplied, with source/reference/order checks.', 'Grade, language, accessibility prose and individual difficulty are forwarded authoring constraints; transport cannot establish readability, accommodation effectiveness, mastery or ZPD.', 'Synthetic family fixtures remain separate from captured activities and do not implement or qualify the original native UI.'] };
}
