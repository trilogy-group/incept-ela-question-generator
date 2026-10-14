// Optional native transport extension. Historical question-set 0.1 stays pinned.
import { StructuralError, resolve } from './model_contract.mjs';

export const NATIVE_PROTOCOL = 'question-lane-native/0.2';
const fail = (where, detail) => { throw new StructuralError(`${where}: ${detail}`); };
const text = (value, where) => { if (typeof value !== 'string' || !value.trim()) fail(where, 'nonempty text required'); };
const list = (value, where, minimum = 1) => { if (!Array.isArray(value) || value.length < minimum) fail(where, 'explicit nonempty list required'); return value; };
const unique = (values, where) => { if (new Set(values).size !== values.length) fail(where, 'duplicate identifiers'); };
const object = (value, where) => { if (!value || typeof value !== 'object' || Array.isArray(value)) fail(where, 'object required'); };

// Names are the collected public authoring kinds, not evaluator categories.
const groups = {
  single_choice: ['film_mcq', 'key_term_mcq', 'reading_mcq', 'mcq', 'multiple_choice', 'true_false', 'video_mcq', 'film_check', 'vocabulary_check', 'reflective_choice'],
  multiple_select: ['msq', 'multiple_select'],
  evidence_selection: ['evidence_select', 'evidence_selection', 'hot_text'],
  classification: ['classify', 'relation_board', 'rank_board'],
  written_response: ['annotation_check', 'closing_task', 'dialogue_branch_prompt', 'dialogue_follow_up', 'guided_check', 'guided_quote', 'open_check', 'open_prompt', 'paragraph_checklist', 'quote_analysis', 'reading_check', 'reading_note_recall', 'relation_name', 'retrieval', 'scaffolded_short_response', 'scr', 'soliloquy_comparison', 'stage_move', 'staging_comparison', 'we_do', 'writing_blank', 'writing_stem'],
  oral_response: ['dialogue', 'oral_microtask', 'oral_turn', 'spoken_response'],
  word_web: ['word_web', 'vocabulary_routine'],
  word_selection: ['quote_word_selection'],
  inline_choice: ['cloze', 'inline_choice', 'model_rebuild_gap', 'rebuild_choice', 'vocabulary_gap'],
  matching: ['match', 'matching'],
  sequence: ['sequence'],
  self_report: ['confidence_self_report'],
  say_back: ['say_back'],
  nonresponse: ['model_paragraph', 'worked_example'],
  composite: ['argument_round', 'ebsr', 'ebsr_part'],
};
const defaults = { single_choice: 'single_choice', evidence_selection: 'evidence_selection', classification: 'classification', written_response: 'short_explanation', oral_response: 'short_explanation' };
export const FORMAT_DISPATCH = Object.freeze(Object.fromEntries(Object.entries(groups).flatMap(([family, kinds]) => kinds.map(kind => [kind, {
  native_kind: kind, family, public_format: defaults[family] ?? `adapter_extension/${family}`,
  output_contract: `native-view/${family}/0.2`,
  assessment_role: family === 'nonresponse' ? 'instruction-only' : ['self_report', 'say_back'].includes(family) ? 'unscored-report-or-recall' : 'declared-per-slot',
}]))));

export function dispatch(slot) {
  const declared = FORMAT_DISPATCH[slot.native_kind];
  if (!declared) fail(slot.id, `unsupported native kind ${slot.native_kind}`);
  if (declared.family !== 'composite') {
    if (slot.family !== declared.family) fail(slot.id, 'native kind and response family differ');
  } else if (slot.native_kind === 'argument_round') {
    const rounds = { ask: ['written_response', 'learner_question'], explain: ['written_response', 'short_explanation'], rebut: ['written_response', 'rebuttal'] };
    const expected = rounds[slot.operation];
    if (!expected || slot.family !== expected[0] || slot.public_format !== expected[1]) fail(slot.id, 'argument round requires explicit ask/explain/rebut operation');
  } else if (slot.family !== 'single_choice' || slot.public_format !== 'single_choice') {
    fail(slot.id, 'EBSR requires declared dependent single-choice parts; whole composite cannot be flattened');
  } else if (!['claim', 'evidence'].includes(slot.native_context?.part) || !slot.native_context?.composite_parent || (slot.native_context.part === 'evidence' && !slot.depends_on?.length)) {
    fail(slot.id, 'EBSR requires explicit claim/evidence part, parent and evidence dependency');
  }
  if (declared.family !== 'composite' && slot.public_format !== declared.public_format && !(['written_response', 'oral_response'].includes(slot.family) && ['short_explanation', 'learner_question', 'rebuttal', 'integrated_response'].includes(slot.public_format))) fail(slot.id, 'public format does not match native response operation');
  return { ...declared, family: slot.family, public_format: slot.public_format };
}

