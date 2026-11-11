# Ceder bank format

Version 1. The bank is a set of plain files: concepts, questions with checked answers, and the diagrams, 3D models and animations that go with them. Agents write it, other agents check it, and Ceder's apps read a built copy of it. Nothing in it is about any student.

## Layout

```
ceder-root/
  subjects/<subject>/subject.json          one per subject
  subjects/<subject>/<pack>/pack.json      concepts, questions and artifacts on one topic
  subjects/<subject>/<pack>/assets/        the pack's own files: .svg, .usdz, .glb, .png
  schema/                                  JSON Schemas for subject.json and pack.json
  tools/                                   validate, build, blind-solve export and grading
  pipeline/                                how agents write and check new packs
  dist/                                    built output (not committed)
```

`<subject>` and `<pack>` are lowercase words joined by hyphens. A pack's ID is `<subject>.<pack>`, and its folder names must match it.

## subject.json

```json
{
  "formatVersion": 1,
  "id": "biology",
  "name": "Biology",
  "domain": "natural",
  "summary": "Cells, genes, and how living things work."
}
```

- `name` is what a concept's subject reads as on a student's knowledge map. It never changes once students have it.
- `domain` is one of `natural`, `formal`, `social`, `humanities`, `applied`, the map's five branches of knowledge.

## pack.json

```json
{
  "formatVersion": 1,
  "id": "biology.dna-replication",
  "subject": "biology",
  "title": "DNA replication",
  "summary": "How a cell copies its DNA before it divides.",
  "license": "CC0-1.0",
  "concepts": [],
  "items": [],
  "artifacts": []
}
```

A pack covers one topic: 4 to 12 concepts, at least 4 verified items per concept.

`license` is always `CC0-1.0`. Everything in the bank is released under CC0 1.0, so a pack can't carry another licence.

### Concepts

```json
{
  "id": "dna-replication",
  "name": "DNA replication",
  "aliases": ["DNA synthesis", "semiconservative replication"],
  "summary": "A cell copies its DNA by unwinding the double helix and building a new strand on each old one.",
  "requires": ["dna-structure"],
  "elements": [
    { "id": "okazaki-fragments", "name": "Okazaki fragments", "aliases": ["Okazaki fragment"] }
  ],
  "explain": {
    "text": "Before a cell divides it copies all of its DNA. …",
    "artifact": "replication-fork-steps"
  }
}
```

- `id` is unique in the subject, across all of its packs. Everywhere outside its own subject a concept is named by its ref, `<subject>/<id>`.
- `name` is how a textbook's index would list it: a noun phrase, sentence case, no trailing full stop. With the subject's name it decides the concept's ID on a student's map, so it never changes once published. Fix a wrong name by adding the right one to `aliases`.
- `aliases` are other names and common spellings, including plurals. Apps use them to find the concept in a course's text and to match it to concepts a tutor already mapped, so leave out names that also mean something else ("translation" alone, "cell" alone).
- `summary` is one sentence, at most 300 characters.
- `requires` lists what the concept builds on: an ID in the same subject, or a ref (`chemistry/covalent-bond`) in another. No cycles. Keep it to direct prerequisites, at most 6.
- `elements` are the 2 to 8 specific things to master inside the concept. An element's `id` is unique in its concept.
- `explain` is what a student who has never met the concept reads first: 50 to 110 words of plain text, no Markdown, written to be read on a phone in one look. `artifact` names an artifact in the pack to show with it.
- `misconceptions` is optional: the wrong ideas students bring to the concept. See Misconceptions, below.

### Items

Every item has:

