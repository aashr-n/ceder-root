// Compares blind solvers' answers with the keys and records the result in each item's verification
// (pipeline/prompts/grader.md).
//
//   node tools/grade.mjs --answers .work/answers/dna-a.json .work/answers/dna-b.json --date 2026-11-09
//   node tools/grade.mjs --answers ... --recall-verdicts .work/answers/dna-a.recall-review.json
//
//   --answers <file> [...]       each solver's answers, as solver.md describes: { "solver", "answers": { <id>: { answer, note } } }
//   --recall-verdicts <file>     judgements on recall items, in the form the review file asks for
//   --review <file>              where recall items are written for review (<first answers file>.recall-review.json)
//   --date YYYY-MM-DD            the date written into verification (today, in UTC, when not given)
//   --min-solvers <n>            fewer solvers than this leaves an item as it is (2 when not given)
//   --root <dir>                 the bank's folder (this tool's parent folder when not given)
//
// A choice, order or label item becomes verified when every solver who answered it agreed with the key, and draft,
// with a note saying what each solver answered, when any didn't. A recall item needs a judgement that each solver's
// answer means the same as the key, so it goes to the review file until the verdicts file settles it. Rejected items
// are never changed. Only `verification` changes; a pack.json is rewritten with two-space indentation and a final
// newline, and only when something in it changed.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { blindId, blindKey, spotOrder, stepOrder } from "./blind.mjs";
import { bankRoot, loadBank } from "./validate.mjs";

const NOTE_LENGTH = 500;
const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));
const clip = (text, length) => text.length <= length ? text : `${text.slice(0, length - 1)}…`;
const quote = (text) => `“${clip(String(text).replace(/\s+/g, " ").trim(), 80)}”`;

/** Reads answers files: `[{ solver, file, answers: Map<id, { answer, note }> }]`. Throws on a file it can't use. */
export function readAnswers(files) {
  const solvers = [];
  for (const file of files) {
    const data = readJson(file);
    if (!data || typeof data !== "object" || typeof data.answers !== "object" || data.answers === null) throw new Error(`${file}: has no "answers" object`);
    const solver = typeof data.solver === "string" && data.solver.trim() ? data.solver.trim() : basename(file, ".json");
    if (solvers.some((known) => known.solver === solver)) throw new Error(`${file}: solver “${solver}” is in two answers files`);
    const answers = new Map();
    for (const [id, entry] of Object.entries(data.answers)) {
      const given = entry !== null && typeof entry === "object" && !Array.isArray(entry) ? entry : { answer: entry };
      answers.set(id, { answer: given.answer ?? null, note: typeof given.note === "string" && given.note.trim() ? given.note.trim() : null });
    }
    solvers.push({ solver, file, answers });
  }
  return solvers;
}

const same = (answer, key) => Array.isArray(key)
  ? Array.isArray(answer) && answer.length === key.length && answer.every((value, index) => value === key[index])
  : typeof key === "string" ? typeof answer === "string" && answer.trim().toUpperCase() === key : answer === key;

/** An answer in blind terms, put back into the pack's own terms for the note a person reads. */
function describe(answer, item, packData) {
  if (answer === null || answer === undefined) return "no answer";
  if (item.kind === "choice") return Number.isInteger(answer) && item.choices[answer] !== undefined ? `choice ${answer} ${quote(item.choices[answer])}` : `${JSON.stringify(answer)}, not a choice`;
  if (item.kind === "order") {
    const order = stepOrder(item);
    if (!Array.isArray(answer) || answer.some((index) => !Number.isInteger(index) || order[index] === undefined)) return `${JSON.stringify(answer)}, not an order of the steps`;
    // Step numbers as the pack.json lists them, from 1.
    return `steps ${answer.map((index) => order[index] + 1).join(", ")}`;
  }
  if (item.kind === "label") {
    const diagram = packData.artifacts.find((artifact) => artifact.id === item.artifact);
    const order = spotOrder(item, diagram);
    const place = typeof answer === "string" ? answer.trim().toUpperCase().charCodeAt(0) - 65 : -1;
    const spot = answer && typeof answer === "string" && answer.trim().length === 1 ? diagram.hotspots[order[place]] : undefined;
    return spot ? `${answer.trim().toUpperCase()}, hotspot “${spot.id}”` : `${JSON.stringify(answer)}, not a spot`;
  }
  return quote(answer);
}

const keyText = (item, packData) => item.kind === "recall" ? quote(item.answer)
  : item.kind === "choice" ? describe(item.answer, item, packData)
  : item.kind === "order" ? `steps ${item.steps.map((_, index) => index + 1).join(", ")}`
  : `hotspot “${item.target}”`;

