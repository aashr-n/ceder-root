# Sources set aside

Sources that were read on their own pages and aren't in the catalogue, kept here for possible later use. The catalogue (`../entries/`) holds only sources Ceder may store and show in full. A source is here when only part of it qualifies, or when an app could do no more than link to it.

Nothing here is used. The library's validator reads `../entries/` only, so no piece can be pinned from a source in this folder. Each record keeps its evidence as it was found on 2026-11-11, in the catalogue's own format; terms change, so read the source's pages again before moving one back. `node sources/validate.mjs sources/set-aside` checks the records are well formed.

## Usable only in part

| Record | What qualifies | What doesn't |
|---|---|---|
| `rcsb-pdb` | The archive's data (CC0) and the Molecule of the Month illustrations (CC BY 4.0). | The rest of the site's text: its two policy pages disagree. |
| `levin-discrete-math` | The 3rd edition (CC BY-SA 4.0). | The current 4th edition, which added NonCommercial. |
| `myphysicslab` | The simulations' code (Apache 2.0). | The site's text and pictures, which carry only a copyright line. |

## Link only

| Record | Why |
|---|---|
| `khan-academy` | NonCommercial. Its help articles allow a link that opens khanacademy.org itself, never framed or behind a paid feature; the record's `linking` field says so. Its Terms of Service weren't read. |
| `mit-opencourseware` | CC BY-NC-SA 4.0. |
| `webwork-opl` | CC BY-NC-SA 3.0 by default. |
| `libretexts` | The licence is set page by page, and the site has no licence page of its own. |
| `us-government` | Works by US federal agencies are mostly in the public domain in the US, but each item has to be checked, and other people's material on those sites isn't covered. |
| `nih-bioart` | The licence is set entry by entry. The terms allow commercial use but say to check each one. |
| `nih-3d` | The licence is set model by model, by whoever uploaded it. |
| `uci-openchem` | The licence is set course by course, and one course states none. |
| `light-and-matter` | The book's copyright page and photo credits weren't read. |
| `uniprot` | Not checked: its licence page couldn't be read. |

## Moving one back

Read the source's pages again, correct the record, and move it to `../entries/` only if the whole source may then be stored and shown. `node sources/validate.mjs` has the last word.

None of this is legal advice.
