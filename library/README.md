# The library

Pinned pieces of outside sources: a Wikipedia article's lead, a picture from Wikimedia Commons, a link to a page. Each piece supports one or more concepts in the bank, and an app shows it next to that concept with its credit.

**The library isn't CC0.** Its licence terms are in the repository's `README.md`, under Licence. Nothing here goes into the bank, and pack authors never copy wording from it (`pipeline/prompts/sources.md`).

```
library/
  item.schema.json             what an item may hold
  items/<source>/<slug>.json   one pinned piece; <source> is an entry in sources/entries/
  files/<source>/<slug>.png    a stored picture, named by the item that holds its licence
```

## An item

| Field | |
|---|---|
| `id` | `<source>/<slug>`, the item's folder and file name. |
| `source` | The source's ID in the catalogue, `sources/entries/`. |
| `part` | For a source the catalogue checks part by part (Wikipedia's `text` and `media`), the part the piece is from. |
| `kind` | `text`, `image` or `link`. |
| `title` | The page's or file's title. |
| `url` | The page, on the source's own site. |
| `revision`, `permalink` | For a piece from a wiki: the revision it was taken from, and the address of exactly that revision. |
| `retrieved` | The date it was fetched. |
| `license`, `licenseUrl` | The piece's licence, as an SPDX ID (`LicenseRef-public-domain` for a public-domain work), and where it is stated. Taken from the page's own metadata, never guessed. |
| `credit` | `{ "authors", "line" }`: who made it ("Wikipedia contributors" for an article), and the credit line to show. |
| `changes` | What was changed from the original, such as "Plain text of the lead section, shortened to its first paragraph". CC BY and CC BY-SA ask for this. |
| `text` | A text piece: plain text, at most 1,000 characters, paragraphs separated by a blank line. |
| `file`, `sha256`, `width`, `height`, `alt` | A picture: its file under `library/`, that file's SHA-256, its size in pixels (at most 800 wide), and what it shows, in words, for VoiceOver. |
| `evidence` | For a piece under its own file's licence: `{ url, metadata }`, the file page and the licence and author fields its metadata gave, word for word. |
| `concepts` | The concepts it supports, by ref (`biology/nucleus`). |

A `link` has only `id`, `source`, `part`, `kind`, `title`, `url`, `retrieved` and `concepts`.

## What's allowed

Nothing is allowed by default. `node tools/library.mjs validate` refuses an item unless:

- its source is in the catalogue, and the catalogue lets apps use it (not `none`, and not a student's own files);
- its `url` is on the source's own site;
- if it stores text or a picture:
  - it names a `part` when its source is checked part by part, and those terms (the part's, or else the source's) have a `checked` that isn't null;
  - its licence is CC0, public domain, CC BY or CC BY-SA, never NonCommercial, NoDerivatives, unknown or per-item;
  - under a single licence, the terms say apps may `show` it and the item's licence is that one;
  - under each file's own licence (a `per-item` source or part, and any picture on a wiki), it keeps the `evidence` its file page gave, and the tool reads the same licence, licence address and author from that evidence; a file page that notes restrictions, such as a trademark or a person who can be recognised, is refused. Only Wikimedia Commons can be read this way today, so a picture from anywhere else, Wikipedia's article pictures included, can only be a link;
  - its credit line names the licence and says what was changed (unless nothing was), which CC BY and CC BY-SA ask for; a credit is needed unless it's CC0 or public domain;
  - from a wiki, it has a revision and a permalink to that revision;
- its text is plain and within the limit, and its picture's file matches its `sha256`, size and type;
- every concept it names is in the bank.

Any source the apps may use may have a `link`. A file in `files/` that no item names is an error.

## Adding a piece

From the repository's root, with Node 22:

```
node tools/library.mjs pin wikipedia "Cell nucleus" --concept biology/nucleus
node tools/library.mjs pin commons "File:<name>" --alt "<what it shows>" --concept biology/organelle
node tools/library.mjs validate
```

`pin` fetches the piece, reads its licence and authors from the page's own metadata, and writes the item only if `validate` would take it. A Wikipedia lead is kept to whole paragraphs, or whole sentences, within 1,000 characters. A Commons picture is stored as a PNG or JPEG at most 800 pixels wide, rendered from SVG or scaled down where needed. `--slug` names the item, `--replace` pins it again at the current revision. A `link` is written by hand.

## What an app reads

`node tools/library.mjs build --out <dir>` (`dist/library/` when not given) validates, then writes:

| File | |
|---|---|
| `library-index.json` | `concepts`: for each concept ref, the IDs of the items that support it. `items`: every item, with its text, licence, credit and changes inline, a picture as `image: { file, width, height, alt }`, and on a link the `linking` conditions its source's catalogue entry sets (`external`: open the source's own site outside the app; `freeOnly`: never behind a paid feature). `revision` changes when anything does. |
| `libraryasset-<hash>.<ext>` | A picture, named by the first 16 hex digits of its SHA-256. |

The same source gives the same bytes. It's separate from the bank's build, `tools/build.mjs`, whose output the library never changes.

An app shows a piece with its `credit.line`, which names the licence and what was changed, with the title linked to its `url` (or `permalink`) and the licence name linked to `licenseUrl`. Follow the source's `attribution` in the catalogue. Text and pictures under CC BY-SA stay under CC BY-SA, changes included.
