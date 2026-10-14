# Incept ELA question generator

This starter builds a lesson's questions in order from its public context. Start with [AGENTS.md](AGENTS.md).
The first target is the authored Othello 1.1 reference in
[learning-truths/contract/examples/othello-1-1](https://github.com/trilogy-group/incept-ela-learning-truths/tree/main/contract/examples/othello-1-1),
starting with its reading checks. The reference has 40 extracted units, including guided tasks and paragraph
subchecks; they are not 40 independent tests of mastery.

The baseline fills **two authored templates, seven tasks each**: “Words, actions and credit” and “What a comparison
can establish.” The seven formats are classification, single choice, evidence selection, short explanation,
learner-written question, rebuttal and integrated response. It uses authored content notes and no model. It does not
yet read or generate the reference lesson. The checks establish valid output, not question quality.

## Run and check

```bash
python3 run.py
python3 check.py
python3 run.py --prepare-reference
```

Python's standard library is enough. The runner checks the public snapshots, runs tests, then prints JSON paths
under a fresh `.local/runs/` directory. It writes shared `lesson-context 0.1` and `question-set 0.1` files, learner and
teacher packets, first drafts and selection traces. It checks schemas and native pointers. Keys and feedback stay
out of the learner packet.

`--prepare-reference` is an offline preparation mode for five supported slots: one reading check after each of
the reference's four reading pages, followed by classification. It emits a versioned writer request, lesson context,
exact source anchors, provenance and a trace; it emits no questions and makes no model or evaluator call. Authored
questions, keys, rubrics, audio and final character-file summaries are excluded from the writer packet. Visible author
explanations remain, so this is guided practice preparation rather than independent mastery measurement. Actual
writing, quality review, individual challenge fit and learner readiness remain pending.

The twelve public export files are pinned to `knowledge-v1`. Every run trace preserves baseline SHA256
`365c0a5a2a3f460aa6fb8d8f87cf8ed9949b8863ef5df44200ec6477e8d1f8e9`; reference preparation also preserves the
original authored source commit `3ed708e126aec14b7456679b9236e01c1081df16`. These checks compare local pinned bytes;
they do not run a fresh comparison with the external lesson repository.

`config.json` selects the two examples and pinned public methods and formats. An authored packet placed inside this
repository can be run with `python3 run.py --input packet.json`. Missing sources, unsupported operations or reused
transfer passages return a hold without delivered questions. The CLI exits 2 for a hold and 1 for an execution failure.

The generator never reads the evaluator. Its inputs are public course context and learning-truths' current public
library and contract. Pinned copies in `public/` let this starter run alone. Format adaptation preserves native
tasks; it does not establish that an evaluator can judge them.

## Stages

- **Stage 0:** agree the format, reference and separation rules.
- **Stage 1, current:** run the template baseline and check its output.
- **Stage 2, next:** generate from the reference reading checks with a model, then measure question quality using
  an independently qualified evaluator. Each half needs a different owner.

Stage 2 has begun with offline source preparation only; model-backed writing and independent evaluation have not run.

No model or production route has been selected.
