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
```

Python's standard library is enough. The runner checks the public snapshots, runs tests, then prints JSON paths
under a fresh `.local/runs/` directory. It writes shared `lesson-context 0.1` and `question-set 0.1` files, learner and
teacher packets, first drafts and selection traces. It checks schemas and native pointers. Keys and feedback stay
out of the learner packet.

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

No model or production route has been selected.
