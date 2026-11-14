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

Anyone can ask for a subject the bank doesn't have with the issue form "Request a subject" (`.github/ISSUE_TEMPLATE/subject-request.yml`): https://github.com/aashr-n/ceder-root/issues/new?template=subject-request.yml. It asks only for a subject's name, a level, and optional links to open syllabi, and says the issue is public. An app may open that address, with the template chosen, so a student can type the name themselves. The form is always typed by the person asking: an app never fills it in, and nothing from a student's course goes in it.

Ceder's app has a second, private route, which never opens an issue. A student can send Ceder the subject and topic names in their "What's the bank missing?" list, after reviewing them and editing or removing any; only those names are sent, never a course's name or code, a file name, a quote or anything else from their courses. They can also have an AI write draft questions on one topic, given only the subject's and topic's names, a level and this bank's catalogue. Both wait in Ceder's private review queue until a maintainer takes them in (below). Nothing from the queue is public until it has passed this bank's blind solve and been merged.

To turn a request into a subject, a maintainer:

1. Reads the issue. If it holds anything from a private course (a course name or code, a teacher or school, an assignment, a quote), edits it out or closes the issue and asks for a new one without it.
2. Checks the bank doesn't cover the subject already: `subjects/`, and `plan/OVERVIEW.md` for a plan that lists it.
3. Writes `plan/<subject>.json`, the list of packs to write (`plan/README.md`), with `pipeline/prompts/planner.md` or by hand. The subject's name becomes its ID: lowercase words joined by hyphens. Links in the issue are only a hint of what such a course usually covers. The planner's outside reading is still only `tools/ref.mjs` (`pipeline/prompts/sources.md`), and no wording from a syllabus is copied.
4. Adds `subjects/<subject>/subject.json` (`FORMAT.md`), because a plan for a subject the bank doesn't have is an error.
5. Runs `node tools/plan.mjs check plan/<subject>.json` and `node tools/plan.mjs overview`, then writes the first packs from the plan, checked by blind solvers, with the pipeline in `pipeline/README.md` (`node tools/plan.mjs next <subject> 3` lists them, and `pipeline/grow.workflow.js` runs the whole loop).
6. Runs the checks above and opens a pull request that says `Closes #<issue number>`.

## Taking in what Ceder's app sent

Ceder's maintainers export the review queue as a JSON Lines file (`scripts/bank-queue-export.mjs` in the app's repository, with the queue's service login). A line holds a subject and topic name and how many students sent it, or a draft pack with the models that wrote and checked it. No line holds anything about a student. A draft is text-only choice and order items, written from the names alone, and every item is `draft`: the app's blind second model agreed with each one, which is a first filter, not a verification.

1. Run `node tools/intake.mjs <export.jsonl>`. It checks every line (exactly its keys, the names' rules, `--text-only --kinds=choice,order`, every item exactly `{ "status": "draft" }`, no web or email address) and stages what passes in `.work/intake/`: each draft at `drafts/<id>/pack.json` with `intake.json` beside it, and the topic requests added up in `requests.json`. It prints, for each, the packs in `plan/` and `subjects/` whose names it shares. It exits 1 if a line fails; fix nothing in such a line by hand, and tell the app's maintainers.
2. Read each draft and request. Reject anything that looks like it came from a private course (a course name or code, a teacher or school, an assignment, a quote), or that isn't a topic of a subject.
3. Check the topic against `plan/`. If a planned pack covers it, that is where it goes. If none does and the subject is in the bank, add a pack to `plan/<subject>.json` (`plan/README.md`). If the bank doesn't have the subject, follow "Asking for a subject" above first, steps 2 to 5.
4. Place the draft: `node tools/intake.mjs --place <id> --as <subject>/<pack>`, adding `--concept <draft concept>=<plan concept>` for each concept the plan names differently. It writes only `subjects/<subject>/<pack>/pack.json`, renamed to the plan's pack and concepts, and never overwrites a pack. For questions on a pack that already exists, copy the items into it by hand instead. The queue's ID, the dates and the models stay in `.work/`, which is never committed.
5. Fill the pack out where the plan asks for more (`pipeline/prompts/author.md`), then run `node tools/validate.mjs subjects/<subject>/<pack> --text-only --kinds=choice,order` and `node tools/plan.mjs check plan/<subject>.json`.
6. Verify it as any draft is verified: the blind export, two or more solvers, `tools/grade.mjs`, and repairs (`pipeline/README.md`, steps 2 to 5). Only `tools/grade.mjs` marks an item verified.
7. Run the checks under "The steps" and open a pull request. Say which topic requests it answers, with no student's details.
8. After it is merged, or if a draft is rejected, the app's maintainers mark the draft's row in the queue `merged` or `rejected` with its ID from `intake.json`.

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
