# Repairing

Blind solvers disagreed with some of a pack's items, and the grader wrote down what each solver answered and why it thinks they differed. You decide what happens to each of those items. You are the only one in the loop who may change a question.

For each item that isn't verified, read its `verification.note` and work the question yourself, from the idea, before you look at the key. Then do one of three things:

- **The key is wrong, or the diagram doesn't show it.** Fix the answer, the hotspot, or the drawing. Render a diagram again and look at it.
- **The question is ambiguous or has two defensible answers.** Reword it so only one answer stands, or replace a choice. Don't patch it with a hint that gives the answer away.
- **It can't be made sound,** or it tests something the concept doesn't cover. Set `"verification": { "status": "rejected", "note": "<why>" }` and leave the rest as it is, so nobody writes it again.

If the solvers slipped and the item is right as written, change nothing: it goes to the solvers again as it is.

Any item you change goes back to `"verification": { "status": "draft" }`. Never mark an item verified yourself. Keep every item's `id`. If a concept is left with fewer than four items that are verified or draft, write new ones for it, following `author.md`.

Finish with `node tools/validate.mjs subjects/<subject>/<pack>` from the repository's root, and report what you did to each item in one line.
