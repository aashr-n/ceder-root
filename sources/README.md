# sources

The catalogue of free learning sources Ceder knows about. One JSON file per source in `entries/<id>.json`, checked by `source.schema.json` and `validate.mjs`. This folder is CC0 1.0 (see `LICENSE`).

The catalogue is curated, not exhaustive. See the repository's `README.md` for the rules.

## Fields

| Field | Required | Meaning |
|---|---|---|
| `id` | yes | Lowercase words joined by hyphens. Must match the file name. |
| `name` | yes | The source's name. |
| `url` | no | Where the source lives. Left out only for a source with no public address, such as `own-course-files`. |
| `goodFor` | yes | One sentence: what it is good for. |
| `license` | yes | An SPDX id such as `CC-BY-4.0`, or `"per-item"` when each item states its own, or `"unknown"`. |
| `licenseUrl` | no | The page that states the licence. |
| `use` | yes | `copy`, `copy-share-alike`, `link-only` or `private`. See below. |
| `attribution` | no | The credit line to show, when known. |
| `access` | no | How a device would fetch it, such as an API endpoint, when known. |
| `checked` | yes | `{ "date": "YYYY-MM-DD", "basis": "..." }`, or `null` when the licence hasn't been verified. `basis` says what was read. |
| `notes` | yes | Anything a reader needs: conflicts, trademarks, limits. Say "unverified" here when `checked` is `null`. |

## The four uses

- `copy`: the content may be copied in and shown inside Ceder, with attribution.
- `copy-share-alike`: may be copied, but only into `share-alike/`, never `bank/`.
- `link-only`: Ceder may link to it or open it; nothing is copied. Every NonCommercial source is this, because Ceder has paid tiers.
- `private`: a student's own course files, used on their device for them alone and never in this repository.

## Adding an entry

1. Find the licence on the source's own terms page. Don't rely on memory.
2. Copy an existing file in `entries/`, name it `<id>.json`, and fill in the fields.
3. Set `checked` only if you read the terms. Write the date and what you read in `basis`. Otherwise use `null` and say it is unverified in `notes`.
4. If the licence is NonCommercial, or you can't tell, use `link-only`.
5. Run `node sources/validate.mjs` from the repository's root, after `npm ci` there.

The validator also fails when `use` doesn't fit the licence: `copy-share-alike` needs a share-alike licence, a NonCommercial licence needs `link-only`, and `copy` needs `CC0`, `CC-BY`, `PDDL` or `MIT` (or `per-item`). Not legal advice.
