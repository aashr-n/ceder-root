# The source catalogue

A short list of outside sources worth knowing about, and what Ceder may do with each. It's curated: a source is here because it's good and someone read its licence on its own pages, not because it exists.

It answers two separate questions about a source.

**What may a Ceder app do with it?** (`apps`)

| Value | Meaning |
|---|---|
| `show` | The app may show it to a student, with the credit in `attribution`. Only on a licence that allows commercial use and that was checked. |
| `link` | The app may link to it and nothing more. Every NonCommercial source is this, because Ceder has paid plans, and so is every source whose licence is unknown, unchecked, or differs item by item. A source's notes may set conditions even on a link. |
| `none` | The app doesn't show it or link to it: the source's own terms restrict even linking for commercial activities. |
| `private` | A student's own files, used on their device for them alone. |

**What may go into the bank?** (`bank`) The bank is CC0, and almost nothing else is.

| Value | Meaning |
|---|---|
| `copy` | It's CC0, so it may be copied in. Today that's only names from Wikidata. |
| `read` | An agent may read it through `tools/ref.mjs` to learn what a topic covers, and then writes from its own understanding. Its wording is never copied. |
| `none` | Agents don't read it and nothing from it goes in. |

The catalogue records; it doesn't permit. What an agent may read while it works on the bank is set by `pipeline/prompts/sources.md` and by what `tools/ref.mjs` reaches, and an entry here can't widen that: the validator refuses a `bank` value other than `none` for a source `tools/ref.mjs` doesn't reach. `plan/sources.jsonl` is a different thing: the log of every page an agent did read.

## What's in it

Only sources Ceder may store and show in full, and a student's own files. A source that qualifies only in part, or that an app could only link to, isn't here: it's kept in `set-aside/`, with why (the owner, 2026-11-11).

| Entry | Licence | `apps` |
|---|---|---|
| `wikipedia`, `wikibooks`, `wiktionary`, `wikiversity` | CC BY-SA 4.0 text | `show` |
| `wikidata` | CC0 | `show` |
| `wikimedia-commons` | Per file | `link` |
| `reactome` | CC BY 4.0 illustrations and icons; CC0 data | `show` |
| `lsdb-archive` | CC BY 4.0 (BodyParts3D, Togo Picture Gallery) | `show` |
| `gene-ontology` | CC BY 4.0 data | `show` |
| `chebi` | CC BY 4.0 | `show` |
| `hefferon-linear-algebra` | CC BY-SA 3.0 US (or GFDL) | `show` |
| `lebl-diffyqs` | CC BY-SA 4.0 (or CC BY-NC-SA 4.0; the reader picks) | `show` |
| `opendsa` | MIT | `show` |
| `own-course-files` | A student's own | `private` |

Two kinds of entry need a word. The pictures on a Wikimedia wiki aren't covered by its text licence, so a wiki's entry may have a pictures part that isn't shown. And Wikimedia Commons stays although its licence is set file by file: a file is stored only when its own page states a free licence, and the library keeps that page's licence fields as evidence with the file.

Every entry's `bank` is `none` except Wikipedia and Wikibooks (`read`) and Wikidata (`copy`). `node tools/library.mjs pin` fetches from Wikipedia and Wikimedia Commons only, so a piece from another `show` source is written by hand, and `validate` checks it against the entry.

## An entry

One file per source, `entries/<id>.json`:

| Field | |
|---|---|
| `id` | Lowercase words joined by hyphens. The file's name. |
| `name` | What the source is called. |
| `url` | Its address, when it has one. |
| `goodFor` | One sentence on what it's useful for. |
| `license` | An SPDX ID such as `CC-BY-SA-4.0`; `per-item` when it differs from item to item; `unknown` when nobody has found it, or the source's own pages disagree on it. |
| `licenseUrl` | Where the licence is stated, when known. |
| `apps`, `bank` | As above. |
| `attribution` | The credit to show. Needed for `show`, unless the source is CC0. |
| `access` | How it's fetched: an address for an app, a command for an agent. |
| `checked` | `null` when the licence wasn't checked against the source's own pages, and then `notes` says exactly what's missing. Otherwise `{ "date", "evidence" }`: the day it was checked, and a list of `{ "url", "quote" }`, each a sentence copied word for word from a page the source itself publishes. A quote the page builds with a script carries `"fromScript": true`. |
| `subjects` | Optional: the bank's subject IDs (`subjects/<id>/`) the source is clearly good for, such as `["biology", "chemistry"]`. Leave it out for a general source. The validator refuses an ID the bank doesn't have. An app's copy lists it in `sources-index.json`, so an app can offer the source for a subject. |
| `linking` | Optional, for a source whose own terms put conditions on a link: `"external": true`, a link opens the source's own site outside the app, never framed or surrounded by other content; `"freeOnly": true`, a link is never behind a paid feature. The library's build copies these onto each link to the source, so an app can obey them without reading `notes`. |
| `parts` | For a source whose licence differs by part (Wikipedia's text and its pictures): one object per part, each with `id`, `name`, `url`, `license`, `apps`, `attribution`, `checked` and `notes` as above. A part's `apps` governs that part: an entry may be `show` while a part of it, such as Wikipedia's pictures, is only `link`. |
| `notes` | What the evidence supports, and every caveat: trademarks, terms on linking, framing or AI use, and anything the owner has to decide. |

## Adding or changing one

1. Read the source's licence and terms on its own pages. A search result, another site's summary, or an AI's paraphrase of a page isn't that. Fetch the page, and copy each quote from the fetched text.
2. Write the entry. When in doubt, `link` and `none`. Never widen `apps` or `bank` without a quote that supports it; narrow them when a quote contradicts them.
3. Run `node sources/validate.mjs` from the repository's root. It refuses `show` or `copy` on an unchecked licence, `show` on a NonCommercial, unknown or per-item one, and a check without evidence.
4. Run `node sources/recheck.mjs [id ...]`. It fetches every evidence page again and lists each quote that's no longer there word for word (after tags are removed and white space is evened out). It needs the network, so CI doesn't run it; run it by hand before relying on an entry, and when it reports a quote missing, read the page again and correct the entry. Behind an HTTPS proxy, prefix it with `NODE_USE_ENV_PROXY=1`.

The tests are in `sources/validate.test.mjs`: `node --test "sources/*.test.mjs"`.

## Left out

Checked against their own pages on 2026-11-11 and not used in any way:

- **OpenStax and PhET.** Their terms don't allow use in an app with paid plans. PhET's terms also forbid linking from commercial activity without an agreement.
- **OpenIntro Statistics and Servier Medical Art.** Their site terms limit how their content may be collected, or the kind of product that may carry it. Ceder keeps to the intent of those terms as well as their letter, so neither is used, linked to or kept in `set-aside/`. Don't add them back, and don't fetch their sites with a tool.

None of this is legal advice.
