export const meta = {
  name: 'bank-grow',
  description: 'Plan subjects, then write, blind-verify, check the mistakes of, and illustrate the next packs in each plan',
  whenToUse: 'Growing the bank: plans a subject, writes the next packs its plan has and the bank lacks, verifies them with blind solvers, checks what each wrong choice gives away, and adds pictures.',
  phases: [
    { title: 'Plan', detail: 'one planner per subject, reading only through tools/ref.mjs' },
    { title: 'Write', detail: 'one author per pack' },
    { title: 'Solve', detail: 'solvers answer without the keys' },
    { title: 'Grade', detail: 'compare with the keys and record verification' },
    { title: 'Repair', detail: 'fix or reject what solvers disagreed with' },
    { title: 'Diagnose', detail: 'a second model names the mistake behind each wrong choice, blind to the tags' },
    { title: 'Illustrate', detail: 'the most capable model adds pictures and label items' },
  ],
}

// Grows the bank across subjects. For each pack: an author writes it, blind solvers verify every answer, a diagnoser
// checks what each wrong choice gives away, and an illustrator adds pictures whose label items are then solved blind
// too. Planners, authors and solvers read nothing from outside but what tools/ref.mjs gives them (prompts/sources.md).
//
// It's a script for Claude Code's Workflow tool. Ask for it in words ("run the bank's grow workflow for these biology
// packs"), or call it directly:
//
//   Workflow({ scriptPath: "pipeline/grow.workflow.js", args: {
//     bank: "/absolute/path/to/ceder-root",
//     date: "2026-11-11",
//     subjects: [{ subject: "biology", packs: ["membrane-transport", "cellular-respiration"] }],
//     fidelity: true,
//     illustrate: ["biology.membrane-transport"],
//   } })
//
// args:
//   bank            this repository's folder, as an absolute path
//   date            today, YYYY-MM-DD, written into each verified item (a workflow script has no clock)
//   subjects        [{ subject, course, packs }]. With `packs`, a list of pack names from the subject's plan, those are
//                   written. Without it the subject is planned as `course` first, and the next packs in the plan are written.
//   packs           how many packs to write per subject that lists none (1 when not given)
//   rounds          how many times disagreements are repaired and solved again (1 when not given)
//   textOnly        false to let authors draw (text only when not given). Leave it on for a small model: pictures are
//                   the illustrator's, which should be the most capable model (README.md, "Who writes what").
//   fidelity        true to have authors name misconceptions and tag wrong choices, and a diagnoser check the tags
//   itemsPerConcept how many items an author writes for each concept, at least (7 when not given)
//   illustrate      pack IDs, such as "biology.membrane-transport", that get pictures once their text is verified
//   illustrateOnly  [{ subject, pack }] packs that are already written and only get pictures
//   models          which model each role runs on: { planner, author, solvers: [one per solver], grader, repair,
//                   diagnoser, illustrator }. A role left out runs on the session's model. The number of solvers is the
//                   length of `solvers` (2 when not given).
//   agentType       a custom agent type for every agent, such as one without web tools (.claude/agents/bank-agent.md)
//
// About 5 agents a text pack, 8 with a repair round, and 4 to 8 more for one that is illustrated.
// synthesize.workflow.js writes packs from briefs you give it instead of from a plan.

const input = args ?? {}
const bank = input.bank
const date = input.date
const subjects = Array.isArray(input.subjects) ? input.subjects : []
const count = Math.max(1, input.packs ?? 1)
const rounds = Math.max(0, input.rounds ?? 1)
const textOnly = input.textOnly !== false
const fidelity = input.fidelity === true
const perConcept = Math.max(6, input.itemsPerConcept ?? 7)
const pictured = new Set(Array.isArray(input.illustrate) ? input.illustrate : [])
const illustrateOnly = Array.isArray(input.illustrateOnly) ? input.illustrateOnly : []
const models = input.models ?? {}
const solverModels = Array.isArray(models.solvers) && models.solvers.length ? models.solvers : [undefined, undefined]
const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/
if (typeof bank !== 'string' || !bank.startsWith('/')) throw new Error('args.bank must be the bank folder as an absolute path')
if (!/^\d{4}-\d{2}-\d{2}$/.test(date ?? '')) throw new Error('args.date must be today as YYYY-MM-DD')
if (!subjects.length && !illustrateOnly.length) throw new Error('args.subjects and args.illustrateOnly are both empty')
for (const s of subjects) {
  if (!SLUG.test(s.subject ?? '')) throw new Error('each subject needs a subject, as lowercase words joined by hyphens')
  if (!Array.isArray(s.packs) && typeof s.course !== 'string') throw new Error(`${s.subject} needs packs to write, or a course to plan it as`)
  for (const pack of s.packs ?? []) if (!SLUG.test(pack)) throw new Error(`${s.subject}: ${pack} isn't a pack name`)
}
for (const one of illustrateOnly) if (!SLUG.test(one.subject ?? '') || !SLUG.test(one.pack ?? '')) throw new Error('each illustrateOnly entry needs a subject and a pack')

