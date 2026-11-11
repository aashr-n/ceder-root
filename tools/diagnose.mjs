// Checks what a pack says each wrong choice gives away (FORMAT.md, "Misconceptions"). An author tags a wrong choice with
// the misconception that would lead a student to pick it. A second model then names the mistake behind every wrong
// choice without seeing those tags, and a tag stays only where the two agree (pipeline/prompts/diagnoser.md).
//
//   node tools/diagnose.mjs export subjects/biology/membrane-transport --out .work/diagnose/biology.membrane-transport.json
//   node tools/diagnose.mjs grade --answers .work/diagnose/biology.membrane-transport.answers.json
//   --all            export items that were diagnosed before, too
//   --root <dir>     the bank's folder (this tool's parent folder when not given)
//
// Only verified choice items that carry `mistakes` are exported: a key has to be settled before the mistakes around it
// are. `grade` removes each tag the diagnoser didn't name too, and writes how many diagnosers checked the item into
// `verification.diagnosed`. The build publishes an item's `mistakes` only when that is at least 1.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { blindId, packsUnder, permutation } from "./blind.mjs";
import { bankRoot, loadBank } from "./validate.mjs";

const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));
/** The ID a diagnoser sees for one wrong choice of an item. */
export const entryId = (item, choice) => `${blindId(item.id)}.${choice}`;

/** A pack's misconceptions, each with the name of its concept, in an order that says nothing about which is used. */
export function packMisconceptions(pack) {
  const list = pack.concepts.flatMap((concept) => (concept.misconceptions ?? []).map((entry) => ({ id: entry.id, concept: concept.name, claim: entry.claim })));
  return permutation(pack.id, list.length, "misconceptions").map((index) => list[index]);
}

/** The items a diagnoser is given: `{ misconceptions, entries }` for one pack's data. */
export function diagnosisFor(pack, { all = false } = {}) {
  const entries = [];
  for (const item of pack.items) {
    if (item.kind !== "choice" || !item.mistakes || item.verification.status !== "verified") continue;
    if (!all && item.verification.diagnosed >= 1) continue;
    for (const choice of permutation(item.id, item.choices.length, "diagnose")) {
      if (choice === item.answer) continue;
      entries.push({ id: entryId(item, choice), prompt: item.prompt, right: item.choices[item.answer], picked: item.choices[choice] });
    }
  }
  return { pack: pack.id, misconceptions: packMisconceptions(pack), entries };
}

/**
 * Applies a diagnoser's answers to one pack's data, in place: `{ items, confirmed, dropped, unanswered }`. `answers`
 * maps an entry's ID to a misconception's ID, or to null for a wrong choice that gives none away.
 */
export function applyDiagnosis(pack, answers) {
  const result = { items: 0, confirmed: 0, dropped: 0, unanswered: 0 };
  for (const item of pack.items) {
    if (item.kind !== "choice" || !item.mistakes || item.verification.status !== "verified") continue;
    const wrong = item.choices.map((_, index) => index).filter((index) => index !== item.answer);
    if (!wrong.some((index) => entryId(item, index) in answers)) continue;
    if (!wrong.every((index) => entryId(item, index) in answers)) { result.unanswered++; continue; }
    for (const index of wrong) {
      if (item.mistakes[index] === null) continue;
      if (answers[entryId(item, index)] === item.mistakes[index]) result.confirmed++;
      else { item.mistakes[index] = null; result.dropped++; }
    }
    item.verification.diagnosed = (item.verification.diagnosed ?? 0) + 1;
    result.items++;
  }
  return result;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  let root = bankRoot;
  let out = null;
  let answersFile = null;
  let all = false;
  const rest = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--root") root = resolve(args[++i]);
    else if (args[i] === "--out") out = resolve(args[++i]);
    else if (args[i] === "--answers") answersFile = resolve(args[++i]);
    else if (args[i] === "--all") all = true;
    else rest.push(args[i]);
  }
  try {
    const [command, ...paths] = rest;
    if (command === "export" && paths.length && out) {
      const packs = packsUnder(paths, root).packs.map((pack) => diagnosisFor(pack.data, { all })).filter((entry) => entry.entries.length);
      mkdirSync(dirname(out), { recursive: true });
      writeFileSync(out, JSON.stringify({ packs }, null, 2) + "\n");
      console.log(`wrote ${packs.reduce((sum, pack) => sum + pack.entries.length, 0)} wrong choices from ${packs.length} pack${packs.length === 1 ? "" : "s"} to ${out}`);
    } else if (command === "grade" && answersFile) {
      const answers = readJson(answersFile).answers ?? {};
      for (const pack of loadBank(root).packs) {
        const file = join(pack.dir, "pack.json");
        const data = readJson(file);
        const result = applyDiagnosis(data, answers);
        if (!result.items && !result.unanswered) continue;
        if (result.items) writeFileSync(file, JSON.stringify(data, null, 2) + "\n");
        console.log(`${data.id}: ${result.items} items diagnosed, ${result.confirmed} tags confirmed, ${result.dropped} dropped${result.unanswered ? `, ${result.unanswered} items left as they were because not every wrong choice was answered` : ""}`);
      }
    } else throw new Error("usage: node tools/diagnose.mjs export <pack folder> --out <file> [--all] | grade --answers <file>");
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
