// Grows the bank across subjects: plans each subject, writes the next packs its plan has and the bank lacks, and
// verifies every answer with solvers who never see the keys. Planners, authors and solvers read nothing from outside
// but what tools/ref.mjs gives them (prompts/sources.md).
//
// It's a script for Claude Code's Workflow tool. Ask for it in words ("run the bank's grow workflow for physics and
// chemistry"), or call it directly:
//
//   Workflow({ scriptPath: "pipeline/grow.workflow.js", args: {
//     bank: "/absolute/path/to/ceder-root",
//     date: "2026-11-11",
//     subjects: [{ subject: "physics", course: "Introductory physics: mechanics, then electricity and magnetism" }],
//   } })
//
// About 1 + packs × (2 + (solvers + 1) × (rounds + 1)) agents a subject. synthesize.workflow.js writes packs from briefs
// you give it instead of from a plan.

export const meta = {
  name: 'bank-grow',
  description: 'Plan subjects from Wikipedia-only reading, then write and blind-verify the next packs in each plan',
  whenToUse: 'Growing the bank across subjects: plans a subject, writes the next packs its plan has and the bank lacks, and verifies them with blind solvers.',
  phases: [
    { title: 'Plan', detail: 'one planner per subject, reading only through tools/ref.mjs' },
    { title: 'Write', detail: 'one author per pack' },
    { title: 'Solve', detail: 'solvers answer without the keys' },
    { title: 'Grade', detail: 'compare with the keys and record verification' },
    { title: 'Repair', detail: 'fix or reject what solvers disagreed with' },
  ],
}

// args:
//   bank       this repository's folder, as an absolute path
//   date       today, YYYY-MM-DD, written into each verified item (a workflow script has no clock)
//   subjects   [{ subject, course }]: each subject must already have a subject.json; `course` says what to plan it as
//   packs      how many packs to write per subject, in the plan's order (1 when not given)
//   rounds     how many times disagreements are repaired and solved again (1 when not given)
//   textOnly   false to allow diagrams, label items and recall items (text only when not given)
//   models     which model each role runs on: { planner, author, solvers: [one per solver], grader, repair }.
//              A role left out runs on the session's model. The number of solvers is the length of `solvers` (2 when not given).
//   agentType  a custom agent type for every agent, such as one without web tools

const input = args ?? {}
const bank = input.bank
const date = input.date
const subjects = Array.isArray(input.subjects) ? input.subjects : []
const count = Math.max(1, input.packs ?? 1)
const rounds = Math.max(0, input.rounds ?? 1)
const textOnly = input.textOnly !== false
const models = input.models ?? {}
const solverModels = Array.isArray(models.solvers) && models.solvers.length ? models.solvers : [undefined, undefined]
const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/
if (typeof bank !== 'string' || !bank.startsWith('/')) throw new Error('args.bank must be the bank folder as an absolute path')
if (!/^\d{4}-\d{2}-\d{2}$/.test(date ?? '')) throw new Error('args.date must be today as YYYY-MM-DD')
if (!subjects.length) throw new Error('args.subjects is empty')
for (const s of subjects) if (!SLUG.test(s.subject ?? '') || typeof s.course !== 'string') throw new Error('each subject needs a subject (lowercase words joined by hyphens) and a course')

const opts = (label, phase, model, extra) => ({ label, phase, ...(model ? { model } : {}), ...(input.agentType ? { agentType: input.agentType } : {}), ...(extra ?? {}) })

const SHARED = `You are one of many agents working on the question bank at ${bank}, at the same time. Run every command from ${bank}. Never run git. Touch only what this brief gives you. Your only outside reading is node tools/ref.mjs, as ${bank}/pipeline/prompts/sources.md says: never use a web search, a web fetch, curl, or any other way to reach a site. Your final message is a report for the script that runs you, not for a person: keep it short and factual.

`

