# Writing a pack

You are writing one pack for Ceder's bank: the concepts in a topic, questions that check them, and the diagrams that go with them. Students will answer these on a phone, one per screen, and each answer changes what Ceder thinks they know. A wrong answer key teaches something false, so every item you write will be answered by solvers who never see your key, and only items they agree with are published.

Read `FORMAT.md` first. It is the format, and `tools/validate.mjs` enforces it.

## Concepts

- 6 to 9 concepts, each the size of one lecture topic. Name them the way a textbook's index would.
- `aliases`: other names a lecture slide would use, with plurals. Leave out a name that means something else in another field.
- `requires`: only direct prerequisites, and only concepts that exist (in this pack, or ones you were told another pack has).
- `elements`: 2 to 8 specific things to master inside the concept.
- `explain`: 50 to 110 words for someone meeting the idea for the first time. Say what it is, why it matters, and one concrete picture or example. No Markdown, no lists, no "In this section".

## Items

Write at least 6 per concept, so at least 4 survive checking. Across the pack: about half `choice`, a quarter `recall`, and at least 4 `order` and 4 `label` where the topic has a process and a picture.

- One idea per item. A student should be able to answer in under 20 seconds.
- Write from the idea. Never reword a textbook's or a website's question.
- `choice`: exactly one right answer. Each wrong choice is a mistake students really make. No "all of the above", no "none of the above", no joke choices. See "What gives an answer away" below.
- `recall`: one defensible answer, short enough to hold in the head. "What enzyme unwinds the double helix?" works; "Describe replication" doesn't.
- `order`: steps with one right order. If two steps could swap, merge them or drop one.
- `label`: the prompt names the part ("Tap the organelle that makes most of the cell's ATP"), not where it is.
- `explanation`: why the right answer is right, and for a choice item why the most tempting wrong one is wrong.
- Spread `difficulty`: about 40% 1, 40% 2, 20% 3.
- Numbers must be exact. If an answer needs arithmetic, do it twice.
- Every item starts as `"verification": { "status": "draft" }`. You never mark your own item verified.

## What gives an answer away

A student who doesn't know the subject should do no better than chance. Three things let them:

- **Length.** Write the right choice first, as short as it can be and still be right. Then write each wrong choice to about the same length, in the same grammatical shape and with the same amount of detail. If one choice carries a reason or a qualifier, they all do, the right one included. To even an item out, trim before you pad: a student reads every choice on a phone, and padding only the wrong choices makes the right one the shortest, which gives it away just as well. `node tools/cues.mjs subjects/<subject>/<pack>` lists the items where the right choice is the longest or the shortest.
- **Place.** Apps shuffle the choices, so don't spend effort ordering them, and never name a choice by its place or letter in a prompt or an explanation. Say what it says: "[2 4 | 3] halves only the constant", not "the first choice is wrong".
- **Odd one out.** Make all of an item's choices the same kind of thing: all numbers, all names, or all sentences. Don't let only the right choice echo a word from the prompt, and don't put "always", "never" or "only" in the wrong choices alone.

## Diagrams

Diagrams, sequences, 3D models and the label items on them are made in their own step, by the most capable model available. A pack written by a small, fast model is text only: its brief says so, `validate.mjs --text-only` enforces it, and this section doesn't apply.

Draw each as an SVG on a 1200 by 900 canvas. It will be shown about 350 points wide on a phone, so draw big and simple.

- First element: `<rect width="1200" height="900" rx="44" fill="#FBF8F1"/>`.
- Palette: forest `#2C4A3B`, terracotta `#C96E52`, sand `#F2C091`, blue-grey `#7A99B3`, ochre `#BA9957`, sage `#B8C99E`, ink `#1D2A24`. Outlines 4 to 6 wide in ink or a darker shade of the fill. Soft gradients are fine; drop shadows and filters are not allowed.
- A diagram that `label` items use has no words on it and at least 4 hotspots. Give each part a distinct shape and colour so it can be found without a caption. Hotspot radius at least 0.05, and no two overlap.
- A diagram only used in explanations may carry short labels: `font-family="sans-serif"` (the build sets it in DejaVu Sans), size 34 or more, ink on a light shape.
- Render and look at every diagram before you finish: `node tools/render.mjs <file.svg> <file.png>` from the repository's root, then open the PNG. Check that each hotspot's centre really sits on its part. Redraw until someone who knows the subject would recognise it at a glance.
- Add one `sequence` over a diagram when the topic has steps: 3 to 7 steps, each focused on a hotspot.

## Before you finish

From the repository's root: `node tools/validate.mjs subjects/<subject>/<pack> --allow-missing-assets --strict-cues`. Fix every error. `--strict-cues` makes it an error when the right choice is too often the longest or the shortest, or an explanation seems to name a choice by its place. Warnings about verified counts are expected until the pack is checked.