const forbidden = new Set(['evaluator_prompt', 'evaluator_results', 'holdout', 'holdout_labels', 'gold_labels', 'judge_prompt', 'private_cases', 'benchmark_cases']);
function publicBoundary(value, path = 'request') {
  if (Array.isArray(value)) value.forEach((row, i) => publicBoundary(row, `${path}/${i}`));
  else if (value && typeof value === 'object') for (const [key, child] of Object.entries(value)) {
    if (forbidden.has(key.toLowerCase())) fail(path, 'private assessment material outside public generation boundary');
    publicBoundary(child, `${path}/${key}`);
  }
}

export function validateNativeInputs(request, context, catalog) {
  publicBoundary(request); publicBoundary(context);
  if (request.protocol !== NATIVE_PROTOCOL) fail('request', 'native extension protocol required');
  text(request.request_id, 'request id'); object(request.course_context, 'course context');
  const c = request.course_context;
  const sourceIds = list(c.source_assets, 'source assets').map(row => row.id);
  const targets = list(c.core_knowledge, 'knowledge goals').map(row => row.id);
  unique(sourceIds, 'source assets'); unique(targets, 'knowledge goals');
  for (const source of c.source_assets) { text(source.id, 'source id'); text(source.text, source.id); text(source.original_pointer, source.id); object(source.provenance, source.id); }
  for (const knowledge of c.core_knowledge) { text(knowledge.claim, knowledge.id); text(knowledge.performance, knowledge.id); list(knowledge.source_refs, knowledge.id).forEach(ref => { if (!sourceIds.includes(ref)) fail(knowledge.id, 'knowledge source does not resolve'); }); }
  for (const key of ['prerequisites', 'learner_constraints', 'prior_exposure', 'content_keys', 'knowledge_map', 'pairing_map']) if (!Object.hasOwn(c, key)) fail('course context', `missing explicit ${key}`);
  object(c.learner_constraints, 'learner constraints'); text(c.learner_constraints.status, 'learner constraints status');
  object(c.prior_exposure, 'prior exposure'); text(c.prior_exposure.status, 'prior exposure status'); list(c.prior_exposure.events, 'exposure events', 0);
  const contentKeys = list(c.content_keys, 'content keys').map(row => row.id); unique(contentKeys, 'content keys');
  c.content_keys.forEach(row => { text(row.claim, row.id); list(row.source_refs, row.id).forEach(ref => { if (!sourceIds.includes(ref)) fail(row.id, 'content source does not resolve'); }); });
  list(c.prerequisites, 'prerequisites', 0).forEach(row => { text(row.id, 'prerequisite'); text(row.status, row.id); });
  list(c.knowledge_map, 'knowledge map').forEach(row => { if (!targets.includes(row.knowledge_ref) || !contentKeys.includes(row.content_key_ref)) fail('knowledge map', 'reference does not resolve'); });
  const pairs = list(c.pairing_map, 'pairing map', 0); unique(pairs.map(row => row.id), 'pairing map');
  pairs.forEach(row => { list(row.knowledge_refs, row.id).forEach(ref => { if (!targets.includes(ref)) fail(row.id, 'pair knowledge does not resolve'); }); });
  const phases = list(c.lesson_plan?.phases, 'lesson phases'); unique(phases.map(row => row.id), 'phases');
  const media = c.media_assets ?? []; list(media, 'media assets', 0); unique(media.map(row => row.id), 'media assets');
  media.forEach(row => { text(row.id, 'media id'); text(row.src, row.id); text(row.original_pointer, row.id); text(row.transcript_status, row.id); object(row.provenance, row.id); });
  const pages = list(context.native?.pages, 'native pages'); unique(pages.map(row => row.id), 'pages');
  if (JSON.stringify(context.native.course_context) !== JSON.stringify(c)) fail('course context', 'request and context differ');
  const publicFormats = new Set(list(catalog.formats, 'public formats').map(row => row.id));
  const slots = list(request.sequence_blueprint, 'sequence slots'); unique(slots.map(row => row.id), 'slots');
  let previousPage = -1;
  slots.forEach((slot, i) => {
    text(slot.id, 'slot'); dispatch(slot); text(slot.objective, slot.id); text(slot.support, slot.id); text(slot.role, slot.id);
    if (!publicFormats.has(slot.public_format) && !slot.public_format.startsWith('adapter_extension/')) fail(slot.id, 'unknown public format');
    const pageIndex = pages.findIndex(row => row.id === slot.page_ref);
    if (pageIndex < previousPage || pageIndex < 0) fail(slot.id, 'page order does not resolve'); previousPage = pageIndex;
    const phase = phases.find(row => row.id === slot.phase_ref);
    if (!phase) fail(slot.id, 'phase does not resolve');
    list(phase.source_refs, phase.id).forEach(ref => { if (!sourceIds.includes(ref)) fail(phase.id, 'visible source missing'); });
    (phase.media_context_refs ?? []).forEach(ref => { if (!media.some(row => row.id === ref)) fail(phase.id, 'media context reference does not resolve'); });
    (slot.native_context.required_media_refs ?? []).forEach(ref => {
      const row = media.find(row => row.id === ref);
      if (!row || row.transcript_status !== 'supplied' || !row.transcript_source_ref || !phase.source_refs.includes(row.transcript_source_ref)) fail(slot.id, 'required media content lacks a supplied visible transcript; no media facts inferred');
    });
    list(slot.target_refs, slot.id).forEach(ref => { if (!targets.includes(ref)) fail(slot.id, 'knowledge target does not resolve'); });
    list(slot.content_key_refs, slot.id).forEach(ref => { if (!contentKeys.includes(ref)) fail(slot.id, 'content key does not resolve'); });
    list(slot.pair_refs, slot.id, 0).forEach(ref => { if (!pairs.some(row => row.id === ref)) fail(slot.id, 'pair does not resolve'); });
    text(slot.source_pointer, slot.id); text(slot.context_pointer, slot.id); object(slot.native_context, slot.id);
    list(slot.depends_on, slot.id, 0).forEach(ref => { if (!slots.slice(0, i).some(row => row.id === ref)) fail(slot.id, 'dependency must refer to an earlier slot'); });
    const found = pages[pageIndex].question_slots.filter(row => row.id === slot.id);
    if (found.length !== 1) fail(slot.id, 'one declared empty question slot required');
    if ((slot.family === 'single_choice' && slot.native_kind.includes('film')) || slot.native_kind === 'video_mcq') {
      const media = c.source_assets.filter(row => phase.source_refs.includes(row.id) && row.kind === 'media-transcript');
      if (!media.length || media.some(row => !row.media_ref || !row.time_range)) fail(slot.id, 'film task requires supplied media reference, transcript and time range');
    }
    if (slot.native_kind === 'quote_analysis' && !['paraphrase', 'interpretation'].includes(slot.operation)) fail(slot.id, 'quote analysis subcheck scope required');
    if (slot.native_kind === 'quote_word_selection' && (!slot.native_context.quote || !slot.native_context.allowed_words?.length || !slot.native_context.word_class_options?.length)) fail(slot.id, 'word selection requires exact quotation, declared candidate words and class options');
    if (slot.family === 'say_back' && !slot.native_context.recall_source_ref) fail(slot.id, 'say-back requires a supplied recall statement');
    if (slot.family === 'inline_choice' && !slot.native_context.surrounding_text) fail(slot.id, 'rebuild requires surrounding taught sentence context');
    if (slot.public_format === 'rebuttal' && !slot.native_context.counterclaim) fail(slot.id, 'rebuttal requires a frozen supplied counterpart claim');
    if (slot.family === 'classification' && !slot.native_context.category_dimensions?.length) fail(slot.id, 'classification requires supplied entity and relation dimensions');
    if (slot.family === 'matching' && !slot.native_context.match_relation) fail(slot.id, 'matching requires a supplied relation');
    if (slot.family === 'sequence' && !slot.native_context.ordering_rule) fail(slot.id, 'sequence requires a supplied ordering relation');
    if (slot.family === 'self_report' && !slot.native_context.scale?.length) fail(slot.id, 'self-report requires a supplied scale');
  });
  return slots.length;
}

