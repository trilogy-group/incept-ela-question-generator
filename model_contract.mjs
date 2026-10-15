import { validateSequencePlan } from './instructional_plan.mjs';
export class StructuralError extends Error {}

function fail(location, message) { throw new StructuralError(`${location}: ${message}`); }

export function resolve(value, pointer) {
  if (pointer === '') return value;
  if (!pointer.startsWith('/')) throw new StructuralError('JSON pointers must start with /');
  let selected = value;
  for (const part of pointer.slice(1).split('/')) {
    const key = part.replace(/~1/g, '/').replace(/~0/g, '~');
    if (selected === null || typeof selected !== 'object' || !Object.hasOwn(selected, key)) throw new StructuralError('JSON pointer does not resolve');
    selected = selected[key];
  }
  return selected;
}

const SUPPORTED = new Set(['$schema', 'title', 'description', 'type', 'required', 'properties', 'items', 'const', 'enum', 'additionalProperties', '$ref', '$defs', 'minLength', 'minItems', 'maxItems', 'minimum', 'allOf', 'if', 'then', 'else']);

export function validate(value, schema, location = 'packet', root = schema) {
  for (const key of Object.keys(schema)) if (!SUPPORTED.has(key)) fail(location, `unsupported schema keyword ${key}`);
  if (schema.$ref) return validate(value, resolve(root, schema.$ref.slice(1)), location, root);
  const types = { object: x => x !== null && typeof x === 'object' && !Array.isArray(x), array: Array.isArray, string: x => typeof x === 'string', integer: Number.isInteger };
  if (schema.type && (!types[schema.type] || !types[schema.type](value))) fail(location, `expected ${schema.type}`);
  if (Object.hasOwn(schema, 'const') && value !== schema.const) fail(location, 'constant differs');
  if (schema.enum && !schema.enum.includes(value)) fail(location, 'unsupported value');
  if (typeof value === 'string' && value.length < (schema.minLength ?? 0)) fail(location, 'string is too short');
  if (typeof value === 'number' && schema.minimum !== undefined && value < schema.minimum) fail(location, 'number is below minimum');
  if (Array.isArray(value)) {
    if (value.length < (schema.minItems ?? 0) || value.length > (schema.maxItems ?? Infinity)) fail(location, 'array length differs');
    if (schema.items) value.forEach((row, i) => validate(row, schema.items, `${location}[${i}]`, root));
  } else if (value !== null && typeof value === 'object') {
    for (const key of schema.required ?? []) if (!Object.hasOwn(value, key)) fail(location, `missing ${key}`);
    const props = schema.properties ?? {};
    if (schema.additionalProperties === false) for (const key of Object.keys(value)) if (!Object.hasOwn(props, key)) fail(location, `unexpected ${key}`);
    for (const [key, child] of Object.entries(props)) if (Object.hasOwn(value, key)) validate(value[key], child, `${location}.${key}`, root);
  }
  for (const child of schema.allOf ?? []) validate(value, child, location, root);
  if (schema.if) {
    let matched = true;
    try { validate(value, schema.if, location, root); } catch (e) { if (!(e instanceof StructuralError)) throw e; matched = false; }
    const branch = matched ? schema.then : schema.else;
    if (branch) validate(value, branch, location, root);
  }
}

function text(value, location) { if (typeof value !== 'string' || !value.trim()) fail(location, 'nonempty text required'); }
function unique(values, location) { if (new Set(values).size !== values.length) fail(location, 'duplicate values'); }

export function slotId(slot) { return slot.position?.id ?? slot.position?.slot_id ?? slot.position?.slot_ref; }
export function slotPage(slot) { return slot.position?.page ?? slot.position?.page_ref; }

export function validateInputs(request, context, requestSchema, contextSchema) {
  validate(request, requestSchema, 'request');
  validate(context, contextSchema, 'lesson-context');
  const course = request.course_context;
  if (!course.source_assets?.length || !course.core_knowledge?.length || !course.lesson_plan?.phases?.length) fail('request', 'explicit sources, knowledge and lesson plan required');
  const sources = new Map(course.source_assets.map(source => [source.id, source]));
  unique(course.source_assets.map(source => source.id), 'source assets');
  for (const source of sources.values()) text(source.text, `source ${source.id}`);
  const slots = request.sequence_blueprint;
  if (!slots.length) fail('sequence', 'explicit nonempty sequence blueprint required; task count is supplied by its author');
  unique(slots.map(slotId), 'slots');
  const pages = new Map(context.native.pages.map((page, i) => [page.id, i]));
  const targets = new Set(course.core_knowledge.map(target => target.id));
  let priorPage = -1;
  for (const slot of slots) {
    text(slotId(slot), 'slot id'); text(slotPage(slot), 'slot page');
    if (!pages.has(slotPage(slot))) fail(slotId(slot), 'page does not exist');
    const index = pages.get(slotPage(slot));
    if (index < priorPage) fail(slotId(slot), 'source pages and interaction order conflict');
    priorPage = index;
    if (!slot.formats?.length || !slot.target?.length || slot.target.some(ref => !targets.has(ref))) fail(slotId(slot), 'explicit format and existing targets required');
    const phase = course.lesson_plan.phases.find(row => row.id === slot.position?.phase_ref);
    if (!phase) fail(slotId(slot), 'explicit existing phase_ref required');
    if (!phase.source_refs?.length || phase.source_refs.some(ref => !sources.has(ref))) fail(slotId(slot), 'phase sources do not resolve');
    text(slot.support, slotId(slot));
  }
  // This is an equality check of public metadata, not a course-fit verdict.
  if (context.native.course_context && JSON.stringify(context.native.course_context) !== JSON.stringify(course)) fail('course context', 'request and transport course context differ');
  for (const slot of slots) {
    const page = context.native.pages[pages.get(slotPage(slot))];
    const placements = page.question_slots?.filter(row => row.id === slotId(slot));
    if (!placements || placements.length !== 1) fail(slotId(slot), 'one explicit empty native question slot is required');
  }
  return { sources, pages };
}

