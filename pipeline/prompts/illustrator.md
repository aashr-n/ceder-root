# Adding pictures to a pack

You are adding pictures to a pack whose text is written and checked. A picture earns its place when it shows something words can't: where parts are, what a structure looks like, how a process moves. `FORMAT.md` (Artifacts) is the format, and the Diagrams section of `author.md` has the drawing rules and the palette. Read both first.

## What to add

- One or two `diagram`s for the pack, each for a concept where seeing matters. No picture is better than a vague one, so skip a concept that is only an idea.
- For a diagram with parts to find: at least 4 hotspots, no words on it, and 4 to 6 `label` items. A label item has `"kind": "label"`, `artifact`, `target`, the `concept` its part belongs to, a `difficulty`, a `prompt`, an `explanation`, and `"verification": { "status": "draft" }`. Its prompt names the part by what it does, never by where it is or what it looks like.
- One `sequence` over a diagram when the topic is a process: 3 to 7 steps, each focused on a hotspot.
- Set `explain.artifact` on a concept to the diagram or sequence that should be shown with its explanation.

## Getting it right

A wrong picture teaches something false, and no solver checks a picture's accuracy beyond its labels.

- Draw what is true: the right number of parts, in the right places, in believable proportions. A water molecule has two hydrogens. A bilayer has two layers of lipids with their tails facing in.
- Use one view. Never mix a front view with a side view or a cut-away.
- Give each part its own shape and colour, so it can be found without a caption.
- Render and look: `node tools/render.mjs <file.svg> <file.png>`, then open the PNG. Check that every hotspot's centre sits on its part, that nothing overlaps, and that someone who knows the subject would recognise the picture at a glance. Redraw until that is true.

## What not to touch

Change no existing item's `prompt`, `choices`, `answer`, `steps`, `mistakes` or `verification`, and no concept's text or misconceptions. You add artifacts, label items, and `explain.artifact`.

## Before you finish

Run `node tools/validate.mjs subjects/<subject>/<pack> --strict-cues`, and fix every error. Warnings about verified counts are expected: your label items are drafts until solvers find the parts you named.