| Field | |
|---|---|
| `id` | `<pack id>.<name>`, such as `biology.dna-replication.okazaki-direction`. Never reused, even after the item is deleted. |
| `concept` | The concept it checks, by ID. It must be in this pack. |
| `element` | Optional. The element of that concept it checks. |
| `kind` | `choice`, `recall`, `order`, or `label`. |
| `difficulty` | 1 recalls a fact, 2 applies it, 3 puts ideas together. |
| `prompt` | The question, at most 400 characters. Plain text. |
| `explanation` | Why the answer is right, at most 500 characters. Shown after the student answers. |
| `artifact` | Optional. An artifact in the pack that illustrates it. |
| `sources` | Optional. `[{ "title": "…", "url": "…" }]`: where a student can read more. Not text the item was copied from. |
| `verification` | See below. |

By kind:

- **`choice`**: `choices` (2 to 5 strings, each at most 200 characters, no "all of the above") and `answer` (the index of the right one). Exactly one choice is right, and every wrong one is wrong for a reason a student could state. Apps must show the choices in a shuffled order, so their order here means nothing, and a prompt or explanation never names a choice by its place ("the first choice"): it says what the choice says. Length survives a shuffle, so the right choice shouldn't stand out by being the longest or the shortest (`tools/cues.mjs`).
- **`recall`**: `answer`, at most 300 characters. The student recalls it, turns the card over, and says whether they had it. Write prompts with one defensible answer.
- **`order`**: `steps`, 3 to 6 strings in the right order, each at most 120 characters. Only one order is right.
- **`label`**: `artifact` (a diagram in the pack, required) and `target` (the ID of one of its hotspots). The prompt names the part to find without giving away where it is.

Write questions from the idea, never by rewording a textbook's question or copying its text.

### Misconceptions

A question can show more than whether a student is right. It can show which wrong idea they hold, which is what an app needs to know to correct it.

```json
"misconceptions": [
  { "id": "equilibrium-stops-movement", "claim": "At equilibrium, molecules stop moving.", "correction": "Molecules keep crossing in both directions at the same rate. Only the net movement is zero." }
]
```

```json
"choices": ["Water stops crossing the membrane", "Water crosses equally in both directions", "All the solute leaves the cell"],
"answer": 1,
"mistakes": ["equilibrium-stops-movement", null, null]
```

- A concept's `misconceptions` are at most 6 wrong ideas. `id` is unique in the pack. `claim` is the idea as a student would say it, at most 200 characters. `correction` is what is true instead, at most 300, written to be shown to a student who holds the idea.
- A choice item's `mistakes` has one entry for each choice, in the same order. It is `null` for the right choice. For a wrong choice it is the `id` of the misconception that leads a student to pick it, or `null` when the choice is only a slip or a guess. Apps that shuffle `choices` shuffle `mistakes` with them.
- A misconception is worth listing only if wrong choices in at least 2 items give it away. One wrong answer can be a slip. The same wrong idea twice is a pattern.
- The tags are checked the way keys are. A second model names the mistake behind every wrong choice without seeing the tags (`tools/diagnose.mjs`), and a tag stays only where the two agree. `verification.diagnosed` counts those checks, and the build leaves out the `mistakes` of an item no one has checked.

### Verification

```json
"verification": { "status": "verified", "method": "blind-solve", "solvers": 2, "agreed": 2, "at": "2026-11-09" }
```

- `status` is `draft`, `verified`, or `rejected`. Only `verified` items are built into what apps read.
- An item is `verified` only when solvers who never saw its answer agreed with it: `tools/blind.mjs` writes the questions without their answers, each solver answers those, and `tools/grade.mjs` compares. `solvers` is how many answered, `agreed` how many matched the key.
- A `recall` item is verified when the solver's own answer means the same as the key; the grader records that judgement in `note`.
- Changing an item's prompt, choices, steps, target or answer sets it back to `draft`, which also drops `diagnosed`.
- `diagnosed` is how many times a second model has checked the item's `mistakes` (see Misconceptions).
- `rejected` items stay in the file with a `note`, so the same mistake isn't written again.

### Artifacts

Every artifact has `id` (unique in the pack), `kind`, `title`, `alt` (what it shows, in words, for VoiceOver), and optionally `credit`.