// What a pack must pass before its text is solved, and after pictures are added: nothing that gives an answer away,
// and for text nothing but text.
const TEXT_CHECKS = (textOnly ? '--text-only --kinds=choice,order ' : '') + '--strict-cues' + (fidelity ? ' --fidelity' : '')
const PICTURE_CHECKS = '--strict-cues'

const opts = (label, phase, model, extra) => ({ label, phase, ...(model ? { model } : {}), ...(input.agentType ? { agentType: input.agentType } : {}), ...(extra ?? {}) })

const SHARED = `You are one of many agents working on the question bank at ${bank}, at the same time. Run every command from ${bank}. Never run git. Touch only what this brief gives you. Your only outside reading is node tools/ref.mjs, as ${bank}/pipeline/prompts/sources.md says: never use a web search, a web fetch, curl, or any other way to reach a site. Never call a tool whose name starts with mcp__; you need only files and the shell. Your final message is a report for the script that runs you, not for a person: keep it short and factual.

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
    verified: { type: 'integer', description: 'Every verified item in the pack, counting earlier rounds: the verified total node tools/validate.mjs prints for the pack' },
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

const DIAGNOSED = {
  type: 'object',
  required: ['ok', 'gradeLine'],
  properties: {
    ok: { type: 'boolean', description: 'true only if you answered every entry and node tools/diagnose.mjs grade ran without an error' },
    gradeLine: { type: 'string', description: 'the line node tools/diagnose.mjs grade printed for the pack' },
  },
}

const ILLUSTRATED = {
  type: 'object',
  required: ['ok', 'validateLine', 'diagrams', 'labelItems'],
  properties: {
    ok: { type: 'boolean', description: 'true only if you added at least one picture, looked at each one rendered, and validate reported 0 errors' },
    validateLine: { type: 'string', description: 'the last line node tools/validate.mjs printed for the pack' },
    diagrams: { type: 'integer' },
    labelItems: { type: 'integer' },
  },
}

const planner = (s) => SHARED + `Plan one subject. Follow ${bank}/pipeline/prompts/planner.md exactly; it is your instructions. Read it, then ${bank}/plan/README.md and ${bank}/pipeline/prompts/sources.md.

The subject is "${s.subject}". ${bank}/subjects/${s.subject}/subject.json exists; do not change it. Plan it as: ${s.course}. Aim for 5 to 8 concepts a pack.

Pass --for planner:${s.subject} to every tools/ref.mjs call. Write ${bank}/plan/${s.subject}.json and no other file.

Finish with: node tools/plan.mjs check plan/${s.subject}.json (fix every error it reports, and run it again), then: node tools/plan.mjs next ${s.subject} ${count}`

const author = (subject, pack) => SHARED + `Write one pack. Follow ${bank}/pipeline/prompts/author.md; it is your instructions. Read it, then ${bank}/FORMAT.md and ${bank}/pipeline/prompts/sources.md. Where this brief and author.md differ, follow this brief.

The pack: ${bank}/subjects/${subject}/${pack}/pack.json, with the ID ${subject}.${pack}. Its entry in ${bank}/plan/${subject}.json (the one whose "pack" is "${pack}") gives its title, its brief, and the concepts it must define. Use exactly those concept IDs and names, and add no others.
${textOnly ? `
This pack is text only, so that every answer can be checked by a tool. The parts of author.md about recall items, label items, diagrams and sequences do not apply to it. Write "artifacts": [], no label items and no recall items: only choice items, and order items where a topic has steps with one right order.
` : ''}${fidelity ? `
This pack must test how well a student understands, as "Testing how well a student understands" in author.md says: 2 to 4 misconceptions for each concept, a "mistakes" entry for every choice of every choice item, each misconception given away by wrong choices in at least 2 items, and at most 40% of items at difficulty 1.
` : ''}
- At least ${perConcept} items per concept.
- "license" is "CC0-1.0".
- "requires": only concepts that exist now, which are ones in your own pack, and ones that node tools/plan.mjs written <subject> lists for this or another subject. Leave out a prerequisite whose pack isn't written yet.
- Write mathematics and formulas as plain text with Unicode symbols, such as f′(x), x², √x, ×, ÷, ≤, π, H₂O, and fractions as (a + b)/c. No LaTeX and no Markdown.
- Follow "What gives an answer away" in author.md: make each item's choices alike in length, and never name a choice by its place.
- You may read a few pages on the topic through tools/ref.mjs, with --for author:${subject}.${pack}, to settle what the concepts cover. Then write from your own understanding.