const solverNotes = (responses) => responses.filter((response) => response.note).map((response) => `${response.solver}'s note: ${response.note}`);

/** The verification an item gets from its responses, or null to leave it as it is. */
export function settle(item, packData, responses, { date, verdict = null }) {
  const base = { method: "blind-solve", solvers: responses.length };
  if (item.kind === "recall") {
    if (!verdict) return null;
    const judged = responses.map((response) => verdict.agrees?.[response.solver]);
    if (judged.some((value) => typeof value !== "boolean")) return null;
    const agreed = judged.filter(Boolean).length;
    const reason = typeof verdict.note === "string" && verdict.note.trim() ? verdict.note.trim() : null;
    if (agreed === responses.length) {
      return { status: "verified", ...base, agreed, at: date, note: clip(reason ?? `Judged to mean the same as the key: ${responses.map((response) => response.solver).join(", ")}.`, NOTE_LENGTH) };
    }
    const said = responses.map((response, index) => `${response.solver} ${judged[index] ? "agreed" : "differed"}: ${describe(response.answer, item, packData)}`);
    return { status: "draft", ...base, agreed, at: date, note: clip([`Key ${keyText(item, packData)}.`, ...said, reason, ...solverNotes(responses)].filter(Boolean).join(" "), NOTE_LENGTH) };
  }
  const key = blindKey(item, packData);
  const agreed = responses.filter((response) => same(response.answer, key)).length;
  if (agreed === responses.length) {
    const notes = solverNotes(responses);
    return { status: "verified", ...base, agreed, at: date, ...(notes.length ? { note: clip(notes.join(" "), NOTE_LENGTH) } : {}) };
  }
  const said = responses.map((response) => `${response.solver}: ${describe(response.answer, item, packData)}${same(response.answer, key) ? " (agrees)" : ""}.`);
  return { status: "draft", ...base, agreed, at: date, note: clip([`Key: ${keyText(item, packData)}.`, ...said, ...solverNotes(responses)].join(" "), NOTE_LENGTH) };
}

const sameVerification = (left, right) => JSON.stringify(left) === JSON.stringify(right);

/**
 * Grades `answers` (from readAnswers) against the bank at `root` and writes what changed. Returns
 * `{ rows, review, unknown, changed }`: a row of counts per pack, the recall items still to judge, item IDs no pack
 * has, and the pack files rewritten.
 */
export function grade(answers, { root = bankRoot, date, verdicts = {}, minSolvers = 2, write = true } = {}) {
  const bank = loadBank(root);
  if (bank.problems.length) throw new Error(bank.problems.join("\n"));
  // Solvers answer by blind ID; a real item ID is taken too.
  const realIds = new Map();
  for (const pack of bank.packs) for (const item of Array.isArray(pack.data.items) ? pack.data.items : []) if (typeof item?.id === "string") realIds.set(blindId(item.id), item.id);
  for (const solver of answers) solver.answers = new Map([...solver.answers].map(([id, answer]) => [realIds.get(id) ?? id, answer]));
  const answered = new Set(answers.flatMap((solver) => [...solver.answers.keys()]));
  const known = new Set();
  const rows = [];
  const review = [];
  const changed = [];
  for (const pack of bank.packs) {
    const file = join(pack.dir, "pack.json");
    const data = pack.data;
    const row = { pack: data.id, answered: 0, verified: 0, draft: 0, review: 0, tooFew: 0, rejected: 0 };
    let dirty = false;
    for (const item of Array.isArray(data.items) ? data.items : []) {
      if (!answered.has(item.id)) continue;
      known.add(item.id);
      row.answered++;
      if (item.verification?.status === "rejected") {
        row.rejected++;
        continue;
      }
      const responses = answers.filter((solver) => solver.answers.has(item.id)).map((solver) => ({ solver: solver.solver, ...solver.answers.get(item.id) }));
      if (responses.length < minSolvers) {
        row.tooFew++;
        continue;
      }
      const verdict = verdicts[item.id] ?? null;
      const result = settle(item, data, responses, { date, verdict });
      if (!result) {
        row.review++;
        review.push({ id: item.id, pack: data.id, prompt: item.prompt, key: item.answer, answers: responses.map((response) => ({ solver: response.solver, answer: response.answer, ...(response.note ? { note: response.note } : {}) })) });
        continue;
      }
      row[result.status === "verified" ? "verified" : "draft"]++;
      if (!sameVerification(item.verification, result)) {
        item.verification = result;
        dirty = true;
      }
    }
    if (row.answered) rows.push(row);
    if (dirty && write) {
      // Read the file again just before writing, so only verification is taken from this run.
      const fresh = readJson(file);
      const graded = new Map(data.items.map((item) => [item.id, item.verification]));
      for (const item of fresh.items ?? []) if (graded.has(item.id)) item.verification = graded.get(item.id);
      writeFileSync(file, JSON.stringify(fresh, null, 2) + "\n");
      changed.push(file);
    }
  }
  const unknown = [...answered].filter((id) => !known.has(id)).sort();
  return { rows, review, unknown, changed };
}

