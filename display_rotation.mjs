import { StructuralError } from './model_contract.mjs';

export function rotateChoiceDisplays(supplied) {
  const response = structuredClone(supplied);
  const rotations = [];
  let rank = 0;
  for (const item of response.items) {
    if (!['reading_mcq', 'key_term_mcq'].includes(item.kind)) continue;
    const count = item.view.options.length;
    const oldKey = item.view.key[0];
    const target = rank % count;
    const shift = (target - oldKey + count) % count;
    const oldToNew = Array.from({ length: count }, (_, i) => (i + shift) % count);
    const rotate = rows => { const result = Array(count); rows.forEach((row, i) => result[oldToNew[i]] = row); return result; };
    const options = item.view.options;
    const feedback = item.view.option_feedback;
    item.view.options = rotate(options);
    item.view.option_feedback = rotate(feedback);
    item.view.key = item.view.key.map(key => oldToNew[key]);
    for (const binding of item.source_bindings) {
      const match = binding.field_ref.match(/^\/view\/(options|option_feedback)\/(\d+)(\/.*)?$/);
      if (!match) continue;
      const index = Number(match[2]);
      if (index >= count) throw new StructuralError('Choice binding index does not resolve before display rotation');
      binding.field_ref = `/view/${match[1]}/${oldToNew[index]}${match[3] ?? ''}`;
    }
    if (item.view.options[item.view.key[0]] !== options[oldKey]) throw new StructuralError('Display rotation changed the keyed option');
    rotations.push({ item_id: item.id, choice_rank: rank, target_key_position: target, right_shift: shift, old_to_new: oldToNew, content_changed: false });
    rank++;
  }
  return { response, rotations, policy: 'Target key position is zero-based reading-MCQ rank modulo option count. Circularly rotate options, option feedback, keys and indexed source-binding pointers together. This is a proposed display policy; no item-quality selection occurs.' };
}
