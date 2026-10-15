// Public authoring intent and deterministic return obligations; never a semantic quality judge.
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { StructuralError, resolve, validate } from './model_contract.mjs';
const schema = JSON.parse(readFileSync(new URL('./schema/instructional-plan.schema.json', import.meta.url)));
export const INSTRUCTIONAL_WRITER_RULES = 'Consume the resolved instructional plan, not only target IDs. Follow lesson/slot purpose, authority declarations, ordered teaching and known interaction events, supplied support and expected evidence. Preserve static-design scope; do not invent curriculum authority, actual exposure, individualized readiness or mastery. Previously taught targets remain valid for retrieval or supported assessment when allowed. Only explicit task-answer withholding restricts disclosed_item_ids; general target teaching is distinct. Future-task intent never expands current factual source scope. Return sequence_plan with plan_id, context_sha256, lesson, goal_authority, items, goal_coverage and support_transitions. Each sequence_plan item has item_id,purpose,scope,optional measurement_intent,support,context_event_refs and expected_evidence:[{expectation_id,claim,field_refs}]. Bind every expectation to actual returned /view/ fields and its required contextual source references. For written responses, create a marking criterion with requirement equal to the supplied expected-evidence claim and bind that criterion; metadata alone is insufficient. Keep plan/evidence/marking intent out of learner content. These checks do not establish semantic quality.';
const fail = (where, why) => { throw new StructuralError(`${where}: ${why}`); };
const text = (v, where) => { if (typeof v !== 'string' || !v.trim()) fail(where, 'nonempty text required'); };
const record = (v, where) => { if (!v || typeof v !== 'object' || Array.isArray(v)) fail(where, 'object required'); };
const unique = (v, where) => { if (new Set(v).size !== v.length) fail(where, 'duplicate references'); };
const idOf = slot => slot.id ?? slot.position?.id;
const phaseOf = slot => slot.phase_ref ?? slot.position?.phase_ref;
const goalsOf = slot => slot.target_refs ?? slot.target;
const same = (a, b, where) => { if (JSON.stringify(a) !== JSON.stringify(b)) fail(where, 'declared instructional requirement differs'); };
const canonical = value => Array.isArray(value) ? `[${value.map(canonical).join(',')}]` : value && typeof value === 'object' ? `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}` : JSON.stringify(value);

