# Adding to the bank

The bank is questions and the ideas they check, in plain JSON files. `FORMAT.md` is the full format. This page is the short way in.

## Where things go

| To add | Change |
|---|---|
| Questions on a topic that already has a pack | `items` in `subjects/<subject>/<pack>/pack.json` |
| A topic its subject doesn't have yet | A new folder `subjects/<subject>/<pack>/` with a `pack.json` |
| A subject | A new folder `subjects/<subject>/` with a `subject.json`, then its first pack |
| What a subject should cover | `plan/<subject>.json`, the list of packs to write (`plan/README.md`) |

Every question checks one concept in its own pack. If the idea isn't a concept there yet, add the concept first.

## The steps

1. Run `npm ci`, with Node 22.
2. Write or change the pack. Every new or changed question starts as `"verification": { "status": "draft" }`.
3. Run `node tools/validate.mjs subjects/<subject>/<pack>` and fix every error.
4. Verify the drafts: two or more solvers answer them without seeing the answers, and `tools/grade.mjs` compares. `pipeline/README.md` has each command.
5. Fix or reject what the solvers disagreed with, and verify those again.
6. Run `npm test` and `node tools/build.mjs`, then open a pull request.

Only `tools/grade.mjs` marks a question verified. Never write `verified` by hand.

## Asking for a subject

Anyone can ask for a subject the bank doesn't have with the issue form "Request a subject" (`.github/ISSUE_TEMPLATE/subject-request.yml`): https://github.com/aashr-n/ceder-root/issues/new?template=subject-request.yml. It asks only for a subject's name, a level, and optional links to open syllabi, and says the issue is public. An app may open that address, with the template chosen, so a student can type the name themselves. Nothing from a student's course goes in it, and an app never fills it in from one.

To turn a request into a subject, a maintainer:

1. Reads the issue. If it holds anything from a private course (a course name or code, a teacher or school, an assignment, a quote), edits it out or closes the issue and asks for a new one without it.
2. Checks the bank doesn't cover the subject already: `subjects/`, and `plan/OVERVIEW.md` for a plan that lists it.
3. Writes `plan/<subject>.json`, the list of packs to write (`plan/README.md`), with `pipeline/prompts/planner.md` or by hand. The subject's name becomes its ID: lowercase words joined by hyphens. Links in the issue are only a hint of what such a course usually covers. The planner's outside reading is still only `tools/ref.mjs` (`pipeline/prompts/sources.md`), and no wording from a syllabus is copied.
4. Adds `subjects/<subject>/subject.json` (`FORMAT.md`), because a plan for a subject the bank doesn't have is an error.
5. Runs `node tools/plan.mjs check plan/<subject>.json` and `node tools/plan.mjs overview`, then writes the first packs from the plan, checked by blind solvers, with the pipeline in `pipeline/README.md` (`node tools/plan.mjs next <subject> 3` lists them, and `pipeline/grow.workflow.js` runs the whole loop).
6. Runs the checks above and opens a pull request that says `Closes #<issue number>`.

## With an agent

The files in `pipeline/prompts/` are instructions for agents: `author.md` writes a pack, `solver.md` answers blind, `grader.md` grades, and `repair.md` fixes what failed. A solver must be a separate agent that has never seen the pack, so never the one that wrote it. With Claude Code, `pipeline/synthesize.workflow.js` runs the whole loop.

## Rules

- Write every question from the idea. Never copy or reword a question or a passage from a textbook, an exam or a course's materials.
- An agent's only outside reading is `node tools/ref.mjs` (`pipeline/prompts/sources.md`): Wikipedia and Wikibooks for what a topic covers, Wikidata for names. Run `node tools/ref.mjs check` on a pack before opening a pull request.
- A question has one right answer. One that two careful people could answer differently gets reworded or rejected.
- Once a question is on `main`, its `id` is never reused or renamed, and a concept's `name` never changes. Apps keep students' progress by them.
- Everything in the bank is CC0 1.0. By opening a pull request you release what you add under it.

## What happens to a pull request

CI checks the format, runs the tools' tests and builds the bank. A `verified` mark in a pull request is a claim, so the blind solve is run again before the pull request is merged.
