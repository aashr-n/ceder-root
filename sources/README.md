# The source catalogue

A short list of outside sources worth knowing about, and what Ceder may do with each. It's curated: a source is here because it's good and someone looked at its licence, not because it exists.

It answers two separate questions about a source.

**What may a Ceder app do with it?** (`apps`)

| Value | Meaning |
|---|---|
| `show` | The app may show it to a student, with the credit in `attribution`. |
| `link` | The app may link to it and nothing more. Every NonCommercial source is this, because Ceder has paid plans, and so is every source whose licence is unknown or differs item by item. |
| `private` | A student's own files, used on their device for them alone. |

**What may go into the bank?** (`bank`) The bank is CC0, and almost nothing else is.

| Value | Meaning |
|---|---|
| `copy` | It's CC0, so it may be copied in. Today that's only names from Wikidata. |
| `read` | An agent may read it through `tools/ref.mjs` to learn what a topic covers, and then writes from its own understanding. Its wording is never copied. |
| `none` | Agents don't read it and nothing from it goes in. |

The catalogue records; it doesn't permit. What an agent may read while it works on the bank is set by `pipeline/prompts/sources.md` and by what `tools/ref.mjs` reaches, and an entry here can't widen that: the validator refuses a `bank` value other than `none` for a source `tools/ref.mjs` doesn't reach. `plan/sources.jsonl` is a different thing: the log of every page an agent did read.

## An entry

One file per source, `entries/<id>.json`:

| Field | |
|---|---|
| `id` | Lowercase words joined by hyphens. The file's name. |
| `name` | What the source is called. |
| `url` | Its address, when it has one. |
| `goodFor` | One sentence on what it's useful for. |
| `license` | An SPDX ID such as `CC-BY-SA-4.0`; `per-item` when it differs from item to item; `unknown` when nobody has found it. |
| `licenseUrl` | Where the licence is stated, when known. |
| `apps`, `bank` | As above. |
| `attribution` | The credit to show. Needed for `show`, unless the source is CC0. |
| `access` | How it's fetched: an address for an app, a command for an agent. |
| `checked` | `{ "date", "basis" }`: when the licence was checked and against what. `null` when it wasn't, and then `notes` says so. |
| `notes` | Anything else worth knowing, and every caveat. |

## Adding or changing one

1. Read the source's licence on its own terms page. A search result or another site's summary isn't that; if it's all you have, say so in `checked.basis`.
2. Write the entry. When in doubt, `link` and `none`.
3. Run `node sources/validate.mjs` from the repository's root.

None of this is legal advice.
