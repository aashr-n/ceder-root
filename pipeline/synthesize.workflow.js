// Grows the bank: writes new packs and verifies every answer with solvers who never see the keys.
//
// It's a script for Claude Code's Workflow tool. Ask for it in words ("run the bank synthesis workflow for these
// packs"), or call it directly:
//
//   Workflow({ scriptPath: "bank/pipeline/synthesize.workflow.js", args: {
//     bank: "/absolute/path/to/bank",
//     date: "2026-11-09",
//     packs: [{ subject: "physics", pack: "kinematics", brief: "Displacement, velocity, acceleration, …" }],
//   } })
//
// args:
//   bank     the bank's folder, as an absolute path
//   date     today, YYYY-MM-DD, written into each verified item (a workflow script has no clock)
//   packs    what to write. `subject` must already have a subject.json. `brief` says what the pack covers, which
//            concept IDs it must define, and which concepts in other packs it may build on.
//   solvers  how many solvers answer each item (2 when not given). An item is verified only if all agree.
//   rounds   how many times disagreements are repaired and solved again (2 when not given)
//   write    false to skip writing and only verify packs that already exist
//
// Each pack runs on its own: author, then solvers, grader, and repair until everything is verified or rejected or the
// rounds run out. About 3 + solvers × (rounds + 1) agents a pack. What's still unverified at the end stays a draft,
// which the build leaves out.

export const meta = {
  name: 'bank-synthesize',
  description: 'Write new packs for the Ceder bank and verify every answer with blind solvers',
  whenToUse: 'Adding packs to the question bank, or verifying draft items in packs that exist.',
  phases: [
    { title: 'Write', detail: 'one author per pack' },
    { title: 'Solve', detail: 'solvers answer without the keys' },
    { title: 'Grade', detail: 'compare with the keys and record verification' },
    { title: 'Repair', detail: 'fix or reject what solvers disagreed with' },
    { title: 'Build', detail: 'validate and build the bank' },
  ],
}

const input = args ?? {}
const bank = input.bank
const date = input.date
const packs = Array.isArray(input.packs) ? input.packs : []
const solvers = Math.max(1, input.solvers ?? 2)
const rounds = Math.max(0, input.rounds ?? 2)
if (typeof bank !== 'string' || !bank.startsWith('/')) throw new Error('args.bank must be the bank folder as an absolute path')
if (!/^\d{4}-\d{2}-\d{2}$/.test(date ?? '')) throw new Error('args.date must be today as YYYY-MM-DD')
if (!packs.length) throw new Error('args.packs is empty')
for (const pack of packs) {
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(pack.subject ?? '') || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(pack.pack ?? '')) {
    throw new Error('each pack needs a subject and a pack, as lowercase words joined by hyphens')
  }
}

const SHARED = `You are one of several agents working on the question bank at ${bank}, at the same time. Never run git add, commit, stash, checkout, reset or push. Touch only what this brief gives you. Your final message is a report for the coordinator: what you changed, what you ran and its last lines, and anything unfinished or unsure.\n\n`

const folder = (pack) => `subjects/${pack.subject}/${pack.pack}`
const name = (pack) => `${pack.subject}.${pack.pack}`

const author = (pack) => SHARED + `Write one pack. Follow ${bank}/pipeline/prompts/author.md exactly; it is your instructions. Read it, then ${bank}/FORMAT.md.

The pack: ${bank}/${folder(pack)}/pack.json, with the ID ${name(pack)}. ${pack.brief ?? ''}

Create only that folder. Finish by running, from ${bank}: node tools/validate.mjs ${folder(pack)} --allow-missing-assets, and fix every error it reports.`

const solver = (pack, who, round) => SHARED + `Answer a set of questions without seeing their answers. Follow ${bank}/pipeline/prompts/solver.md exactly; it is your instructions.

You are solver "${who}". From ${bank}, run:
  node tools/blind.mjs ${folder(pack)} --out .work/blind/${name(pack)}-r${round}-${who}.json
Then answer every item in that file and write your answers to ${bank}/.work/answers/${name(pack)}-r${round}-${who}.json.

Do not open any pack.json, anything else under subjects/ except the pictures your question file names, anything under dist/, any other file under .work/, or git history. Another solver is answering the same questions separately.`

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

const grader = (pack, round) => SHARED + `Grade blind solvers' answers. Follow ${bank}/pipeline/prompts/grader.md exactly; it is your instructions.

The pack is ${folder(pack)}. Its answers this round are the files ${bank}/.work/answers/${name(pack)}-r${round}-*.json; pass them all to --answers, with --date ${date} and --min-solvers ${solvers}. Change only verification fields, and only through the grade tool.`

const repair = (pack, unverified) => SHARED + `Repair one pack's unverified items. Follow ${bank}/pipeline/prompts/repair.md exactly; it is your instructions.

The pack is ${bank}/${folder(pack)}/pack.json. The grader's reading of each item still unverified:
${unverified.map((item) => `- ${item.id}: ${item.reading}`).join('\n')}`

const results = await pipeline(
  packs,
  async (pack) => {
    if (input.write !== false) await agent(author(pack), { label: `write:${name(pack)}`, phase: 'Write' })
    let graded = null
    for (let round = 0; round <= rounds; round++) {
      await parallel(Array.from({ length: solvers }, (_, index) => () =>
        agent(solver(pack, String.fromCharCode(97 + index), round), { label: `solve:${name(pack)}-${round}${String.fromCharCode(97 + index)}`, phase: 'Solve' })))
      graded = await agent(grader(pack, round), { label: `grade:${name(pack)}-${round}`, phase: 'Grade', schema: GRADED })
      if (!graded || !graded.unverified.length || round === rounds) break
      await agent(repair(pack, graded.unverified), { label: `repair:${name(pack)}-${round}`, phase: 'Repair' })
    }
    return { pack: name(pack), verified: graded?.verified ?? 0, rejected: graded?.rejected ?? 0, unverified: graded?.unverified ?? [] }
  },
)

const done = results.filter(Boolean)
for (const result of done) log(`${result.pack}: ${result.verified} verified, ${result.rejected} rejected, ${result.unverified.length} still draft`)
if (done.length < packs.length) log(`${packs.length - done.length} pack(s) stopped early; see their agents.`)

phase('Build')
const built = await agent(SHARED + `From ${bank}, run node tools/validate.mjs, then node tools/build.mjs. Report the last lines of each, and every error in full. Change nothing.`, { label: 'build', phase: 'Build' })

return { packs: done, build: built }