function rubric(view, loc, required) {
  text(view.sample_answer, `${loc} sample answer`); text(view.feedback, `${loc} feedback`);
  object(view.rubric, `${loc} rubric`); text(view.rubric.allocation, loc); text(view.rubric.combination_rules, loc);
  const criteria = list(view.rubric.criteria, `${loc} criteria`); unique(criteria.map(row => row.id), loc);
  criteria.forEach((row, i) => {
    text(row.id, loc); text(row.requirement, loc); text(row.accept_alternative, loc); text(row.full_credit, loc); text(row.no_credit, loc);
    if (![1, 2].includes(row.points)) fail(loc, 'criterion points must be one or two');
    if (row.points === 2) text(row.partial_credit, loc);
    required.push(`/view/rubric/criteria/${i}`);
  }); required.push('/view/sample_answer', '/view/feedback');
}

export function validateNativeResponse(response, request) {
  if (!response || Object.keys(response).some(k => !['protocol', 'request_id', 'status', 'holds', 'items'].includes(k))) fail('response', 'unexpected response field');
  if (response.protocol !== NATIVE_PROTOCOL || response.request_id !== request.request_id) fail('response', 'protocol or request identifier differs');
  list(response.items, 'items', 0); list(response.holds, 'holds', 0);
  if (response.status === 'held') { if (response.items.length || !response.holds.length) fail('response', 'hold needs reasons and no items'); response.holds.forEach(row => { text(row.code, 'hold'); text(row.detail, 'hold'); }); return 0; }
  if (response.status !== 'prepared-for-review' || response.holds.length || response.items.length !== request.sequence_blueprint.length) fail('response', 'slot count/status differs');
  response.items.forEach((item, i) => {
    const slot = request.sequence_blueprint[i], d = dispatch(slot), loc = slot.id;
    if (item.id !== loc || item.kind !== slot.native_kind || item.public_format !== slot.public_format || item.family !== d.family) fail(loc, 'native kind, format, family or order differs');
    if (Object.keys(item).some(k => !['id', 'kind', 'family', 'public_format', 'view', 'source_bindings'].includes(k))) fail(loc, 'unexpected item field');
    const v = item.view; object(v, loc); const required = [];
    const allowed = {
      single_choice: ['prompt', 'options', 'key', 'option_feedback', 'correct_feedback'], multiple_select: ['prompt', 'options', 'key', 'option_feedback', 'correct_feedback'], evidence_selection: ['prompt', 'options', 'key', 'option_feedback', 'correct_feedback', 'claim', 'selection_rule'], word_selection: ['prompt', 'options', 'key', 'option_feedback', 'correct_feedback', 'word_classes'], classification: ['prompt', 'categories', 'entries', 'mapping', 'entry_feedback', 'correct_feedback'], written_response: ['prompt', 'response_mode', 'sample_answer', 'feedback', 'rubric', 'response_parts'], oral_response: ['prompt', 'response_mode', 'sample_answer', 'feedback', 'rubric', 'response_parts'], word_web: ['prompt', 'response_mode', 'sample_answer', 'feedback', 'rubric', 'centre', 'link_rule', 'response_parts'], inline_choice: ['prompt', 'surrounding_text', 'blanks'], matching: ['prompt', 'entries', 'options', 'mapping', 'feedback'], sequence: ['prompt', 'entries', 'key', 'feedback'], self_report: ['prompt', 'scale', 'scoring'], say_back: ['prompt', 'statement', 'scoring'], nonresponse: ['instruction'],
    };
    if (Object.keys(v).some(k => !allowed[d.family].includes(k))) fail(loc, 'unexpected view field');
    if (d.family === 'nonresponse') { text(v.instruction, loc); if (Object.hasOwn(v, 'key') || Object.hasOwn(v, 'rubric')) fail(loc, 'instruction-only row cannot have a scoring key'); required.push('/view/instruction'); }
    else {
      text(v.prompt, loc);
      if (['single_choice', 'multiple_select', 'evidence_selection', 'word_selection'].includes(d.family)) {
        const options = list(v.options, loc, d.family === 'word_selection' ? 1 : slot.native_kind === 'true_false' ? 2 : 3); options.forEach(option => text(option, loc)); unique(options, loc);
        const key = list(v.key, `${loc} key`); unique(key, loc);
        if (key.some(x => !Number.isInteger(x) || x < 0 || x >= options.length) || d.family === 'single_choice' && key.length !== 1) fail(loc, 'choice key does not resolve');
        if (list(v.option_feedback, loc).length !== options.length) fail(loc, 'choice feedback count differs'); v.option_feedback.forEach(row => text(row, loc)); text(v.correct_feedback, loc);
        options.forEach((option, n) => { required.push(`/view/options/${n}`, `/view/option_feedback/${n}`); if (d.family === 'word_selection' && !slot.native_context.allowed_words.includes(option)) fail(loc, 'selected word absent from supplied quotation'); });
        required.push('/view/correct_feedback');
        if (d.family === 'evidence_selection') { text(v.claim, loc); text(v.selection_rule, loc); required.push('/view/claim'); }
        if (d.family === 'word_selection') {
          object(v.word_classes, loc);
          if (Object.keys(v.word_classes).length !== key.length || key.some(index => !slot.native_context.word_class_options.includes(v.word_classes[index]))) fail(loc, 'selected word requires a declared class');
          key.forEach(index => required.push(`/view/word_classes/${index}`));
        }
      } else if (d.family === 'classification') {
        const categories = list(v.categories, loc, 2), entries = list(v.entries, loc); unique(categories.map(x => x.id), loc); unique(entries.map(x => x.id), loc);
        categories.forEach(row => { text(row.id, loc); text(row.label, loc); text(row.entity, loc); text(row.relation, loc); text(row.description, loc); });
        object(v.mapping, loc); object(v.entry_feedback, loc);
        if (Object.keys(v.mapping).length !== entries.length || Object.keys(v.entry_feedback).length !== entries.length) fail(loc, 'classification key/feedback count differs');
        entries.forEach((row, n) => { text(row.id, loc); text(row.text, loc); if (!categories.some(category => category.id === v.mapping[row.id])) fail(loc, 'classification category missing'); text(v.entry_feedback[row.id], loc); required.push(`/view/entries/${n}`, `/view/entry_feedback/${row.id}`); }); text(v.correct_feedback, loc); required.push('/view/correct_feedback');
      } else if (['written_response', 'oral_response', 'word_web'].includes(d.family)) {
        if (v.response_mode !== (d.family === 'oral_response' ? 'spoken' : 'written')) fail(loc, 'response modality differs');
        if (slot.native_context.response_parts && JSON.stringify(v.response_parts) !== JSON.stringify(slot.native_context.response_parts)) fail(loc, 'native composite response parts differ');
        if (d.family === 'word_web') { text(v.centre, loc); text(v.link_rule, loc); list(v.response_parts, loc); }
        rubric(v, loc, required);
      } else if (d.family === 'inline_choice') {
        text(v.surrounding_text, loc); if (v.surrounding_text !== slot.native_context.surrounding_text) fail(loc, 'rebuild surrounding text differs'); const blanks = list(v.blanks, loc); unique(blanks.map(row => row.id), loc);
        blanks.forEach((row, n) => { text(row.id, loc); const options = list(row.options, loc, 2); unique(options, loc); options.forEach(x => text(x, loc)); if (!Number.isInteger(row.key) || row.key < 0 || row.key >= options.length) fail(loc, 'blank key missing'); if (list(row.option_feedback, loc).length !== options.length) fail(loc, 'blank feedback count differs'); options.forEach((x, j) => { text(row.option_feedback[j], loc); required.push(`/view/blanks/${n}/options/${j}`, `/view/blanks/${n}/option_feedback/${j}`); }); });
      } else if (['matching', 'sequence'].includes(d.family)) {
        const entries = list(v.entries, loc, 2); unique(entries.map(row => row.id), loc); entries.forEach((row, n) => { text(row.id, loc); text(row.text, loc); required.push(`/view/entries/${n}`); });
        if (d.family === 'matching') { const options = list(v.options, loc, 2); unique(options.map(row => row.id), loc); object(v.mapping, loc); if (Object.keys(v.mapping).length !== entries.length) fail(loc, 'matching mapping count differs'); entries.forEach(row => { if (!options.some(option => option.id === v.mapping[row.id])) fail(loc, 'matching key missing'); }); }
        else { const key = list(v.key, loc, entries.length); if (key.length !== entries.length || new Set(key).size !== entries.length || key.some(ref => !entries.some(row => row.id === ref))) fail(loc, 'sequence key must be full permutation'); }
        text(v.feedback, loc); required.push('/view/feedback');
      } else if (d.family === 'self_report') {
        list(v.scale, loc, 2).forEach(x => text(x, loc)); if (JSON.stringify(v.scale) !== JSON.stringify(slot.native_context.scale)) fail(loc, 'confidence scale differs from supplied context'); if (v.scoring !== 'none' || ['key', 'rubric', 'sample_answer'].some(k => Object.hasOwn(v, k))) fail(loc, 'confidence report cannot have correctness scoring');
      } else if (d.family === 'say_back') {
        text(v.statement, loc); if (v.scoring !== 'unscored-recall' || ['key', 'rubric'].some(k => Object.hasOwn(v, k))) fail(loc, 'say-back is not independent reasoning measurement'); required.push('/view/statement');
      } else fail(loc, 'output family not implemented');
    }
    const bindings = list(item.source_bindings, `${loc} bindings`, required.length ? 1 : 0);
    required.forEach(pointer => { if (!bindings.some(row => row.field_ref === pointer)) fail(loc, `missing binding ${pointer}`); });
    const phase = request.course_context.lesson_plan.phases.find(row => row.id === slot.phase_ref);
    bindings.forEach(binding => {
      if (Object.keys(binding).some(k => !['source_ref', 'quote', 'field_ref', 'relation'].includes(k))) fail(loc, 'unexpected source binding field');
      text(binding.relation, loc); text(binding.quote, loc);
      const source = request.course_context.source_assets.find(row => row.id === binding.source_ref);
      if (!phase.source_refs.includes(binding.source_ref) || !source?.text.includes(binding.quote)) fail(loc, 'quote missing from visible source');
      const field = resolve(item, binding.field_ref);
      if (d.family === 'evidence_selection' && /^\/view\/options\//.test(binding.field_ref) && field !== binding.quote) fail(loc, 'evidence choice must equal bound source quotation');
      if (d.family === 'say_back' && binding.field_ref === '/view/statement' && (field !== binding.quote || source.id !== slot.native_context.recall_source_ref)) fail(loc, 'say-back must use supplied recall statement exactly');
    });
  }); return response.items.length;
}

export function adaptNativeResponse(request, suppliedContext, response, provenance) {
  validateNativeResponse(response, request); if (response.status === 'held') fail('response', 'hold has no finished transport');
  const context = structuredClone(suppliedContext); context.source = { ...provenance, lesson_source: structuredClone(suppliedContext.source) };
  const items = response.items.map((generated, i) => {
    const slot = request.sequence_blueprint[i]; const p = context.native.pages.findIndex(page => page.id === slot.page_ref); const q = context.native.pages[p].question_slots.findIndex(row => row.id === slot.id);
    const native = { ...structuredClone(generated), source_context: structuredClone(slot), academic_quality: 'unmeasured' }; context.native.pages[p].question_slots[q] = native;
    return { ...structuredClone(generated), order: i + 1, page: slot.page_ref, pointer: `/pages/${p}/question_slots/${q}`, native, alignment: { target_refs: slot.target_refs, content_key_refs: slot.content_key_refs, pair_refs: slot.pair_refs, phase_ref: slot.phase_ref, support: slot.support, role: slot.role, depends_on: slot.depends_on, source_pointer: slot.source_pointer, context_pointer: slot.context_pointer } };
  });
  const questionSet = { contract: 'question-set native 0.2', adapter_extension: 'native-activity-transport/0.2', lesson: context.lesson.id, source: structuredClone(context.source), items, generation_metadata: provenance };
  items.forEach(item => { if (JSON.stringify(resolve(context.native, item.pointer)) !== JSON.stringify(item.native)) fail(item.id, 'native pointer mismatch'); });
  return { context, questionSet };
}

export function nativeLearnerPacket(context, questionSet) {
  const privateKeys = new Set(['key', 'mapping', 'entry_feedback', 'option_feedback', 'correct_feedback', 'sample_answer', 'rubric', 'feedback', 'source_bindings', 'source_context']);
  privateKeys.add('word_classes');
  const strip = value => Array.isArray(value) ? value.map(strip) : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).filter(([k]) => !privateKeys.has(k)).map(([k, v]) => [k, strip(v)])) : value;
  const native = structuredClone(context.native); native.pages.forEach(page => { page.question_slots = page.question_slots.map(strip); });
  return { contract: 'learner-packet native 0.2', lesson: context.lesson, native, item_order: questionSet.items.map(row => row.id), response_release: 'Keys and feedback withheld until the complete sequence; declared teaching exposures remain visible.' };
}