export function compileInstructionalPlan(request, context = null) {
  const p = request.course_context.instructional_plan;
  if (!p) fail('instructional plan', 'explicit instructional-plan/0.1 required; no curriculum or learner context invented');
  validate(p, schema, 'instructional plan');
  const c = request.course_context, slots = request.sequence_blueprint;
  const ids = slots.map(idOf), positions = new Map(ids.map((id, i) => [id, i]));
  const sources = new Map(c.source_assets.map(row => [row.id, row]));
  const goals = new Map(c.core_knowledge.map(row => [row.id, row]));
  const refs = (values, index, where) => { unique(values, where); values.forEach(ref => { if (!index.has(ref)) fail(where, `unresolved reference ${ref}`); }); };
  const scope = (value, where) => { if (value !== 'static-design') fail(where, 'individualized or mastery claims are unsupported; supplied records do not establish readiness/mastery'); };
  scope(p.lesson.scope, 'lesson scope');
  text(p.lesson.objective, 'lesson objective'); refs(p.lesson.goal_refs, goals, 'lesson goals');
  const authority = new Map(p.goal_authority.map(row => [row.goal_ref, row]));
  unique(p.goal_authority.map(row => row.goal_ref), 'goal authority');
  if (authority.size !== goals.size) fail('goal authority', 'every declared knowledge goal needs an explicit authority declaration');
  for (const [id, row] of authority) { if (!goals.has(id)) fail(id, 'unknown goal authority'); refs(row.source_refs, sources, `${id} authority sources`); text(row.note, `${id} authority note`); text(goals.get(id).claim, `${id} goal claim`); text(goals.get(id).performance, `${id} goal performance`); }
  const firstPage = new Map(), pageIndex = new Map();
  context?.native?.pages?.forEach((page, i) => { pageIndex.set(page.id, i); (page.nodes ?? []).forEach(node => [node.source_ref, node.transcript_source_ref].filter(Boolean).forEach(ref => { if (!firstPage.has(ref)) firstPage.set(ref, i); })); });
  const events = new Map(); let priorOrder = 0, priorAnchor = -1;
  for (const event of p.events) {
    if (events.has(event.id)) fail(event.id, 'duplicate instructional event');
    const anchor = event.before_item_id === 'END' ? ids.length : positions.get(event.before_item_id);
    if (anchor === undefined || event.order <= priorOrder || anchor < priorAnchor) fail(event.id, 'event order/anchor must resolve monotonically before an item or END');
    priorOrder = event.order; priorAnchor = anchor;
    refs(event.source_refs, sources, `${event.id} sources`); refs(event.target_refs, goals, `${event.id} targets`); refs(event.revealed_target_refs, goals, `${event.id} taught targets`); refs(event.disclosed_item_ids ?? [], positions, `${event.id} task disclosures`);
    text(event.content, event.id); text(event.provenance, `${event.id} provenance`);
    const page = anchor < slots.length ? pageIndex.get(slots[anchor].page_ref ?? slots[anchor].position?.page) : undefined;
    event.source_refs.forEach(ref => { if (page !== undefined && firstPage.has(ref) && firstPage.get(ref) > page) fail(event.id, 'event exposes source before its declared instruction page'); });
    events.set(event.id, { ...structuredClone(event), anchor_order: anchor, source_context: event.source_refs.map(ref => structuredClone(sources.get(ref))), qualification: 'Supplied provenance/status declaration, not verified individual exposure or mastery.' });
  }
  unique(p.items.map(row => row.item_id), 'instructional items');
  same(p.items.map(row => row.item_id), ids, 'instructional items/order');
  const items = p.items.map((item, i) => {
    const slot = slots[i], phase = c.lesson_plan.phases.find(row => row.id === phaseOf(slot));
    scope(item.scope, item.item_id); refs(item.goal_refs, goals, `${item.item_id} goals`);
    if (item.goal_refs.some(ref => !goalsOf(slot).includes(ref))) fail(item.item_id, 'instructional goal outside supplied slot targets');
    const knowledgeResponse = !['self_report', 'say_back', 'nonresponse'].includes(slot.family);
    if (knowledgeResponse && (!item.goal_refs.length || goalsOf(slot).some(ref => !item.goal_refs.includes(ref)))) fail(item.item_id, 'knowledge response must retain every supplied slot target');
    refs(item.prepares_for_item_ids, positions, `${item.item_id} future tasks`);
    item.prepares_for_item_ids.forEach(ref => { if (positions.get(ref) <= i) fail(item.item_id, 'future task must be strictly later; it cannot expand current sources'); const branch = slot.native_context?.branch, other = slots[positions.get(ref)].native_context?.branch; if (branch && other && branch !== other) fail(item.item_id, 'future task crosses alternative branches'); });
    for (const values of [item.prior_event_refs, item.support.event_refs]) { refs(values, events, `${item.item_id} events`); values.forEach(ref => { if (events.get(ref).anchor_order > i) fail(item.item_id, 'future event cannot be prior support'); }); }
    refs(item.support.source_refs, sources, `${item.item_id} support sources`);
    if (item.support.source_refs.some(ref => !phase.source_refs.includes(ref))) fail(item.item_id, 'support source is outside current phase');
    unique(item.expected_evidence.map(row => row.id), `${item.item_id} expected evidence`);
    for (const expected of item.expected_evidence) { text(expected.claim, expected.id); refs(expected.goal_refs, goals, `${expected.id} goals`); refs(expected.source_refs, sources, `${expected.id} sources`); if (knowledgeResponse && (!expected.goal_refs.length || !expected.source_refs.length)) fail(expected.id, 'knowledge evidence requires explicit goals and contextual sources'); if (expected.goal_refs.some(ref => !item.goal_refs.includes(ref)) || expected.source_refs.some(ref => !phase.source_refs.includes(ref))) fail(expected.id, 'expected evidence contradicts current goals/source scope'); }
    if (knowledgeResponse && item.goal_refs.some(ref => !item.expected_evidence.some(expected => expected.goal_refs.includes(ref)))) fail(item.item_id, 'supplied knowledge target has no expected evidence');
    const related = [...events.values()].filter(event => event.anchor_order <= i && (item.prior_event_refs.includes(event.id) || item.support.event_refs.includes(event.id) || event.source_refs.some(ref => phase.source_refs.includes(ref)) || [...event.target_refs, ...event.revealed_target_refs].some(ref => item.goal_refs.includes(ref)) || event.disclosed_item_ids?.includes(item.item_id)));
    if (item.support.answer_exposure === 'withheld' && related.some(event => event.disclosed_item_ids?.includes(item.item_id))) fail(item.item_id, 'explicit withheld task answer has prior declared/observed/conditional disclosure; general target teaching is distinct');
    if (item.purpose === 'instruction' && slot.family && slot.family !== 'nonresponse') fail(item.item_id, 'instructional purpose conflicts with a response-producing slot');
    const evidenceRole = ['self_report', 'say_back', 'nonresponse'].includes(slot.family) ? slot.family : slot.role === 'subcheck' || slot.depends_on?.length ? 'dependent-task' : item.purpose;
    const summaries = related.map(({ source_context, ...event }) => event);
    return { ...structuredClone(item), goal_claims: item.goal_refs.map(ref => structuredClone(goals.get(ref))), goal_authority: item.goal_refs.map(ref => structuredClone(authority.get(ref))), prior_events: summaries, known_interactions: summaries.filter(event => event.status === 'observed' && ['response', 'feedback'].includes(event.kind)), conditional_events: summaries.filter(event => event.status === 'conditional'), visible_source_refs: [...phase.source_refs], evidence_role: evidenceRole, qualification: 'Expected evidence and authority are authoring declarations; no independent measurement, mastery or semantic quality established.' };
  });
  unique(p.sequence.goal_coverage.map(row => row.goal_ref), 'goal coverage');
  same(p.sequence.goal_coverage.map(row => row.goal_ref).sort(), [...p.lesson.goal_refs].sort(), 'lesson goal coverage');
  p.sequence.goal_coverage.forEach(row => { refs(row.item_ids, positions, `${row.goal_ref} covered items`); const expected = items.filter(item => item.goal_refs.includes(row.goal_ref)).map(item => item.item_id); same(row.item_ids, expected, `${row.goal_ref} coverage`); });
  unique(p.sequence.support_transitions.map(row => `${row.from_item_id}/${row.to_item_id}`), 'support transitions');
  p.sequence.support_transitions.forEach(row => { text(row.reason, 'support transition rationale'); if (!positions.has(row.from_item_id) || positions.get(row.to_item_id) !== positions.get(row.from_item_id) + 1) fail('support transition', 'transition must connect consecutive inventory slots'); });
  if (p.sequence.support_transitions.length !== Math.max(0, ids.length - 1)) fail('support transitions', 'explicit rationale required at every inventory transition; no forced variety policy inferred');
  const material = { course_context: request.course_context, student_context: request.student_context ?? null, sequence_blueprint: request.sequence_blueprint, source_provenance: request.source_provenance ?? null };
  const context_sha256 = createHash('sha256').update(canonical(material), 'utf8').digest('hex');
  return { version: 'resolved-instructional-plan/0.1', id: p.id, context_sha256, lesson: structuredClone(p.lesson), goal_authority: structuredClone(p.goal_authority), events: [...events.values()], items, sequence: structuredClone(p.sequence) };
}