Create only that folder. Finish by running node tools/validate.mjs subjects/${subject}/${pack} ${TEXT_CHECKS} and node tools/ref.mjs check subjects/${subject}/${pack}, fixing every error either reports, until both pass. Warnings about verified counts are expected.`

const solver = (subject, pack, who, round) => SHARED + `Answer a set of questions without seeing their answers. Follow ${bank}/pipeline/prompts/solver.md exactly; it is your instructions.

You are solver "${who}". Run:
  node tools/blind.mjs subjects/${subject}/${pack} --out .work/blind/${subject}.${pack}-r${round}-${who}.json
Then answer every item in that file and write your answers to ${bank}/.work/answers/${subject}.${pack}-r${round}-${who}.json.

Work each answer out yourself. For a fact you aren't sure of, you may read up to six pages with node tools/ref.mjs wikipedia "<page title>" --for solver-${who}:${subject}.${pack}. Never search for a question's own words.

Do not open any pack.json, anything else under subjects/ except pictures your question file names, anything under plan/ or dist/, any other file under .work/blind/, .work/answers/ or .work/diagnose/, or git history. Another solver is answering the same questions separately.`

const grader = (subject, pack, round) => SHARED + `Grade blind solvers' answers. Follow ${bank}/pipeline/prompts/grader.md exactly; it is your instructions.

The pack is subjects/${subject}/${pack}. Its answers this round are the files ${bank}/.work/answers/${subject}.${pack}-r${round}-*.json; pass them all to --answers, with --date ${date} and --min-solvers ${solverModels.length}. Change only verification fields, and only through the grade tool. Then run node tools/validate.mjs subjects/${subject}/${pack} for the pack's verified total.`

const repair = (subject, pack, unverified, checks, pictures) => SHARED + `Repair one pack's unverified items. Follow ${bank}/pipeline/prompts/repair.md exactly; it is your instructions.${pictures ? ` These are label items on a picture: you may reword a prompt, move or resize a hotspot, or redraw the picture as ${bank}/pipeline/prompts/illustrator.md says, looking at it rendered before you finish.` : ''}

The pack is ${bank}/subjects/${subject}/${pack}/pack.json. The grader's reading of each item still unverified:
${unverified.map((item) => `- ${item.id}: ${item.reading}`).join('\n')}

When you have finished, run node tools/validate.mjs subjects/${subject}/${pack} ${checks} and node tools/ref.mjs check subjects/${subject}/${pack}, and fix every error either reports.`

const diagnoser = (subject, pack) => SHARED + `Name the mistake behind wrong answers. Follow ${bank}/pipeline/prompts/diagnoser.md exactly; it is your instructions.

Run:
  node tools/diagnose.mjs export subjects/${subject}/${pack} --out .work/diagnose/${subject}.${pack}.json
Then answer every entry in that file and write your answers to ${bank}/.work/diagnose/${subject}.${pack}.answers.json, with "solver": "d".

Only when your answers file is complete, run:
  node tools/diagnose.mjs grade --answers .work/diagnose/${subject}.${pack}.answers.json
and report the line it prints. Do not change your answers after that.

Do not open any pack.json, or anything else under subjects/, plan/ or dist/.`

const illustrator = (subject, pack) => SHARED + `Add pictures to one pack. Follow ${bank}/pipeline/prompts/illustrator.md; it is your instructions. Read it, then the Artifacts part of ${bank}/FORMAT.md and the Diagrams part of ${bank}/pipeline/prompts/author.md.

The pack: ${bank}/subjects/${subject}/${pack}/pack.json. Put its picture files in ${bank}/subjects/${subject}/${pack}/assets/. Change nothing outside that pack's folder.

Finish by running node tools/validate.mjs subjects/${subject}/${pack} ${PICTURE_CHECKS} until it reports 0 errors.`