export function nativeWriterMessages(request, context, schema, methods, formats) {
  return [{ role: 'system', content: 'Write one original source-grounded activity per declared slot, in order, matching the supplied native extension contracts. Preserve native kinds, public format, response family, operation, dependency, source scope, learner constraints and support. Use only supplied source_assets text and media transcripts as factual authority. Never invent missing learner history, sources, media, knowledge or counterpart claims. Source reference pointers describe authoring context, not questions to copy. The packet deliberately omits original questions, keys and marking rules. Return a typed held response with no items when required context is missing. Use exact quote bindings for every factual option, option rationale, sample answer, feedback and rubric criterion; each binding has source_ref, quote, field_ref and relation. Evidence selection options must be exact quotations. Keep entity and semantic relation explicit in classification. Composite subchecks stay separate and retain dependencies. Word analysis preserves the exact supplied quote and permitted words. Rebuild choices use surrounding taught sentence context. Say-back is unscored recall; confidence is unscored self-report; worked examples are instruction only. Proposed rubrics require source-supported meaning and reasoning, alternative answers and combination rules. Do not infer quality, readiness or mastery from valid transport. No judge, evaluator or tools. Return only JSON.' }, { role: 'user', content: JSON.stringify({ request, lesson_context: context, writer_response_schema: schema, output_contracts: VIEW_CONTRACTS, dispatch: FORMAT_DISPATCH, public_methods: methods.cards.map(({ id, claim, actions, limits }) => ({ id, claim, actions, limits })), public_formats: formats.formats.map(({ id, conditions, teacher_key }) => ({ id, conditions, teacher_key })) }) }];
}

