// Offline fixtures exercise transport. They are never claimed generated teaching quality.
import { FORMAT_DISPATCH, NATIVE_PROTOCOL, dispatch } from './native_formats.mjs';

export function mockNativeResponse(request) {
  const items = request.sequence_blueprint.map(slot => {
    const family = dispatch(slot).family;
    const phase = request.course_context.lesson_plan.phases.find(row => row.id === slot.phase_ref);
    const source = request.course_context.source_assets.find(row => phase.source_refs.includes(row.id));
    const quote = source.text.split('\n').find(x => x.trim());
    const view = { prompt: `OFFLINE TRANSPORT FIXTURE: ${slot.objective}` };
    const item = { id: slot.id, kind: slot.native_kind, family, public_format: slot.public_format, view, source_bindings: [] };
    const bind = (field_ref, selectedSource = source, selectedQuote = quote) => item.source_bindings.push({ field_ref, source_ref: selectedSource.id, quote: selectedQuote, relation: 'Offline structural fixture binding only; no academic endorsement or generated question quality asserted.' });
    const rationale = 'Offline rationale fixture; content quality deliberately unmeasured.';
    const frozen = field => { const value = slot.native_context[field]; view[field] = value; const owner = request.course_context.source_assets.find(row => phase.source_refs.includes(row.id) && row.text.includes(value)); if (!owner) throw new Error(`${slot.id}: frozen ${field} has no visible source`); bind(`/view/${field}`, owner, value); };
    if (slot.public_format === 'rebuttal') frozen('counterclaim');
    if (['quote_analysis', 'quote_word_selection'].includes(slot.native_kind)) frozen('quote');
    if (['dialogue', 'dialogue_branch_prompt', 'dialogue_follow_up'].includes(slot.native_kind)) frozen('counterpart_turn');
    if (['single_choice', 'multiple_select', 'evidence_selection', 'word_selection'].includes(family)) {
      if (family === 'word_selection') view.options = [...slot.native_context.allowed_words];
      else if (family === 'evidence_selection') {
        view.options = [...new Set(phase.source_refs.flatMap(ref => request.course_context.source_assets.find(row => row.id === ref).text.split('\n')).filter(row => row.trim()))].slice(0, 3);
        view.claim = 'Offline claim fixture: evidence binding mechanism only.'; view.selection_rule = 'Select all declared fixture keys.'; bind('/view/claim');
      } else view.options = slot.native_kind === 'true_false' ? ['Offline true option', 'Offline false option'] : ['Offline option A', 'Offline option B', 'Offline option C'];
      view.key = family === 'multiple_select' ? [0, 2] : [0]; view.option_feedback = view.options.map(() => rationale); view.correct_feedback = rationale;
      if (family === 'multiple_select') view.selection_rule = slot.native_context.selection_rule;
      view.options.forEach((option, i) => {
        const owner = family === 'evidence_selection' ? request.course_context.source_assets.find(row => phase.source_refs.includes(row.id) && row.text.includes(option)) : source;
        bind(`/view/options/${i}`, owner, family === 'evidence_selection' ? option : quote); bind(`/view/option_feedback/${i}`);
      }); bind('/view/correct_feedback');
      if (family === 'word_selection') { view.word_classes = { 0: slot.native_context.word_class_options[0] }; bind('/view/word_classes/0'); }
    } else if (family === 'classification') {
      const dimensions = slot.native_context.category_dimensions;
      view.categories = dimensions.map((row, i) => ({ id: `category-${i}`, label: `${row.entity}: ${row.relation}`, entity: row.entity, relation: row.relation, description: 'Offline category definition fixture.' }));
      view.entries = [{ id: 'entry-1', text: 'Offline classification entry' }]; view.mapping = { 'entry-1': view.categories[0].id }; view.entry_feedback = { 'entry-1': rationale }; view.correct_feedback = rationale;
      bind('/view/entries/0'); bind('/view/entry_feedback/entry-1'); bind('/view/correct_feedback');
    } else if (['written_response', 'oral_response', 'word_web'].includes(family)) {
      view.response_mode = family === 'oral_response' ? 'spoken' : 'written'; view.sample_answer = `Offline answer fixture anchored to: ${quote}`; view.feedback = rationale;
      if (slot.native_context.response_parts) view.response_parts = slot.native_context.response_parts;
      view.rubric = { criteria: [{ id: 'criterion-1', requirement: 'Offline criterion checks this source relation; no academic validity claimed.', points: 1, full_credit: 'The fixture requirement is met.', no_credit: 'The fixture requirement is absent.', accept_alternative: 'Equivalent source-supported wording can be reviewed.' }], allocation: 'One illustrative point.', combination_rules: 'Fixture only; cannot establish learner outcome.' };
      bind('/view/sample_answer'); bind('/view/feedback'); bind('/view/rubric/criteria/0');
      if (family === 'word_web') { view.centre = slot.native_context.centre; view.link_rule = 'Name and explain a semantic relation.'; view.response_parts = ['word', 'relation', 'reason']; }
    } else if (family === 'inline_choice') {
      view.surrounding_text = slot.native_context.surrounding_text; view.blanks = [{ id: 'blank-1', options: ['Offline choice A', 'Offline choice B'], key: 0, option_feedback: [rationale, rationale] }];
      [0, 1].forEach(i => { bind(`/view/blanks/0/options/${i}`); bind(`/view/blanks/0/option_feedback/${i}`); });
    } else if (family === 'shared_cloze') {
      view.surrounding_text = slot.native_context.surrounding_text; view.bank = [{ id: 'bank-1', text: 'Offline bank word A' }, { id: 'bank-2', text: 'Offline bank word B' }]; view.blanks = [{ id: 'blank-1', key: 'bank-1', feedback: rationale }, { id: 'blank-2', key: 'bank-2', feedback: rationale }]; view.reuse_policy = 'single-use';
      view.bank.forEach((row, i) => bind(`/view/bank/${i}`)); view.blanks.forEach((row, i) => bind(`/view/blanks/${i}/feedback`));
    } else if (family === 'matching' || family === 'sequence') {
      view.entries = [{ id: 'entry-1', text: 'Offline source entry A' }, { id: 'entry-2', text: 'Offline source entry B' }];
      view.entries.forEach((row, i) => bind(`/view/entries/${i}`));
      if (family === 'matching') {
        view.options = [{ id: 'option-1', text: 'Offline matching option A' }, { id: 'option-2', text: 'Offline matching option B' }];
        view.mapping = { 'entry-1': 'option-1', 'entry-2': 'option-2' };
        view.options.forEach((row, i) => bind(`/view/options/${i}`));
      } else { view.key = ['entry-2', 'entry-1']; view.ordering_rule = slot.native_context.ordering_rule; view.tie_policy = slot.native_context.tie_policy; }
      view.feedback = rationale; bind('/view/feedback');
    } else if (family === 'nonresponse') {
      delete view.prompt; view.instruction = 'Offline source-grounded instruction fixture; no response or score.'; bind('/view/instruction');
    } else if (family === 'say_back') {
      const recall = request.course_context.source_assets.find(row => row.id === slot.native_context.recall_source_ref);
      view.statement = recall.text; view.scoring = 'unscored-recall'; bind('/view/statement', recall, recall.text);
    } else if (family === 'self_report') { view.scale = slot.native_context.scale; view.scoring = 'none'; }
    else throw new Error(`No mock source fixture supplied for ${family}`);
    return item;
  });
  return { protocol: NATIVE_PROTOCOL, request_id: request.request_id, status: 'prepared-for-review', holds: [], items };
}

