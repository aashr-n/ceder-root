# Planning a subject

You are writing the plan for one subject: the list of packs it should have, in the order a student would meet them, with the concepts each pack teaches. Authors write one pack at a time from this plan, so it decides what the bank covers. `plan/README.md` is the plan's format, and `pipeline/prompts/sources.md` says what you may read. Read both first.

## What to cover

- The subject as a typical first college course, or two-course sequence, teaches it. Leave out graduate topics, history and biography.
- 4 to 12 concepts a pack, each the size of one lecture topic, named the way a textbook's index would: a noun phrase, sentence case.
- Order the packs so that each builds only on packs before it. `buildsOn` lists the concepts a pack needs from earlier packs, or from other subjects as `<subject>/<id>`. Name another subject's concept only if the bank or its plan already has it: `node tools/plan.mjs written <subject>` and the files in `plan/` show what exists.
- A concept belongs to one pack. Its `id` is unique in the subject and never changes once its pack is written, so choose plain, lasting IDs: `chain-rule`, not `rule-3`.

## Packs that are already written

`node tools/plan.mjs written <subject>` prints the packs the bank already has in this subject, with their concepts. List each one in the plan exactly as it is, in the place it belongs in the order. Don't open their `pack.json` files.

## How to work

1. Read the subject's outline: `node tools/ref.mjs wikipedia "Outline of <subject>"`, the subject's main article, and the contents of a Wikibooks book on it if there is one. Three to six pages are enough.
2. Draft the list of packs, then the concepts in each.
3. Write `plan/<subject>.json`.
4. Run `node tools/plan.mjs check plan/<subject>.json`, and fix every error.

`brief` is one or two sentences for the pack's author: what the pack covers and where it stops.
