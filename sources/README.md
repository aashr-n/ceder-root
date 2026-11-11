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

| Entry | Licence | `apps` |
|---|---|---|
| `wikipedia`, `wikibooks`, `wiktionary` | CC BY-SA 4.0 text | `show` |
| `wikiversity` | CC BY-SA 4.0 text; pictures per file | `show` |
| `wikidata` | CC0 | `show` |
| `wikimedia-commons` | Per file | `link` |
| `servier-medical-art` | CC BY 4.0 | `show` |
| `reactome` | CC BY 4.0 illustrations and icons; CC0 data | `show` |
| `lsdb-archive` | CC BY 4.0 (BodyParts3D, Togo Picture Gallery) | `show` |
| `gene-ontology` | CC BY 4.0 data | `show` |
| `chebi` | CC BY 4.0 | `show` |
| `hefferon-linear-algebra` | CC BY-SA 3.0 US (or GFDL) | `show` |
| `lebl-diffyqs` | CC BY-SA 4.0 (or CC BY-NC-SA 4.0) | `show` |
| `opendsa` | MIT | `show` |
| `rcsb-pdb` | Per part: CC0 archive data and Structure Summary images, CC BY 4.0 Molecule of the Month illustrations (both `show`), other text unknown | `link` |
| `levin-discrete-math` | Per edition: 3rd CC BY-SA 4.0 (`show`), 4th CC BY-NC-SA 4.0 | `link` |
| `myphysicslab` | Per part: Apache 2.0 code (`show`), site text unknown | `link` |
| `openintro-statistics` | CC BY-SA 3.0, but terms the owner has to weigh | `link` |
| `nih-bioart`, `nih-3d`, `uci-openchem`, `us-government`, `libretexts` | Per item | `link` |
| `light-and-matter` | Per item, licence pages not read | `link` |
| `khan-academy` | CC BY-NC-SA, version unsettled | `link` |
| `mit-opencourseware`, `webwork-opl` | NonCommercial | `link` |
| `uniprot` | Not checked | `link` |
| `own-course-files` | A student's own | `private` |

`show` on an entry with parts applies to the parts marked so. Every entry's `bank` is `none` except Wikipedia and Wikibooks (`read`) and Wikidata (`copy`). `node tools/library.mjs pin` fetches from Wikipedia and Wikimedia Commons only, so a piece from another `show` source is written by hand, and `validate` checks it against the entry.

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

OpenStax and PhET were checked against their own pages on 2026-11-11 and left out, because their terms don't allow use in an app with paid plans. PhET's terms also forbid linking from commercial activity without an agreement.

None of this is legal advice.