export function validateResponse(response, request, schema) {
  validate(response, schema, 'writer response');
  if (response.request_id !== request.request_id) fail('writer response', 'request identifier differs');
  if (response.status === 'held') {
    if (response.items.length || !response.holds.length) fail('held response', 'hold requires reasons and no items');
    return 0;
  }
  if (response.holds.length || response.items.length !== request.sequence_blueprint.length) fail('writer response', 'ordered slot count differs or unexpected holds');
  const sources = new Map(request.course_context.source_assets.map(source => [source.id, source]));
  response.items.forEach((item, i) => {
    const slot = request.sequence_blueprint[i], loc = slotId(slot);
    if (item.id !== loc || !slot.formats.includes(item.kind)) fail(loc, 'item identifier, order or declared format differs');
    const visible = request.course_context.lesson_plan.phases.find(phase => phase.id === slot.position.phase_ref).source_refs;
    const view = item.view;
    if (['reading_mcq', 'key_term_mcq'].includes(item.kind)) {
      text(view.stem, `${loc} stem`);
      if (!Array.isArray(view.options) || view.options.length < 3 || view.options.length > 5) fail(loc, 'choice requires three to five options');
      view.options.forEach((option, j) => text(option, `${loc} option ${j}`)); unique(view.options, `${loc} options`);
      if (!Array.isArray(view.key) || view.key.length !== 1 || !Number.isInteger(view.key[0]) || view.key[0] < 0 || view.key[0] >= view.options.length) fail(loc, 'choice requires one valid zero-based key');
      if (!Array.isArray(view.option_feedback) || view.option_feedback.length !== view.options.length) fail(loc, 'every option requires a rationale');
      view.option_feedback.forEach((feedback, j) => text(feedback, `${loc} rationale ${j}`)); text(view.correct_feedback, `${loc} explanation`);
      for (let j = 0; j < view.options.length; j++) if (!item.source_bindings.some(binding => binding.field_ref === `/view/options/${j}`)) fail(loc, `missing source binding for option ${j}`);
    } else if (item.kind === 'classify') {
      text(view.prompt, `${loc} prompt`);
      if (!Array.isArray(view.categories) || view.categories.length < 2 || !Array.isArray(view.entries) || !view.entries.length) fail(loc, 'explicit categories and entries required');
      const categoryIds = view.categories.map(row => row.id), entryIds = view.entries.map(row => row.id);
      unique(categoryIds, loc); unique(entryIds, loc);
      view.categories.forEach(row => { text(row.id, loc); text(row.label, loc); text(row.description, loc); });
      view.entries.forEach(row => { text(row.id, loc); text(row.text, loc); if (!categoryIds.includes(view.mapping?.[row.id])) fail(loc, 'classification key does not resolve'); });
      if (Object.keys(view.mapping).length !== entryIds.length) fail(loc, 'classification has extra keys');
      text(view.correct_feedback, `${loc} explanation`);
      if (!view.entry_feedback || entryIds.some(id => typeof view.entry_feedback[id] !== 'string')) fail(loc, 'classification requires an explanation for each entry');
    } else if (item.kind === 'evidence_select') {
      text(view.prompt, `${loc} prompt`); text(view.claim, `${loc} claim`);
      if (!Array.isArray(view.candidates) || view.candidates.length < 3 || !Array.isArray(view.key) || !view.key.length) fail(loc, 'explicit evidence candidates and key required');
      view.candidates.forEach((candidate, j) => text(candidate, `${loc} evidence ${j}`)); unique(view.candidates, loc); unique(view.key, loc);
      if (view.key.some(key => !Number.isInteger(key) || key < 0 || key >= view.candidates.length)) fail(loc, 'evidence key does not resolve');
      if (!Array.isArray(view.option_feedback) || view.option_feedback.length !== view.candidates.length) fail(loc, 'every evidence candidate requires a rationale');
      view.option_feedback.forEach((feedback, j) => text(feedback, `${loc} rationale ${j}`)); text(view.correct_feedback, `${loc} explanation`);
      for (let j = 0; j < view.candidates.length; j++) if (!item.source_bindings.some(binding => binding.field_ref === `/view/candidates/${j}` && binding.quote === view.candidates[j])) fail(loc, `candidate ${j} must be an exact bound source quotation`);
    } else {
      text(view.prompt, `${loc} prompt`); text(view.sample_answer, `${loc} sample answer`);
      if (!view.rubric || !Array.isArray(view.rubric.criteria) || !view.rubric.criteria.length) fail(loc, 'explicit analytic rubric required');
      unique(view.rubric.criteria.map(row => row.id), loc);
      view.rubric.criteria.forEach((criterion, j) => {
        text(criterion.id, loc); text(criterion.requirement, loc); text(criterion.accept_alternative, loc);
        if (!Number.isInteger(criterion.points) || criterion.points < 1 || criterion.points > 2) fail(loc, 'criterion points must be one or two');
        text(criterion.full_credit, loc); text(criterion.no_credit, loc);
        if (criterion.points === 2) text(criterion.partial_credit, loc);
        if (!item.source_bindings.some(binding => binding.field_ref === `/view/rubric/criteria/${j}`)) fail(loc, `missing criterion ${j} source binding`);
      });
      text(view.rubric.allocation, loc); text(view.rubric.combination_rules, loc); text(view.feedback, loc);
    }
    for (const binding of item.source_bindings) {
      if (!visible.includes(binding.source_ref) || !sources.get(binding.source_ref)?.text.includes(binding.quote)) fail(loc, 'evidence quote is missing from the visible source');
      resolve(item, binding.field_ref);
    }
  });
  validateSequencePlan(response, request);
  return response.items.length;
}

