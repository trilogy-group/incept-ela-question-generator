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

The optional native lane now prepares the **current hosted authoring reference**: 50 activities across 14 native
kinds and 19 pages, frozen at current main source commit `1839d852e7994aca776f12da916fce73d91a2cf7` and source SHA256
`56ed020fa23ad6d4f2e4acba753e1bf208288183d48d106c8941d80492459055`. This is a separate source from the older
40-unit, `3ed708e1` historical contract fixture described above. The current source updates the `reading-2`
introduction video and poster and adds nine timed captions. Exact caption wording, times, order, original pointers
and transcript offsets survive intake; their text is available only from the declared introduction phase onward.
The supplied capture comparison reports a full video manifest hash match, while the poster has an observed hash
and matching URL prefix with no declared full manifest hash. These are capture integrity observations; no video
watch, audiovisual equivalence or individual learner exposure is claimed. Earlier `f1565047` / `50b6d44f` and
`4c1e26c8` / `d388ae85` journals remain intact with their original source contexts.

The raw capture's pending admission fields remain verbatim under `capture_provenance_as_at_capture` and
`capture_receipt_state`. Selecting this source for the current context does not rewrite that historical capture
state or introduce an admission decision as an evaluation input. Source and media integrity establish no quality
label.

Run the same Node CLI offline, with no credentials or sibling repository:

```bash
node model_generate.mjs --prepare-native --request examples/current-native-request.json --context examples/current-native-context.json
node model_generate.mjs --offline-smoke --request examples/current-native-request.json --context examples/current-native-context.json
node model_generate.mjs --offline-kind-matrix --request examples/current-native-request.json --context examples/current-native-context.json
```

Preparation emits a reproducible neutral request/context, response schema, source pins, hashes, coverage matrix and
receipt under a fresh `.local/native-runs/` directory. Smoke adds one mocked provider return through the writer,
finished native transport and a learner projection. It makes **zero live model calls**. Mock text is labelled as a
synthetic transport fixture; it is not a generated teaching sequence or quality evidence. First attempts, repairs,
typed holds and source bindings remain in the journal. Missing required source/media, knowledge, phase, maps,
support, learner constraints or counterpart context produces a hold before credential or provider access.

| Current native kind | Activities | Public format / explicit adapter extension |
| --- | ---: | --- |
| `film_mcq` | 4 | `single_choice`, supplied timed media captions |
| `word_web` | 1 | word web: staged elicitation, semantic relation and meaning |
| `key_term_mcq` | 1 | `single_choice` |
| `reading_mcq` | 11 | `single_choice` |
| `open_check` | 15 | `short_explanation` or `integrated_response`, explicit scope |
| `evidence_select` | 1 | `evidence_selection`, exact source quotations |
| `open_prompt` | 2 | `short_explanation` or `rebuttal` |
| `argument_round` | 3 | `learner_question`, `short_explanation`, `rebuttal`; distinct parts and dependencies |
| `rebuild_choice` | 3 | inline choices inside the supplied worked sentence |
| `quote_word_selection` | 2 | word and class selection inside a retained quote branch |
| `quote_analysis` | 4 | separate paraphrase and interpretation subchecks |
| `say_back` | 1 | unscored recall of the supplied taught statement |
| `classify` | 1 | `classification`, preserving both entity and relation |
| `confidence_self_report` | 1 | unscored self-report with the supplied scale |

All 14 current kinds have neutral context and mocked transport checks. The separate `--offline-kind-matrix` run
exercises every one of the 62 collected names through context intake and one mocked provider return per kind. Its
14 source cases retain the current authoring context and any required earlier dependencies. Its other 48 cases are
explicitly authored fictional family fixtures, kept outside the captured golden reference. Their status says
`synthetic-family-transport-checked`; `model_paragraph` and `worked_example` instead have instruction-only transport.
Every row also records a checked typed hold naming its missing source, media, operation, scale, relation or support
prerequisite, with zero provider access for that missing-context case. The matrix and per-kind finished packets,
receipts and holds live under a fresh `.local/native-kind-matrices/` directory. No row is left unexplained as
awaiting smoke.

These fixtures verify the declared adapter contracts and their refusal paths. They do not establish the original
native semantics or renderer compatibility of absent source examples, real spoken/media delivery, generated
teaching quality, or independent quality labels. In particular, a collected alias such as `rank_board` or
`reflective_choice` requires an explicit course-owned operation; its name cannot silently decide whether the task
is classification, ordering, source-supported choice or self-report. Actual source-native operations and context
remain prerequisites for using those aliases on a real lesson.

The broader family checks retain one shared single-use bank for `cloze`, explicit matching alternatives and source
bindings, visible multiple-select rules, ordering and tie policies, declared entity/relation dimensions, and
instruction-only roles. Spoken responses use an explicit spoken adapter extension. EBSR requires exactly one claim
part and one later evidence part under the same parent, with the evidence depending on that claim. The current
source's guided and dependent activities remain distinct from the synthetic breadth fixtures and from independent
measurements of learner mastery.

`question-lane-native/0.2` and `question-set native 0.2` are explicit **adapter extensions**. Native kind, source
pointer, parent context, role, branch alternatives and dependency survive adaptation. They do not change the pinned
historical shared contract or promise direct compatibility with a production renderer. The 50 rows include guided
tasks, recall, dependent paragraph subchecks and retained alternatives; they are not 50 independent measurements.
The learner packet withholds keys, word-class answers, nested blank keys, rubrics and feedback while preserving
declared teaching exposures and branch policy.

The neutral packet omits original questions, choices, keys, feedback and rubrics. It retains source captions,
reading passages and explicit worked teaching. Its generation objectives are proposed packet authoring. The source
does not contain a frozen dialogue excuse, so `examples/native-counterpart.json` explicitly supplies a hypothetical
counterpart, with separate provenance and no required verdict. Individual exposure, conditional feedback history,
reading level and accommodations remain unknown. Source timing inconsistencies and the missing quote-C breakdown
remain declared. Caption presence does not verify audiovisual playback or a learner's exposure.

To reproduce the projection from the two explicitly supplied original authoring files:

```bash
python3 scripts/prepare_native_reference.py --source SOURCE.json --receipt RECEIPT.json --comparison COMPARISON.json --counterpart examples/native-counterpart.json --output-dir examples
```

The script checks the original source pin before and after projection. For later authorized writing, the existing
`--request` / `--context` model command accepts this native protocol and applies its output contracts. No live native
generation or evaluation has been run in this task. Quality assessment and learner outcomes remain pending.

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
