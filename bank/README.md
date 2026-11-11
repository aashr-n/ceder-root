# Ceder's bank

The bank is the set of concepts, questions, diagrams, 3D models and step-by-step sequences that Ceder's Learn tab draws on. It is plain files: one `subject.json` per subject and one `pack.json` per topic, with each pack's pictures and models beside it. Agents write the packs, other agents answer every question without seeing its key, and only the questions they all agreed with are built into what the apps read. Nothing in the bank is about any student.

`FORMAT.md` is the format. Read it before writing or changing anything here.

```
subjects/   the packs, by subject
schema/     JSON Schemas for subject.json and pack.json
tools/      validate, build, blind export and grading, with their tests
pipeline/   how a pack gets written and checked, and the prompts the agents follow
dist/       what the build writes (not committed)
.work/      blind question files and solvers' answers (not committed)
```

## Checking and building

From this folder, with Node 22:

```
npm ci
node tools/validate.mjs                  checks the whole bank against FORMAT.md
node tools/validate.mjs subjects/biology checks one subject or one pack's folder
npm test                                 tests the tools against tools/fixtures/
node tools/build.mjs                     writes dist/
```

`validate.mjs` fails on anything that breaks the format: a schema error, an ID that doesn't resolve, a prerequisite cycle, overlapping hotspots, an SVG with scripts or outside links, a missing or oversized asset. A concept with fewer than four verified items is a warning, and an error with `--require-verified`.

`build.mjs` validates first and builds nothing if there are errors. It writes one flat folder: `bank-index.json`, a `bankpack-<pack id>.json` for each pack with at least one verified item, and a `bankasset-<hash>.<ext>` for each picture and model those packs use. Only verified items go in, without their verification. Diagrams are rendered from SVG to PNG at 1200 pixels wide. The same source always gives the same bytes. It prints each pack it built, and each pack or subject it left out and why.

Ceder's iPhone app ships a copy of the built bank as its starting bank. That copy lives in the app's own repository, not here. Two options of `build.mjs` work with it:

```
node tools/build.mjs --app --app-dir <dir>         rebuilds dist/ and replaces the bank files in <dir>
node tools/build.mjs --check-app --app-dir <dir>   changes nothing; fails if <dir> isn't what --app would write
```

Without `--app-dir`, both look for `../Ceder/Ceder/Learn/SeedBank` beside this folder, which is the path in the app's repository. This repository's CI doesn't run `--check-app`; the app's repository does. A diagram with text on it renders with the machine's fonts, so its PNG can differ between a Mac and CI; diagrams that students tap carry no text, and labelled ones should keep text to a minimum.

## How a pack gets written and verified

Every answer key is checked by solvers who never see it. The loop, with the exact commands, is in `pipeline/README.md`:

1. An author writes the pack (`pipeline/prompts/author.md`). Every item starts as a draft.
2. `tools/blind.mjs` writes its draft questions without their answers.
3. Two or more solvers answer them separately (`pipeline/prompts/solver.md`).
4. `tools/grade.mjs` compares the answers with the keys. An item every solver agreed with becomes verified; any other stays a draft with a note saying what each solver answered (`pipeline/prompts/grader.md`).
5. A repairer fixes or rejects each item that wasn't verified (`pipeline/prompts/repair.md`), and changed items go back to step 2.
6. The build takes the verified items.

`pipeline/synthesize.workflow.js` runs the whole loop for a list of packs with a coding agent's Workflow tool.

## Licence

Each folder carries its own licence. The packs under `subjects/` are CC BY 4.0, and each pack names it in `license`. The code in `tools/`, `pipeline/` and `schema/` is MIT. The fonts in `tools/fonts/` keep their own licence, in `tools/fonts/LICENSE.txt`. See the `LICENSE` files in this folder and in the repository's root.
