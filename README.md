# Ceder's bank

The bank is the set of concepts, questions, diagrams, 3D models and step-by-step sequences that Ceder's Learn tab draws on, open for anyone to use. It is plain files: one `subject.json` per subject and one `pack.json` per topic, with each pack's pictures and models beside it. Agents write the packs, other agents answer every question without seeing its key, and only the questions they all agreed with are built into what apps read. Nothing in the bank is about any student.

## How it's organised

```
subject        Biology                      subjects/biology/subject.json
└─ pack        DNA replication              subjects/biology/dna-replication/pack.json
   ├─ concepts   what a student learns, and what each one builds on
   ├─ items      the questions; each checks one concept and has a checked answer
   └─ artifacts  diagrams, 3D models and sequences, with their files in assets/
```

A pack covers one topic: 4 to 12 concepts, with at least 4 verified questions for each. `FORMAT.md` is the format. Read it before writing or changing anything here. `CONTRIBUTING.md` is the short way in to adding questions.

```
subjects/   the packs, by subject
plan/       each subject's list of packs to write, and every outside page an agent read
schema/     JSON Schemas for subject.json, pack.json and a plan
tools/      validate, build, blind export, grading, checking mistakes, plans and outside reading, with their tests
pipeline/   how a pack gets written and checked, and the prompts the agents follow
dist/       what the build writes (not committed)
.work/      blind question files and solvers' answers (not committed)
```

## Checking and building

From the repository's root, with Node 22:

```
npm ci
node tools/validate.mjs                  checks the whole bank against FORMAT.md
node tools/validate.mjs subjects/biology checks one subject or one pack's folder
npm test                                 tests the tools against tools/fixtures/
node tools/build.mjs                     writes dist/
```

`validate.mjs` fails on anything that breaks the format: a schema error, an ID that doesn't resolve, a prerequisite cycle, overlapping hotspots, an SVG with scripts or outside links, a missing or oversized asset. A concept with fewer than four verified items is a warning, and an error with `--require-verified`. A pack whose right choice is the longest, or the shortest, in more than 35% of its choice items gets a warning too, and `tools/cues.mjs` lists those items. An explanation that names a choice by its place is an error, because apps shuffle the choices.

`build.mjs` validates first and builds nothing if there are errors. It writes one flat folder: `bank-index.json`, a `bankpack-<pack id>.json` for each pack with at least one verified item, and a `bankasset-<hash>.<ext>` for each picture and model those packs use. Only verified items go in, without their verification. Diagrams are rendered from SVG to PNG at 1200 pixels wide, with their text set in the fonts in `tools/fonts/`. The same source always gives the same bytes. It prints each pack it built, and each pack or subject it left out and why.

CI runs these on every pull request and on `main`.

An app that ships a copy of the built bank can keep it in step with the source:

```
node tools/build.mjs --app --app-dir <folder>         rebuilds dist/ and replaces the bank files in <folder>
node tools/build.mjs --check-app --app-dir <folder>   changes nothing; fails if <folder> isn't what --app would write
```

## How a pack gets written and verified

Every answer key is checked by solvers who never see it. The loop, with the exact commands, is in `pipeline/README.md`:

1. An author writes the pack (`pipeline/prompts/author.md`). Every item starts as a draft.
2. `tools/blind.mjs` writes its draft questions without their answers.
3. Two or more solvers answer them separately (`pipeline/prompts/solver.md`).
4. `tools/grade.mjs` compares the answers with the keys. An item every solver agreed with becomes verified; any other stays a draft with a note saying what each solver answered (`pipeline/prompts/grader.md`).
5. A repairer fixes or rejects each item that wasn't verified (`pipeline/prompts/repair.md`), and changed items go back to step 2.
6. The build takes the verified items.

`pipeline/synthesize.workflow.js` runs the whole loop for a list of packs with Claude Code's Workflow tool.

A pack can also say which wrong idea each wrong choice gives away, so an app can tell a student what they have misunderstood and not only that they were wrong. A second model checks those tags without seeing them (`FORMAT.md`, Misconceptions).

What gets written is decided by each subject's plan (`plan/README.md`). While they plan, write or check, agents may read only Wikipedia, Wikibooks and Wikidata, through `tools/ref.mjs`, which logs every page and checks packs for copied text (`pipeline/prompts/sources.md`).

Agreement between solvers shows a key is consistent, not that it is true. The first eight packs were written and solved by one model family, so a mistake that family shares would not have been caught.

## Licence

Everything in the bank is released under CC0 1.0 (`LICENSE`): the questions, answers, explanations, pictures, 3D models, tools and prompts. Use it for anything, including training models, without asking and without giving credit. Each pack says so in its `license` field.

The one exception is `tools/fonts/`, which holds DejaVu Sans under its own licence (`tools/fonts/LICENSE.txt`).