/** The review file: recall items with their keys and answers, and a verdicts form to fill in and pass back. */
export function reviewFile(review) {
  return {
    instructions: "For each item, decide whether each solver's answer means the same as the key: the same fact, whatever the wording. A different fact, a broader one, or only part of the key doesn't agree. Fill in every true or false under verdicts, give a one-line note saying why, and run tools/grade.mjs again with the same --answers and --recall-verdicts <this file>.",
    items: review,
    verdicts: Object.fromEntries(review.map((entry) => [entry.id, { agrees: Object.fromEntries(entry.answers.map((answer) => [answer.solver, null])), note: "" }])),
  };
}

const today = () => new Date().toISOString().slice(0, 10);

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const answerFiles = [];
  let verdictsFile = null;
  let reviewPath = null;
  let date = today();
  let minSolvers = 2;
  let root = bankRoot;
  const usage = () => {
    console.error("usage: node tools/grade.mjs --answers <file> [<file> ...] [--recall-verdicts <file>] [--review <file>] [--date YYYY-MM-DD] [--min-solvers <n>] [--root <dir>]");
    process.exit(2);
  };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--answers") while (args[i + 1] && !args[i + 1].startsWith("--")) answerFiles.push(args[++i]);
    else if (args[i] === "--recall-verdicts") verdictsFile = args[++i];
    else if (args[i] === "--review") reviewPath = args[++i];
    else if (args[i] === "--date") date = args[++i];
    else if (args[i] === "--min-solvers") minSolvers = Number(args[++i]);
    else if (args[i] === "--root") root = resolve(args[++i]);
    else usage();
  }
  if (!answerFiles.length || !/^\d{4}-\d{2}-\d{2}$/.test(date ?? "") || !Number.isInteger(minSolvers) || minSolvers < 1) usage();

  let result;
  try {
    const answers = readAnswers(answerFiles);
    const verdicts = verdictsFile ? readJson(verdictsFile).verdicts ?? {} : {};
    result = grade(answers, { root, date, verdicts, minSolvers });
    console.log(`solvers: ${answers.map((solver) => solver.solver).join(", ")}`);
  } catch (error) {
    console.error(`error: ${error.message}`);
    process.exit(1);
  }

  const header = ["pack", "answered", "verified", "draft", "recall to judge", `under ${minSolvers} solvers`, "rejected"];
  const lines = result.rows.map((row) => [row.pack, row.answered, row.verified, row.draft, row.review, row.tooFew, row.rejected].map(String));
  const total = (key) => String(result.rows.reduce((sum, row) => sum + row[key], 0));
  if (result.rows.length > 1) lines.push(["total", total("answered"), total("verified"), total("draft"), total("review"), total("tooFew"), total("rejected")]);
  const widths = header.map((title, column) => Math.max(title.length, ...lines.map((line) => line[column].length)));
  const format = (cells) => cells.map((cell, column) => column ? cell.padStart(widths[column]) : cell.padEnd(widths[column])).join("  ");
  console.log(format(header));
  for (const line of lines) console.log(format(line));
  for (const id of result.unknown) console.log(`warning: no pack has item “${id}”`);
  for (const file of result.changed) console.log(`updated ${file}`);

  const target = resolve(reviewPath ?? `${answerFiles[0].replace(/\.json$/, "")}.recall-review.json`);
  if (result.review.length) {
    // Keep judgements already made in this file, so running again doesn't throw them away.
    const earlier = existsSync(target) ? (() => { try { return readJson(target).verdicts ?? {}; } catch { return {}; } })() : {};
    const file = reviewFile(result.review);
    for (const [id, verdict] of Object.entries(file.verdicts)) if (earlier[id]) file.verdicts[id] = { ...verdict, ...earlier[id], agrees: { ...verdict.agrees, ...earlier[id].agrees } };
    writeFileSync(target, JSON.stringify(file, null, 2) + "\n");
    console.log(`${result.review.length} recall item${result.review.length === 1 ? "" : "s"} to judge: fill in ${target} and run again with --recall-verdicts ${target}`);
  }
}