export function validateSequencePlan(response, request) {
  if (response.status === 'held') return;
  const plan = compileInstructionalPlan(request), actual = response.sequence_plan;
  record(actual, 'sequence plan');
  if (!actual || Object.keys(actual).some(key => !['plan_id', 'context_sha256', 'lesson', 'goal_authority', 'items', 'goal_coverage', 'support_transitions'].includes(key))) fail('sequence plan', 'complete writer sequence_plan required');
  same(actual.plan_id, plan.id, 'plan id'); same(actual.lesson, plan.lesson, 'lesson purpose/objective/scope');
  same(actual.context_sha256, plan.context_sha256, 'instructional context binding');
  same(actual.goal_authority, plan.goal_authority, 'goal authority declarations'); same(actual.goal_coverage, plan.sequence.goal_coverage, 'goal coverage'); same(actual.support_transitions, plan.sequence.support_transitions, 'support transitions');
  if (!Array.isArray(actual.items) || actual.items.length !== plan.items.length) fail('sequence plan', 'one alignment per returned item required');
  actual.items.forEach((row, i) => {
    const intended = plan.items[i], returned = response.items[i];
    record(row, intended.item_id);
    if (Object.keys(row).some(key => !['item_id', 'purpose', 'scope', 'measurement_intent', 'support', 'context_event_refs', 'expected_evidence'].includes(key))) fail(intended.item_id, 'unexpected sequence alignment field');
    same(row.item_id, intended.item_id, 'planned item'); same(row.purpose, intended.purpose, 'item purpose'); same(row.scope, intended.scope, 'item scope'); same(row.measurement_intent ?? null, intended.measurement_intent ?? null, 'measurement intent'); same(row.support, intended.support, 'provided support'); same(row.context_event_refs, intended.prior_events.map(event => event.id), 'context event consumption');
    if (!Array.isArray(row.expected_evidence) || row.expected_evidence.length !== intended.expected_evidence.length) fail(intended.item_id, 'expected evidence return requirements differ');
    row.expected_evidence.forEach((binding, j) => {
      const expectation = intended.expected_evidence[j];
      record(binding, expectation.id);
      if (Object.keys(binding).some(key => !['expectation_id', 'claim', 'field_refs'].includes(key))) fail(intended.item_id, 'unexpected evidence alignment field');
      same(binding.expectation_id, expectation.id, 'expected evidence id'); same(binding.claim, expectation.claim, 'expected evidence claim');
      if (!Array.isArray(binding.field_refs) || !binding.field_refs.length) fail(expectation.id, 'expected evidence must bind actual returned view fields'); unique(binding.field_refs, expectation.id);
      binding.field_refs.forEach(pointer => { if (typeof pointer !== 'string' || !pointer.startsWith('/view/')) fail(expectation.id, 'expected evidence must bind the actual learner/marking view'); resolve(returned, pointer); });
      expectation.source_refs.forEach(ref => { if (!returned.source_bindings.some(source => source.source_ref === ref && binding.field_refs.includes(source.field_ref))) fail(expectation.id, 'expected evidence lacks its required contextual source binding'); });
      if (returned.view.rubric && !binding.field_refs.some(pointer => /^\/view\/rubric\/criteria\/\d+$/.test(pointer) && resolve(returned, pointer).requirement === expectation.claim)) fail(expectation.id, 'written expected evidence must be a returned marking requirement, not metadata only');
    });
  });
}

