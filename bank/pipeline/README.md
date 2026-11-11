# Writing and verifying a pack

A question reaches students only after solvers who never saw its key agreed with it. This is the loop, in order, with the commands each step runs from `bank/`. The prompts in `prompts/` are the instructions each agent follows; `synthesize.workflow.js` runs the whole loop for a list of packs with a coding agent's Workflow tool.

The examples use the pack `subjects/biology/dna-replication`, round 0, and two solvers, `a` and `b`.

## 1. Author

An agent writes the pack, following `prompts/author.md`. Every item starts as `"verification": { "status": "draft" }`. Diagrams are drawn as SVG and looked at as PNG:

```
node tools/render.mjs subjects/biology/dna-replication/assets/replication-fork.svg /tmp/replication-fork.png
node tools/validate.mjs subjects/biology/dna-replication --allow-missing-assets
```

The author fixes every error. Warnings about verified counts are expected until the pack is checked.

## 2. Blind export

Each solver gets its own copy of the questions without their answers:

```
node tools/blind.mjs subjects/biology/dna-replication --out .work/blind/biology.dna-replication-r0-a.json
node tools/blind.mjs subjects/biology/dna-replication --out .work/blind/biology.dna-replication-r0-b.json
```

Only draft items are exported; `--all` adds verified items, to check them again. Each item goes by a blind ID (`q-` and 12 hex digits) instead of its real one, and keeps only its prompt and what's needed to answer: a choice item's choices, an order item's steps shuffled, a label item's picture rendered beside the file with its hotspots as lettered spots in shuffled order. The shuffles come from a hash of each item's ID, so the grader redoes them and no key file is kept.

## 3. Solve, with two or more solvers

Each solver follows `prompts/solver.md`: it answers every item in its file, reading nothing under `subjects/` except the pictures its file names, and writes

```
.work/answers/biology.dna-replication-r0-a.json
.work/answers/biology.dna-replication-r0-b.json
```

as `{ "solver": "a", "answers": { "<blind id>": { "answer": …, "note": "…" } } }`. Solvers work separately and never see each other's answers.

## 4. Grade

The grader follows `prompts/grader.md`:

```
node tools/grade.mjs --answers .work/answers/biology.dna-replication-r0-a.json .work/answers/biology.dna-replication-r0-b.json --date 2026-11-09
```

A choice, order or label item that every solver agreed with becomes `verified`, with `solvers`, `agreed`, `method` and `at`. Any other stays `draft` with a `note` saying what the key is and what each solver answered, in the pack's own terms. An item answered by fewer than two solvers is left as it is (`--min-solvers` changes that). Rejected items are never touched. Only `verification` changes; the pack.json is rewritten with two-space indentation.

Recall items need a judgement, so the first run writes them to `.work/answers/biology.dna-replication-r0-a.recall-review.json` with each key and every solver's answer. The grader fills in `true` or `false` for each solver and a one-line note under `verdicts`, then runs the same command again with the file:

```
node tools/grade.mjs --answers .work/answers/biology.dna-replication-r0-a.json .work/answers/biology.dna-replication-r0-b.json --date 2026-11-09 --recall-verdicts .work/answers/biology.dna-replication-r0-a.recall-review.json
node tools/validate.mjs subjects/biology/dna-replication
```

The tool prints a table of counts for each pack.

## 5. Fix or reject

A repairer follows `prompts/repair.md` for each item still draft: it fixes the key, rewords an ambiguous question, or sets the item to `rejected` with a note. A changed item stays `draft` and goes back to step 2 in the next round (`-r1-a`, `-r1-b`, and so on). The workflow runs two repair rounds by default; whatever is still draft after that is left out of the build.

## 6. Build

```
node tools/validate.mjs
node tools/build.mjs
node tools/build.mjs --app
```

The build takes only verified items. `--app --app-dir <dir>` replaces the iPhone app's seed bank in `<dir>`, which the app's repository checks with `node tools/build.mjs --check-app --app-dir <dir>`.