const PLANNED = {
  type: 'object',
  required: ['ok', 'checkLine', 'packs', 'next'],
  properties: {
    ok: { type: 'boolean', description: 'true only if the plan file is written and node tools/plan.mjs check reported 0 errors' },
    checkLine: { type: 'string', description: 'the last line node tools/plan.mjs check printed' },
    packs: { type: 'integer', description: 'how many packs the plan has' },
    next: { type: 'array', items: { type: 'string' }, description: 'the "pack" value of each pack that node tools/plan.mjs next printed, in order, copied exactly' },
  },
}

const WRITTEN = {
  type: 'object',
  required: ['ok', 'validateLine', 'copiedTextLine', 'concepts', 'items'],
  properties: {
    ok: { type: 'boolean', description: 'true only if validate reported 0 errors and the copied-text check passed' },
    validateLine: { type: 'string', description: 'the last line node tools/validate.mjs printed for the pack' },
    copiedTextLine: { type: 'string', description: 'the last line node tools/ref.mjs check printed for the pack' },
    concepts: { type: 'integer' },
    items: { type: 'integer' },
  },
}

const GRADED = {
  type: 'object',
  required: ['verified', 'unverified', 'rejected'],
  properties: {
    verified: { type: 'integer', description: 'Items in the pack now verified' },
    rejected: { type: 'integer', description: 'Items in the pack marked rejected' },
    unverified: {
      type: 'array',
      description: 'Every item still draft after grading',
      items: {
        type: 'object',
        required: ['id', 'reading'],
        properties: {
          id: { type: 'string' },
          reading: { type: 'string', description: 'One line: the key is wrong, the question is ambiguous, a solver slipped, or the picture does not show it' },
        },
      },
    },
  },
}

const planner = (s) => SHARED + `Plan one subject. Follow ${bank}/pipeline/prompts/planner.md exactly; it is your instructions. Read it, then ${bank}/plan/README.md and ${bank}/pipeline/prompts/sources.md.

The subject is "${s.subject}". ${bank}/subjects/${s.subject}/subject.json exists; do not change it. Plan it as: ${s.course}. Aim for 5 to 8 concepts a pack.

Pass --for planner:${s.subject} to every tools/ref.mjs call. Write ${bank}/plan/${s.subject}.json and no other file.

Finish with: node tools/plan.mjs check plan/${s.subject}.json (fix every error it reports, and run it again), then: node tools/plan.mjs next ${s.subject} ${count}`

const author = (subject, pack) => SHARED + `Write one pack. Follow ${bank}/pipeline/prompts/author.md; it is your instructions. Read it, then ${bank}/FORMAT.md and ${bank}/pipeline/prompts/sources.md. Where this brief and author.md differ, follow this brief.

The pack: ${bank}/subjects/${subject}/${pack}/pack.json, with the ID ${subject}.${pack}. Its entry in ${bank}/plan/${subject}.json (the one whose "pack" is "${pack}") gives its title, its brief, and the concepts it must define. Use exactly those concept IDs and names, and add no others.
${textOnly ? `
This pack is text only, so that every answer can be checked by a tool. Write "artifacts": [], no label items and no recall items: only choice items, and order items where a topic has steps with one right order. At least 7 items per concept.
` : ''}
- "license" is "CC0-1.0".
- "requires": only concepts that exist now, which are ones in your own pack, and ones that node tools/plan.mjs written <subject> lists for this or another subject. Leave out a prerequisite whose pack isn't written yet.
- Write mathematics and formulas as plain text with Unicode symbols, such as f′(x), x², √x, ×, ÷, ≤, π, H₂O, and fractions as (a + b)/c. No LaTeX and no Markdown.
- You may read a few pages on the topic through tools/ref.mjs, with --for author:${subject}.${pack}, to settle what the concepts cover. Then write from your own understanding.

Create only that folder. Finish by running node tools/validate.mjs subjects/${subject}/${pack} and node tools/ref.mjs check subjects/${subject}/${pack}, fixing every error either reports, until both pass. Warnings about verified counts are expected.`