export function formatCoverage(request, counts = {}, mockTransportChecked = false) {
  return { version: 'native-format-coverage/0.2', qualification: 'Dispatch and mocked transport only. Actual model generation, academic quality and learner outcomes are unmeasured.', reference: request.source_provenance, native_activities: request.sequence_blueprint.length, current_native_kinds: new Set(request.sequence_blueprint.map(row => row.native_kind)).size, rows: Object.values(FORMAT_DISPATCH).map(row => {
    const slots = request.sequence_blueprint.filter(slot => slot.native_kind === row.native_kind);
    const nonresponse = row.family === 'nonresponse';
    return { ...row, current_occurrences: slots.length, collected_occurrences: counts[row.native_kind] ?? null, families: [...new Set(slots.map(slot => slot.family))], public_formats: [...new Set(slots.map(slot => slot.public_format))], roles: [...new Set(slots.map(slot => slot.role))], source_pointers: slots.map(slot => slot.source_pointer), status: slots.length ? mockTransportChecked ? 'context-prepared-and-mock-transport-checked' : 'context-prepared-writing-and-smoke-pending' : nonresponse ? 'instruction-only-route-no-current-example' : 'explicit-dispatch-awaiting-context-and-format-smoke', actual_model_generation: 'not run', quality: 'unmeasured', required_context: nonresponse ? 'Supplied instruction, source and exposure timing; no correctness scoring.' : 'Explicit native operation, sources/media, knowledge, phase, content and pair maps, learner constraints and support; family payload and native subcheck context.' };
  }) };
}
