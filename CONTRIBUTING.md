# Adding to the bank

The bank is questions and the ideas they check, in plain JSON files. `FORMAT.md` is the full format. This page is the short way in.

## Where things go

| To add | Change |
|---|---|
| Questions on a topic that already has a pack | `items` in `subjects/<subject>/<pack>/pack.json` |
| A topic its subject doesn't have yet | A new folder `subjects/<subject>/<pack>/` with a `pack.json` |
| A subject | A new folder `subjects/<subject>/` with a `subject.json`, then its first pack |

Every question checks one concept in its own pack. If the idea isn't a concept there yet, add the concept first.

## The steps

1. Run `npm ci`, with Node 22.
2. Write or change the pack. Every new or changed question starts as `"verification": { "status": "draft" }`.
3. Run `node tools/validate.mjs subjects/<subject>/<pack>` and fix every error.
4. Verify the drafts: two or more solvers answer them without seeing the answers, and `tools/grade.mjs` compares. `pipeline/README.md` has each command.
5. Fix or reject what the solvers disagreed with, and verify those again.
6. Run `npm test` and `node tools/build.mjs`, then open a pull request.

Only `tools/grade.mjs` marks a question verified. Never write `verified` by hand.

## With an agent

The files in `pipeline/prompts/` are instructions for agents: `author.md` writes a pack, `solver.md` answers blind, `grader.md` grades, and `repair.md` fixes what failed. A solver must be a separate agent that has never seen the pack, so never the one that wrote it. With Claude Code, `pipeline/synthesize.workflow.js` runs the whole loop.

## Rules

- Write every question from the idea. Never copy or reword a question or a passage from a textbook, an exam or a course's materials.
- A question has one right answer. One that two careful people could answer differently gets reworded or rejected.
- Once a question is on `main`, its `id` is never reused or renamed, and a concept's `name` never changes. Apps keep students' progress by them.
- Everything in the bank is CC0 1.0. By opening a pull request you release what you add under it.

## What happens to a pull request

CI checks the format, runs the tools' tests and builds the bank. A `verified` mark in a pull request is a claim, so the blind solve is run again before the pull request is merged.
