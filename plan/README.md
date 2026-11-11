# Plans

A plan is the list of packs a subject should have, in teaching order, with the concepts each one teaches. There is one file a subject, `plan/<subject>.json`. Agents write packs from it one at a time, so the plan is where coverage is decided, and it is short enough for a person to read and correct before anything is written.

```json
{
  "formatVersion": 1,
  "subject": "calculus",
  "covers": "Single-variable calculus, as a first two-course sequence teaches it.",
  "packs": [
    {
      "pack": "limits",
      "title": "Limits",
      "brief": "What a limit is and how to find one, up to continuity. Stops before derivatives.",
      "concepts": [{ "id": "limit", "name": "Limit" }],
      "buildsOn": ["precalculus/function"]
    }
  ]
}
```

- `packs` are in the order a student meets them. A pack's folder is `subjects/<subject>/<pack>/`.
- `concepts`: 4 to 12 a pack. An `id` is unique in the subject, and becomes the concept's ID in the pack.
- `buildsOn`: the concepts a pack needs from earlier packs in this plan, by ID, or from other subjects, as `<subject>/<id>`.
- A pack that is already written is listed with exactly the concepts it has. Whether a pack is written isn't stored: it is whether its folder exists.

```
node tools/plan.mjs check plan/calculus.json   checks a plan against schema/plan.schema.json and the bank
node tools/plan.mjs next calculus 2            the next packs to write
node tools/plan.mjs written calculus           the packs the bank has, with their concepts
node tools/plan.mjs overview                   writes OVERVIEW.md, every plan as one page a person can read
```

`OVERVIEW.md` is the place to read the plans: each subject's packs in order, with the concepts each teaches. Correct a plan by editing its JSON file, then run `overview` again.

`pipeline/prompts/planner.md` is the planner's instructions.

## Sources

`sources.jsonl` lists every page an agent read through `tools/ref.mjs` while it planned, wrote or checked: the site, the page, its revision, and who read it. Agents may read nothing else (`pipeline/prompts/sources.md`).