// Explicit packet-authoring helper for committed proposals and clearly labelled synthetic fixtures.
// It is never called as a fallback by the writer or intake validator.
export function proposeInstructionalPlan(request, context, { authorityKind = 'packet-proposed', note = 'Explicit packet proposal; not an authoritative curriculum or observed learner record.' } = {}) {
  const c = request.course_context, slots = request.sequence_blueprint, ids = slots.map(idOf), phases = c.lesson_plan.phases;
  const phasePositions = new Map(phases.map((phase, i) => [phase.id, i]));
  const pagePositions = new Map((context.native.pages ?? []).map((page, i) => [page.id, i]));
  const sourcePages = new Map(); (context.native.pages ?? []).forEach((page, i) => (page.nodes ?? []).forEach(node => [node.source_ref, node.transcript_source_ref].filter(Boolean).forEach(ref => { if (!sourcePages.has(ref)) sourcePages.set(ref, i); })));
  const candidates = c.source_assets.map(source => {
    const firstPhase = phases.findIndex(phase => phase.source_refs.includes(source.id));
    let anchor = firstPhase < 0 ? -1 : slots.findIndex(slot => phasePositions.get(phaseOf(slot)) >= firstPhase);
    if (anchor < 0 && sourcePages.has(source.id)) anchor = slots.findIndex(slot => pagePositions.get(slot.page_ref ?? slot.position?.page) >= sourcePages.get(source.id));
    if (anchor < 0) anchor = slots.length;
    return { source, anchor };
  }).sort((a, b) => a.anchor - b.anchor);
  const events = candidates.map(({ source, anchor }, i) => ({ id: `TEACH-${i + 1}`, order: i + 1, before_item_id: ids[anchor] ?? 'END', kind: source.kind === 'media-transcript' ? 'media' : 'teaching', status: 'declared', content: 'Declared source instruction is available at this planned position; actual text is resolved from source_refs and individual exposure is unknown.', source_refs: [source.id], target_refs: c.core_knowledge.filter(goal => (goal.source_refs ?? []).includes(source.id) || phases.some(phase => phase.source_refs.includes(source.id) && phase.target_refs.includes(goal.id))).map(goal => goal.id), revealed_target_refs: [], provenance: `Supplied source instruction ${source.original_pointer ?? source.id}; ${note}`, disclosed_item_ids: [] }));
  const items = slots.map((slot, i) => {
    const id = ids[i], phase = phases.find(row => row.id === phaseOf(slot)), unscored = slot.family === 'self_report';
    const goals = unscored ? [] : [...goalsOf(slot)], sourceRefs = unscored ? [] : phase.source_refs.slice(0, 1);
    const relevant = events.filter(event => ids.indexOf(event.before_item_id) >= 0 && ids.indexOf(event.before_item_id) <= i && event.source_refs.some(ref => phase.source_refs.includes(ref))).map(event => event.id);
    return { item_id: id, purpose: slot.family === 'nonresponse' ? 'instruction' : 'practice', scope: 'static-design', goal_refs: goals, prior_event_refs: relevant, prepares_for_item_ids: slots.filter(later => (later.depends_on ?? []).includes(id)).map(idOf), measurement_intent: `${slot.family ?? slot.formats?.join('/')} ${slot.operation ?? slot.role}; static packet-authoring intention, not a mastery claim.`, expected_evidence: [{ id: `E-${id}`, goal_refs: goals, claim: unscored ? 'Record the declared unscored self-report; no knowledge correctness or mastery inference.' : slot.objective ?? `Perform the supplied ${slot.role} task using its declared target/source relationship. ${slot.support}`, source_refs: sourceRefs }], support: { mode: ['subcheck', 'guided_task'].includes(slot.role) ? 'guided' : unscored ? 'none' : 'source-visible', event_refs: relevant, source_refs: unscored ? [] : [...phase.source_refs], answer_exposure: 'allowed' } };
  });
  const goals = c.core_knowledge.map(row => row.id);
  return { version: 'instructional-plan/0.1', id: `PLAN-${request.request_id}`, lesson: { purpose: 'practice', scope: 'static-design', objective: context.lesson.learning_question, goal_refs: goals, purpose_note: note }, goal_authority: goals.map(goal_ref => ({ goal_ref, kind: authorityKind, source_refs: [], note })), events, items, sequence: { goal_coverage: goals.map(goal_ref => ({ goal_ref, item_ids: items.filter(item => item.goal_refs.includes(goal_ref)).map(item => item.item_id) })), support_transitions: items.slice(1).map((item, i) => ({ from_item_id: items[i].item_id, to_item_id: item.item_id, reason: `Preserve the supplied blueprint from ${items[i].measurement_intent} to ${item.measurement_intent}; support ${items[i].support.mode} to ${item.support.mode}. No variety or load policy inferred.` })) } };
}

export function mockSequencePlan(request, response) {
  const plan = compileInstructionalPlan(request);
  return { plan_id: plan.id, context_sha256: plan.context_sha256, lesson: plan.lesson, goal_authority: plan.goal_authority, goal_coverage: plan.sequence.goal_coverage, support_transitions: plan.sequence.support_transitions, items: plan.items.map((item, i) => {
    const returned = response.items[i];
    return { item_id: item.item_id, purpose: item.purpose, scope: item.scope, ...(item.measurement_intent ? { measurement_intent: item.measurement_intent } : {}), support: item.support, context_event_refs: item.prior_events.map(event => event.id), expected_evidence: item.expected_evidence.map((expected, j) => ({ expectation_id: expected.id, claim: expected.claim, field_refs: returned.view.rubric ? [`/view/rubric/criteria/${j}`] : expected.source_refs.length ? [...new Set(expected.source_refs.map(ref => returned.source_bindings.find(binding => binding.source_ref === ref)?.field_ref))] : [returned.view.scale ? '/view/scale' : returned.source_bindings[0]?.field_ref ?? '/view/instruction'] })) };
  }) };
}
