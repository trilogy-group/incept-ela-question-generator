# Assess this starter

Read [README.md](README.md), `config.json`, `examples/lessons.json`, `generator.py` and `contract_adapter.py`.
For the optional Node writer and native context lane, also read `model_generate.mjs`, `native_formats.mjs`
and `context_intake.mjs`; the offline commands are in README.md.
The pinned public inputs in `public/` come from learning-truths' library and `contract/`.

## Separation rules

- Never read the evaluator repository, its criteria, prompts, cases, findings or results.
- Use only public teaching knowledge, course context and the shared contract from current snapshots.
- Never copy private evaluation material here or use verdicts to tune this baseline.
- An assessment must not call models, open credential files or start research.
- Preserve first attempts, holds, repairs and selections; a passing transport check is not a quality verdict.

## Check

Run `python3 check.py` separately before committing; it must exit 0. Run the starter with `python3 run.py`.
Outputs under `.local/` are private and untracked.

## Useful feedback

Give the item ID and a reproducible source, key, wording, choice, rubric or delivery defect. Separate code findings
from academic judgments. Assess whether the reference reading checks are the right first target and what is missing
when moving beyond the templates. Stages and current limits are in README.md.
