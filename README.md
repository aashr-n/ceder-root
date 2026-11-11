# Ceder root

The public home of Ceder's question bank and a curated catalogue of free learning sources. Ceder is a study app for iPhone and the web.

```
bank/         the question bank: subjects and packs, schemas, tools and pipeline
sources/      the source catalogue: one JSON file per source, with a schema and a validator
share-alike/  material adapted from share-alike sources such as Wikipedia (empty for now)
```

Start with `bank/README.md` and `bank/FORMAT.md` for the bank, and `sources/README.md` for the catalogue.

## Licences

Each folder carries its own licence in a `LICENSE` file. The top-level `LICENSE` is an index.

| Folder | Licence | Why |
|---|---|---|
| `bank/subjects/` (concepts, questions, diagrams, models) | CC BY 4.0 | Ceder's own content. Permissive, credit required. Matches `"license": "CC-BY-4.0"` in the pack format. |
| `bank/tools/`, `bank/pipeline/`, `bank/schema/` (code) | MIT, `Copyright (c) 2026 Ceder` | Code. |
| `sources/` (links and facts) | CC0 1.0 | The catalogue is only links and facts. |
| `share-alike/` | CC BY-SA 4.0 | Wikipedia text is CC BY-SA. Adaptations must stay BY-SA, so they can never sit in the CC BY bank. |

The fonts in `bank/tools/fonts/` keep their own licence, in that folder.

## Rules

- **Curated, not exhaustive.** A source is added because it is good and its licence is known, not because it exists.
- **Four ways to use a source**, set per source in `sources/`:
  - `copy`: its content may be copied in and shown inside Ceder, with attribution.
  - `copy-share-alike`: may be copied, but only into `share-alike/`, never `bank/`.
  - `link-only`: Ceder may link to it or open it; nothing is copied. Every NonCommercial source is this, because Ceder has paid tiers.
  - `private`: a student's own course files. Used on their device for them alone, never in this repository.
- **A licence can't be looser than what is copied in.** A folder's licence must be one that every source copied into it allows. This is not legal advice.
- **No course materials, ever.**

## Adding a source

Add `sources/entries/<id>.json` as described in `sources/README.md`, and run `npm ci` and `node sources/validate.mjs` in the root. Only add a source whose licence you have read on its own terms page.

## Adding a pack

Write it under `bank/subjects/<subject>/<pack>/` as `bank/FORMAT.md` describes, and take it through the checking loop in `bank/pipeline/README.md`. Then, in `bank/`, run `node tools/validate.mjs` and `npm test`. Packs are CC BY 4.0, so don't copy in text, pictures or models from a source whose use isn't `copy` with a CC BY or more permissive licence. Adapt from a share-alike source only in `share-alike/`.

## Checks

CI runs, in `bank/`: `npm ci`, `node tools/validate.mjs`, `npm test`; then in the root: `npm ci`, `node sources/validate.mjs`.