export function adaptResponse(request, suppliedContext, response, provenance) {
  if (response.status !== 'prepared-for-review') throw new StructuralError('Held response has no finished question transport');
  const context = structuredClone(suppliedContext);
  const originalSource = structuredClone(context.source);
  context.source = { ...provenance, lesson_source: originalSource };
  context.native.course_context = structuredClone(request.course_context);
  context.native.sequence_blueprint = structuredClone(request.sequence_blueprint);
  context.native.student_context = structuredClone(request.student_context ?? null);
  context.native.source_provenance = structuredClone(request.source_provenance ?? null);
  context.native.sequence_plan = structuredClone(response.sequence_plan);
  const items = response.items.map((generated, i) => {
    const slot = request.sequence_blueprint[i];
    const pageIndex = context.native.pages.findIndex(page => page.id === slotPage(slot));
    const page = context.native.pages[pageIndex];
    const native = { id: generated.id, type: generated.kind, ...structuredClone(generated.view), source_bindings: structuredClone(generated.source_bindings), knowledge_target: structuredClone(slot.target), sequence_role: slot.role, phase_ref: slot.position.phase_ref, support: slot.support };
    const questionIndex = page.question_slots.findIndex(row => row.id === generated.id);
    if (questionIndex < 0) throw new StructuralError('Generated question has no declared native slot');
    page.question_slots[questionIndex] = native;
    return { id: generated.id, page: page.id, order: i + 1, kind: generated.kind, pointer: `/pages/${pageIndex}/question_slots/${questionIndex}`, view: structuredClone(generated.view), native: structuredClone(native), alignment: structuredClone(slot.position.alignment), source_anchors: generated.source_bindings.map(binding => ({ source_ref: binding.source_ref, quote: binding.quote, pointer: `/native/course_context/source_assets/${request.course_context.source_assets.findIndex(source => source.id === binding.source_ref)}/text`, field_ref: binding.field_ref, relation: binding.relation })), source_bindings: structuredClone(generated.source_bindings) };
  });
  context.preparation_status = 'generated-for-review';
  const questionSet = { contract: 'question-set 0.1', source: structuredClone(context.source), lesson: context.lesson.id, made_by: { kind: 'generated', note: 'One source-grounded writer attempt, with only explicitly recorded structural repairs if needed. Independent academic review pending.' }, items, generation_metadata: structuredClone(provenance), sequence_plan: structuredClone(response.sequence_plan) };
  for (const item of items) if (JSON.stringify(resolve(context.native, item.pointer)) !== JSON.stringify(item.native)) throw new StructuralError('Finished native pointer differs');
  return { context, questionSet };
}

export function learnerPacket(context, questionSet) {
  const privateFields = new Set(['key', 'mapping', 'entry_feedback', 'option_feedback', 'correct_feedback', 'sample_answer', 'rubric', 'feedback', 'source_bindings']);
  const native = structuredClone(context.native);
  delete native.sequence_plan;
  delete native.sequence_blueprint;
  delete native.student_context;
  delete native.source_provenance;
  if (native.course_context) { delete native.course_context.instructional_plan; delete native.course_context.learner_history; }
  for (const page of native.pages) if (page.question_slots) page.question_slots = page.question_slots.map(question => Object.fromEntries(Object.entries(question).filter(([key]) => !privateFields.has(key))));
  return { contract: 'learner-packet 0.1', lesson: structuredClone(context.lesson), native, item_order: questionSet.items.map(item => item.id), response_release: 'All answer keys and feedback are withheld until after the complete sequence; teaching exposures remain explicit in course_context.' };
}