export const VIEW_CONTRACTS = {
  single_choice: 'prompt, options:[string], key:[one index], option_feedback:[string], correct_feedback; bind each option, rationale and explanation',
  multiple_select: 'prompt, options:[string], key:[distinct indices], option_feedback:[string], correct_feedback; bind all options and explanations',
  evidence_selection: 'as multiple_select; each option equals its exact visible quote binding',
  classification: 'prompt, categories:[{id,label,entity,relation,description}], entries:[{id,text}], mapping:{entry:category}, entry_feedback:{entry:reason}, correct_feedback',
  written_response: 'prompt, response_mode:written, sample_answer, feedback, rubric:{criteria:[{id,requirement,points,full_credit,partial_credit if 2 points,no_credit,accept_alternative}],allocation,combination_rules}',
  oral_response: 'as written_response with response_mode:spoken; transcription/recognition capability is not asserted',
  word_web: 'as written_response plus centre, link_rule, response_parts:[string]; classify this as guided semantic production, not independent mastery',
  word_selection: 'as multiple_select using exact supplied allowed_words from quote, plus word_classes:{selected-index:declared-class}; bind each class to its source word and grammatical relation',
  inline_choice: 'prompt, surrounding_text, blanks:[{id,options:[string],key:index,option_feedback:[string]}]; all options and explanations bound',
  matching: 'prompt, entries:[{id,text}], options:[{id,text}], mapping:{entry:option}, feedback',
  sequence: 'prompt, entries:[{id,text}], key:[all entry ids in order], feedback',
  self_report: 'prompt, scale:[string], scoring:none; no key or rubric or implied correctness',
  say_back: 'prompt, statement:exact supplied recall statement, scoring:unscored-recall',
  nonresponse: 'instruction:string; no question key or rubric',
};