const solver = (subject, pack, who, round) => SHARED + `Answer a set of questions without seeing their answers. Follow ${bank}/pipeline/prompts/solver.md exactly; it is your instructions.

You are solver "${who}". Run:
  node tools/blind.mjs subjects/${subject}/${pack} --out .work/blind/${subject}.${pack}-r${round}-${who}.json
Then answer every item in that file and write your answers to ${bank}/.work/answers/${subject}.${pack}-r${round}-${who}.json.

Work each answer out yourself. For a fact you aren't sure of, you may read up to six pages with node tools/ref.mjs wikipedia "<page title>" --for solver-${who}:${subject}.${pack}. Never search for a question's own words.

Do not open any pack.json, anything else under subjects/, anything under plan/ or dist/, any other file under .work/blind/ or .work/answers/, or git history. Another solver is answering the same questions separately.`

const grader = (subject, pack, round) => SHARED + `Grade blind solvers' answers. Follow ${bank}/pipeline/prompts/grader.md exactly; it is your instructions.

The pack is subjects/${subject}/${pack}. Its answers this round are the files ${bank}/.work/answers/${subject}.${pack}-r${round}-*.json; pass them all to --answers, with --date ${date} and --min-solvers ${solverModels.length}. Change only verification fields, and only through the grade tool.`

const repair = (subject, pack, unverified) => SHARED + `Repair one pack's unverified items. Follow ${bank}/pipeline/prompts/repair.md exactly; it is your instructions.

The pack is ${bank}/subjects/${subject}/${pack}/pack.json. The grader's reading of each item still unverified:
${unverified.map((item) => `- ${item.id}: ${item.reading}`).join('\n')}

When you have finished, run node tools/validate.mjs subjects/${subject}/${pack} and node tools/ref.mjs check subjects/${subject}/${pack}, and fix every error either reports.`

async function onePack(subject, pack) {
  const name = `${subject}.${pack}`
  const written = await agent(author(subject, pack), opts(`write:${name}`, 'Write', models.author, { schema: WRITTEN }))
  if (!written || !written.ok) {
    log(`${name}: not written cleanly (${written ? written.validateLine + ' / ' + written.copiedTextLine : 'no report'}); left as it is, unverified`)
    return { pack: name, written: false, verified: 0, rejected: 0, unverified: [] }
  }
  let graded = null
  for (let round = 0; round <= rounds; round++) {
    await parallel(solverModels.map((model, index) => () => {
      const who = String.fromCharCode(97 + index)
      return agent(solver(subject, pack, who, round), opts(`solve:${name}-${round}${who}`, 'Solve', model))
    }))
    graded = await agent(grader(subject, pack, round), opts(`grade:${name}-${round}`, 'Grade', models.grader, { schema: GRADED }))
    if (!graded || !graded.unverified.length || round === rounds) break
    await agent(repair(subject, pack, graded.unverified), opts(`repair:${name}-${round}`, 'Repair', models.repair))
  }
  return { pack: name, written: true, items: written.items, verified: graded?.verified ?? 0, rejected: graded?.rejected ?? 0, unverified: graded?.unverified ?? [] }
}

const results = await pipeline(subjects, async (s) => {
  const planned = await agent(planner(s), opts(`plan:${s.subject}`, 'Plan', models.planner, { schema: PLANNED }))
  if (!planned || !planned.ok) {
    log(`${s.subject}: no usable plan (${planned?.checkLine ?? 'no report'})`)
    return { subject: s.subject, planned: false, packs: [] }
  }
  const next = (planned.next ?? []).filter((pack) => SLUG.test(pack)).slice(0, count)
  if (!next.length) log(`${s.subject}: the plan has nothing left to write`)
  const packs = []
  for (const pack of next) packs.push(await onePack(s.subject, pack))
  return { subject: s.subject, planned: true, plannedPacks: planned.packs, packs }
})

const done = results.filter(Boolean)
for (const result of done) for (const pack of result.packs) log(`${pack.pack}: ${pack.written ? `${pack.verified} verified, ${pack.rejected} rejected, ${pack.unverified.length} still draft` : 'not written cleanly'}`)
if (done.length < subjects.length) log(`${subjects.length - done.length} subject(s) stopped early; see their agents.`)
return { subjects: done }
