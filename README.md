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

## Model writer

Node 22 or later runs the model writer without an SDK, package install, Python runtime, or sibling repository.
The two committed Othello input files contain the complete neutral source lesson, explicit exposure order and
14 proposed interaction slots. They retain the original authored source pin and omit authored questions and keys.

```bash
node model_generate.mjs --list-models --env-file credentials.env
node model_generate.mjs --request examples/othello-1-1-request.json --context examples/othello-1-1-context.json --env-file credentials.env
node --test tests/gateway.test.mjs tests/model.test.mjs tests/display.test.mjs
```

Provide `MAAT_API_TOKEN` or `TFY_INDIVIDUAL_TOKEN` through the environment or an explicit credential file outside
the repository. The filtered loader reads literal values only and never executes the file. The adapter retrieves
the token of an existing active personal account, or an existing team development account; it creates and changes
no account. Dashboard credentials are never used for completion calls. Keys, account names and IDs are never logged.

`model-config.json` fixes the writer route and decoding. The current direct Google Pro route was selected because
the advertised Claude aliases did not expose enough upstream metadata to establish a non-Bedrock route.
The runner verifies the current advertised provider against the recorded route evidence and excludes AWS/Bedrock.
Requested alias and reported model are separate provenance fields; gateway metadata does not prove a physical model
version. A gateway cost is reported only when returned by the service.

Each run makes one writer attempt and permits at most one repair for JSON shape, references or exact quotation
binding. It makes no quality judge, reranker or evaluator call. Raw provider bytes, writer inputs, refusals and repairs
remain in a fresh private `.local/model-runs/` journal. No network call is automatically retried and no fallback is
selected. A hold exits 2; execution failure exits 1. JSON schemas and deterministic checks establish transport
integrity only. Independent academic review and learner outcomes remain pending.

The transport parser also records two mechanical normalizations: removing a JSON code fence and wrapping the same
scalar choice index in the contract's one-element key array. Neither changes wording or answer positions. A preserved
run can be finalized offline with `node model_generate.mjs --finalize-run .local/model-runs/RUN_DIRECTORY`; the
normalization gets a separate directory and receipt, preserves the original held journal, and adds no model call.

Reading MCQ displays target answer position `rank % option_count`, using the question's zero-based reading-MCQ
rank. The generator circularly rotates options, keys, feedback and indexed source bindings together, preserving
the keyed option text. `display-rotation.json` records the permutation; this proposed display policy makes no
quality judgment. A source/course editorial revision can be made from a preserved finished run with
`node editorial_revision.mjs --source-run .local/model-runs/RUN/FINISHED_RUN`. Its explicit edits live in
`editorial-revision.json`; all before/after fields, source bindings and display rotations get a new private journal.
Original finished transports and model costs remain intact. The current editorial revision makes no model call.
The separately declared one-field Q12 marking clarification is finalized with
`node editorial_revision.mjs --finalize-marking .local/editorial-revisions/REVISED_RUN`. It preserves the prior
revision and verifies that learner content and all other question wording remain unchanged.

Finished `lesson-context.json` and `question-set.json` preserve the supplied instruction nodes and insert native
questions at the declared slots. Every item carries the original public alignment and exact source bindings.
`learner.json` withholds keys, rubrics, sample answers and feedback until the entire sequence is complete; the
declared worked teaching exposures remain in order. `receipt.json` contains public-safe model, attempt, usage and
transport hash metadata. The committed neutral inputs and explicit CLI flags are the only lesson prerequisites.

## Stages

- **Stage 0:** agree the format, reference and separation rules.
- **Stage 1:** run the template baseline and check its output.
- **Stage 2, current:** generate the complete reference lesson sequence with a model, then measure question quality using
  an independently qualified evaluator. Each half needs a different owner.

Stage 2 now has an executable writer and a complete neutral source packet. The writer's structural checks do not
establish academic quality or independent evaluator qualification. No production route is adopted.