/** Solves and grades a pack's draft items, repairing between rounds. Rounds are numbered from `first`. */
async function verify(subject, pack, first, checks, repairModel, pictures) {
  const name = `${subject}.${pack}`
  let graded = null
  for (let round = first; round <= first + rounds; round++) {
    await parallel(solverModels.map((model, index) => () => {
      const who = String.fromCharCode(97 + index)
      return agent(solver(subject, pack, who, round), opts(`solve:${name}-${round}${who}`, 'Solve', model))
    }))
    graded = await agent(grader(subject, pack, round), opts(`grade:${name}-${round}`, 'Grade', models.grader, { schema: GRADED }))
    if (!graded || !graded.unverified.length || round === first + rounds) break
    await agent(repair(subject, pack, graded.unverified, checks, pictures), opts(`repair:${name}-${round}`, 'Repair', repairModel))
  }
  return graded
}

async function pictures(subject, pack) {
  const name = `${subject}.${pack}`
  const drawn = await agent(illustrator(subject, pack), opts(`draw:${name}`, 'Illustrate', models.illustrator, { schema: ILLUSTRATED }))
  if (!drawn || !drawn.ok) {
    log(`${name}: pictures not added cleanly (${drawn ? drawn.validateLine : 'no report'})`)
    return { ok: false }
  }
  const graded = drawn.labelItems ? await verify(subject, pack, rounds + 1, PICTURE_CHECKS, models.illustrator, true) : null
  return { ok: true, diagrams: drawn.diagrams, labelItems: drawn.labelItems, unverified: graded?.unverified ?? [] }
}

async function onePack({ subject, pack, write }) {
  const name = `${subject}.${pack}`
  const result = { pack: name }
  if (write) {
    const written = await agent(author(subject, pack), opts(`write:${name}`, 'Write', models.author, { schema: WRITTEN }))
    if (!written || !written.ok) {
      log(`${name}: not written cleanly (${written ? written.validateLine + ' / ' + written.copiedTextLine : 'no report'}); left as it is, unverified`)
      return { ...result, written: false }
    }
    const graded = await verify(subject, pack, 0, TEXT_CHECKS, models.repair, false)
    Object.assign(result, { written: true, items: written.items, verified: graded?.verified ?? 0, rejected: graded?.rejected ?? 0, unverified: graded?.unverified ?? [] })
    if (fidelity) {
      const diagnosed = await agent(diagnoser(subject, pack), opts(`diagnose:${name}`, 'Diagnose', models.diagnoser, { schema: DIAGNOSED }))
      result.mistakes = diagnosed?.gradeLine ?? 'not diagnosed'
    }
  }
  if (!write || pictured.has(name)) result.pictures = await pictures(subject, pack)
  return result
}

phase('Plan')
const planned = await parallel(subjects.map((s) => async () => {
  if (Array.isArray(s.packs)) return s.packs.map((pack) => ({ subject: s.subject, pack, write: true }))
  const plan = await agent(planner(s), opts(`plan:${s.subject}`, 'Plan', models.planner, { schema: PLANNED }))
  if (!plan || !plan.ok) {
    log(`${s.subject}: no usable plan (${plan?.checkLine ?? 'no report'})`)
    return []
  }
  const next = (plan.next ?? []).filter((pack) => SLUG.test(pack)).slice(0, count)
  if (!next.length) log(`${s.subject}: the plan has nothing left to write`)
  return next.map((pack) => ({ subject: s.subject, pack, write: true }))
}))
const targets = [...planned.filter(Boolean).flat(), ...illustrateOnly.map((one) => ({ subject: one.subject, pack: one.pack, write: false }))]

const results = await pipeline(targets, onePack)
const done = results.filter(Boolean)
for (const pack of done) {
  const text = pack.written === false ? 'not written cleanly' : pack.written ? `${pack.verified} verified, ${pack.unverified.length} still draft` : 'text left as it was'
  log(`${pack.pack}: ${text}${pack.mistakes ? `; ${pack.mistakes}` : ''}${pack.pictures ? `; pictures ${pack.pictures.ok ? `${pack.pictures.diagrams} drawn, ${pack.pictures.unverified.length} label items still draft` : 'not added'}` : ''}`)
}
if (done.length < targets.length) log(`${targets.length - done.length} pack(s) stopped early; see their agents.`)
return { packs: done }