**`diagram`**: a picture, and the named spots on it.

```json
{
  "id": "replication-fork",
  "kind": "diagram",
  "title": "The replication fork",
  "alt": "A DNA double helix opening into two strands, with helicase at the fork, …",
  "file": "assets/replication-fork.svg",
  "hotspots": [
    { "id": "helicase", "label": "Helicase", "x": 0.42, "y": 0.31, "r": 0.06 }
  ]
}
```

- `file` is an SVG in the pack's `assets/`, drawn on a 1200 by 900 canvas (`viewBox="0 0 1200 900"`). The build renders it to PNG. Use only shapes, paths, gradients and text; no scripts, images, links, filters or style sheets. Ask for `font-family="sans-serif"`: the build sets all text in the DejaVu Sans in `tools/fonts/`, so a picture comes out the same on every machine. Start with a full-size light plate, `<rect width="1200" height="900" rx="44" fill="#FBF8F1"/>`, so it reads the same on a cream page and a near-black one. The house palette and drawing rules are in `pipeline/prompts/author.md`.
- A diagram used by a `label` item must not print its hotspots' labels. Draw a second diagram with the labels for explanations if you want one.
- `hotspots`: `x` and `y` are the spot's centre as fractions of the picture's width and height, `r` its radius as a fraction of the width, at least 0.04 so a finger can hit it. Hotspots on one diagram must not overlap.

**`model3d`**: a 3D model the student can turn.

```json
{
  "id": "dna-double-helix",
  "kind": "model3d",
  "title": "The DNA double helix",
  "alt": "Two sugar-phosphate backbones wound around each other, joined by base pairs.",
  "files": { "usdz": "assets/dna-double-helix.usdz", "glb": "assets/dna-double-helix.glb" },
  "poster": "assets/dna-double-helix.png"
}
```

- `usdz` is for Apple devices and required; `glb` is the same model for the web. Both are made by a script in `tools/models/`, so a model can be rebuilt and changed. Keep each under 2 MB, in metres, about 0.3 across, centred on the origin, Y up.
- `poster` is a PNG of the model, shown until it loads.

**`sequence`**: steps the app plays over a diagram, moving to one hotspot at a time. The app animates it on the device; nothing is rendered ahead.

```json
{
  "id": "replication-fork-steps",
  "kind": "sequence",
  "title": "Copying DNA, step by step",
  "alt": "Five steps: the helix unwinds, primers are laid, …",
  "over": "replication-fork",
  "steps": [
    { "title": "Unwind", "text": "Helicase separates the two strands.", "focus": "helicase" }
  ]
}
```

- `over` is a diagram in the same pack. `focus` is one of its hotspots; leave it out for a step that shows the whole picture.
- 3 to 7 steps. `title` is at most 40 characters and `text` at most 160.

## The built bank

`node tools/build.mjs` writes `dist/`, a flat folder that can be served from any static host or copied into an app:

| File | |
|---|---|
| `bank-index.json` | The subjects, and each pack's file, hash, counts and assets. Its `revision` changes when anything does. |
| `bankpack-<pack id>.json` | One pack: its concepts, verified items and artifacts. |
| `bankasset-<hash>.<ext>` | One asset, named by the first 16 hex digits of its SHA-256, so a file never changes under its name. |

In a built pack, a diagram's `file` becomes `image: { file, width, height }` (a PNG 1200 pixels wide), a model's `files` become `usdz` and `glb` asset names with `poster` as an image, items lose `verification`, a choice item keeps `mistakes` only if they were checked, and items that aren't verified are left out. A concept left with no items stays, so prerequisites still resolve. The build is deterministic: the same source gives the same bytes.

An app that ships a copy of the built bank keeps it in step with `node tools/build.mjs --app --app-dir <folder>`, which also writes the built bank there, and `--check-app --app-dir <folder>`, which fails if that folder isn't what the build makes.
