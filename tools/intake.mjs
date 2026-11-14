// Takes in what Ceder's app sent for the bank: an export file from Ceder's review queue (made with
// scripts/bank-queue-export.mjs in the app's repository), then places a draft where the pipeline can verify it.
//
//   node tools/intake.mjs <export.jsonl>                     checks every line and stages it under .work/intake/
//   node tools/intake.mjs --place <draft id>                 puts a staged draft at subjects/<subject>/<pack>/pack.json
//        [--as <subject>/<pack>] [--concept <draft concept>=<plan concept> …]
//   --out <dir>                                              the staging folder (.work/intake when not given)
//   --root <dir>                                             the bank's folder (this tool's parent folder when not given)
//
// The export holds, after a header line, the subject and topic names students reviewed and sent from Ceder's app
// ("request" lines: how many students sent each, and the first day), and draft packs an AI wrote from a subject's and
// topic's names alone, with the bank's catalogue ("draft" lines). Nothing about any student is in it, and no draft was
// written from a course's materials. A draft is text-only choice and order items, every one "draft": nothing in it is
// verified until this bank's own blind solve says so (pipeline/README.md).
//
// Checking: every line must have exactly its keys. Each draft's pack must pass `checkBank` with --text-only and
// --kinds=choice,order, beside its subject (the bank's own, or a stand-in when the bank doesn't have the subject yet),
// every item exactly { "status": "draft" }, plain text with no web or email address, and every item agreed by the
// app's blind second model. Drafts that pass are staged at .work/intake/drafts/<id>/ (pack.json, and intake.json with
// where it came from), and requests are added up in .work/intake/requests.json. Each is printed with the packs in
// plan/ and subjects/ whose names it shares. Exits 1 if any line fails; the lines that pass are still staged.
//
// Placing: copies a staged draft's pack into subjects/, renamed with --as to a planned pack's subject and folder, and
// with its concepts renamed to the plan's (matched by name, or given with --concept). It refuses a subject the bank
// doesn't have, a folder that already exists, and anything checkBank finds wrong with the bank once the pack is in it.
// Only pack.json is written there: the queue's ID, the dates and the models stay in .work/, which is never committed.

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { bankRoot, checkBank, loadBank } from "./validate.mjs";

export const FORMAT = 1;
export const LEVELS = ["secondary", "intro", "upper", "unsure"];
export const ROUTES = ["ceder-ai", "own-key"];
export const VERDICTS = ["agreed", "disagreed", "unanswered", "dropped"];
const KIND_OPTIONS = { textOnly: true, kinds: ["choice", "order"] };

const KEYS = {
  header: ["drafts", "exportedAt", "format", "kind", "requests"],
  request: ["firstDay", "kind", "students", "subject", "topic"],
  draft: ["author", "checker", "checks", "createdOn", "id", "kind", "level", "pack", "route", "subject", "topic"],
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;
/** A model as the queue records it: "<provider>/<model>", with no "@" or spaces (the queue's bank_model). */
const MODEL = /^[a-z][a-z0-9-]{0,31}\/[A-Za-z0-9][A-Za-z0-9._:/-]{0,119}$/;

// A subject's or topic's name, by the same rules as the queue's bank_name: 2 to 80 characters of plain text on one
// line, with a letter, and nothing shaped like a web or email address, a path, a file name or a part of a course.
const NAME_RULES = [
  [/[\u0001-\u001F\u007F-\u009F\u00A0\u00AD\u1680\u2000-\u200F\u2028-\u202F\u205F-\u2064\u3000\uFEFF]/, "isn't plain text on one line"],
  [/^ | $| {2}/, "has a space at an end or two in a row"],
  [/[[\]@<>{}\\|#_:"`\u201C\u201D]/, "uses a character a name may not"],
  [/^\/|\/$|\/\//, "looks like a path"],
  [/(^|[^A-Za-z0-9])[Ww]{3}\./, "looks like a web address"],
  [/\.(com|org|net|edu|gov|io|co|uk|pdf|docx?|pptx?|xlsx?|txt|md|csv|rtf|png|jpe?g|gif|heic|zip|html?|key|pages|numbers)($|[^A-Za-z0-9])/i, "looks like a web address or a file name"],
  [/(^|[^A-Za-z0-9_])[A-Z]{2,5}( ?-?[0-9]{2,4}|[ -][0-9])[A-Z]?($|[^A-Za-z0-9_])/, "looks like a course code"],
  [/[0-9]{3,}/, "has a long number"],
  [/(^|[^A-Za-z0-9_])(dr|prof|professor|mr|mrs|ms|syllabus)($|[^A-Za-z0-9_])/i, "names a person's title or a syllabus"],
  [/(^|[^A-Za-z0-9_])(week|lecture|module|unit|chapter|lab|quiz|exam|midterm|homework|assignment)s? *([0-9]|([ivx]+|one|two|three|four|five)($|[^A-Za-z0-9_]))/i, "names a part of a course"],
];
const LETTER = /\p{L}/u;

/** What's wrong with a subject's or topic's name, or "". */
export function nameProblem(name) {
  if (typeof name !== "string") return "isn't text";
  const length = [...name].length;
  if (length < 2 || length > 80) return "must be 2 to 80 characters";
  if (!LETTER.test(name)) return "has no letter";
  for (const [pattern, problem] of NAME_RULES) if (pattern.test(name)) return problem;
  return "";
}

/** Text a draft may not hold anywhere: markup, control characters, web and email addresses. */
const UNSAFE = [
  [/[<>]/, "holds < or >"],
  [/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/, "holds a control character"],
  [/\b(?:https?|ftp|file):\/\/|\bwww\./i, "holds a web address"],
  [/[^\s@]+@[^\s@]+\.[A-Za-z]{2,}/, "holds an email address"],
];

const keysAre = (value, keys) => value !== null && typeof value === "object" && !Array.isArray(value) && JSON.stringify(Object.keys(value).sort()) === JSON.stringify(keys);
const isCount = (value) => Number.isInteger(value) && value >= 0;
const strings = (value) => typeof value === "string" ? [value] : value && typeof value === "object" ? Object.values(value).flatMap(strings) : [];

/** The subject a draft is checked beside when the bank doesn't have it: only its ID matters. */
const standIn = (root, id) => ({ dir: join(root, "subjects", id), folder: id, data: { formatVersion: 1, id, name: id.slice(0, 60), domain: "natural", summary: "Stand-in for checking a draft." } });

/** `pack` as loadBank would read it from subjects/<its subject>/<its folder>/. */
function entryFor(root, pack) {
  const subject = typeof pack?.subject === "string" ? pack.subject : "";
  const folder = typeof pack?.id === "string" && pack.id.startsWith(`${subject}.`) ? pack.id.slice(subject.length + 1) : "";
  return { dir: join(root, "subjects", subject || "_", folder || "_"), folder, subjectFolder: subject, data: pack };
}

/** checkBank's errors for `pack` alone, beside its subject: a draft's own format, whatever the bank holds. */
export function draftProblems(pack, bank, root = bankRoot) {
  const problems = [];
  if (pack === null || typeof pack !== "object" || Array.isArray(pack) || !Array.isArray(pack.items)) return ["the pack isn't a pack"];
  const entry = entryFor(root, pack);
  if (!SLUG.test(entry.subjectFolder) || !SLUG.test(entry.folder)) problems.push(`the pack's id “${pack.id}” isn't <subject>.<pack>`);
  const subject = bank.subjects.find((one) => one.folder === entry.subjectFolder) ?? standIn(root, entry.subjectFolder || "x");
  const alone = { subjects: [subject], packs: [entry], problems: [] };
  problems.push(...checkBank(alone, { root, all: alone, ...KIND_OPTIONS }).errors);
  for (const item of pack.items) {
    if (!keysAre(item?.verification, ["status"]) || item.verification.status !== "draft") problems.push(`item “${item?.id}” isn't exactly { "status": "draft" }`);
  }
  for (const text of strings(pack)) for (const [pattern, problem] of UNSAFE) if (pattern.test(text)) problems.push(`the pack ${problem}`);
  return [...new Set(problems)];
}

/** What's wrong with one line of an export, or [] when it's good. `bank` is the bank as loadBank reads it. */
export function lineProblems(line, bank, root = bankRoot) {
  const keys = KEYS[line?.kind];
  if (!keys) return ["isn't a header, a request or a draft"];
  if (!keysAre(line, keys)) return [`has the keys ${Object.keys(line).sort().join(", ")}; a ${line.kind} line has exactly ${keys.join(", ")}`];
  const problems = [];
  if (line.kind === "header") {
    if (line.format !== FORMAT) problems.push(`is format ${line.format}; this tool reads format ${FORMAT}`);
    if (typeof line.exportedAt !== "string" || Number.isNaN(Date.parse(line.exportedAt))) problems.push("has no time it was exported");
    if (!isCount(line.requests) || !isCount(line.drafts)) problems.push("doesn't count its lines");
    return problems;
  }
  for (const field of ["subject", "topic"]) {
    const problem = nameProblem(line[field]);
    if (problem) problems.push(`its ${field} ${problem}`);
  }
  if (line.kind === "request") {
    if (!Number.isInteger(line.students) || line.students < 1) problems.push("doesn't say how many students sent it");
    if (typeof line.firstDay !== "string" || !DAY.test(line.firstDay)) problems.push("has no first day");
    return problems;
  }
  if (typeof line.id !== "string" || !UUID.test(line.id)) problems.push("has an id that isn't the queue's");
  if (!LEVELS.includes(line.level)) problems.push(`has the level “${line.level}”`);
  if (!ROUTES.includes(line.route)) problems.push(`has the route “${line.route}”`);
  if (typeof line.author !== "string" || !MODEL.test(line.author)) problems.push("doesn't name the model that wrote it as <provider>/<model>");
  if (line.checker !== null && (typeof line.checker !== "string" || !MODEL.test(line.checker))) problems.push("doesn't name the model that checked it as <provider>/<model>");
  if (typeof line.createdOn !== "string" || !DAY.test(line.createdOn)) problems.push("has no day it was written");
  const checks = line.checks;
  if (!keysAre(checks, ["sameModel", "verdicts"]) || typeof checks.sameModel !== "boolean" || !checks.verdicts || typeof checks.verdicts !== "object" || Array.isArray(checks.verdicts)) {
    problems.push("has checks that aren't { verdicts, sameModel }");
  } else {
    for (const [id, verdict] of Object.entries(checks.verdicts)) if (!VERDICTS.includes(verdict)) problems.push(`has the verdict “${verdict}” for “${id}”`);
    for (const item of Array.isArray(line.pack?.items) ? line.pack.items : []) {
      if (checks.verdicts[item?.id] !== "agreed") problems.push(`has item “${item?.id}”, which the second model didn't agree with`);
    }
  }
  problems.push(...draftProblems(line.pack, bank, root));
  return problems;
}

/** Every line of an export file's text, checked: `{ header, requests, drafts, failures }`; each failure is "line n: …". */
export function readExport(text, bank, root = bankRoot) {
  const failures = [];
  const requests = [];
  const drafts = [];
  let header = null;
  const lines = text.split("\n").map((line, index) => [index + 1, line.trim()]).filter(([, line]) => line);
  for (const [number, raw] of lines) {
    let line;
    try {
      line = JSON.parse(raw);
    } catch {
      failures.push(`line ${number}: isn't JSON`);
      continue;
    }
    const problems = lineProblems(line, bank, root);
    if (!problems.length && line.kind === "header" && (header || number !== lines[0][0])) problems.push("is a second header, or not the first line");
    if (!problems.length && line.kind !== "header" && !header) problems.push("comes before the header");
    if (problems.length) {
      failures.push(...problems.map((problem) => `line ${number}${line?.id ? ` (${line.id})` : ""}: ${problem}`));
      continue;
    }
    if (line.kind === "header") header = line;
    else (line.kind === "request" ? requests : drafts).push(line);
  }
  if (!header) failures.push("the file has no header line");
  else if (!failures.length && (header.requests !== requests.length || header.drafts !== drafts.length)) {
    failures.push(`the header counts ${header.requests} requests and ${header.drafts} drafts; the file has ${requests.length} and ${drafts.length}`);
  }
  return { header, requests, drafts, failures };
}

const STOP = new Set(["and", "the", "for", "with", "from", "into", "its", "their", "how", "what", "why", "basics", "introduction"]);
/** A name's words, a plural "s" dropped, without short and common ones. */
const words = (text) => new Set(String(text).toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").split(/[^a-z0-9]+/).filter((word) => word.length > 2 && !STOP.has(word)).map((word) => word.length > 4 ? word.replace(/s$/, "") : word));

/** Each plan in plan/, by subject. */
export function readPlans(root = bankRoot) {
  const folder = join(root, "plan");
  if (!existsSync(folder)) return {};
  const plans = {};
  for (const name of readdirSync(folder).filter((file) => file.endsWith(".json")).sort()) {
    try {
      const plan = JSON.parse(readFileSync(join(folder, name), "utf8"));
      if (typeof plan?.subject === "string" && Array.isArray(plan.packs)) plans[plan.subject] = plan;
    } catch {
      // plan.mjs check reports a broken plan; a hint can do without it.
    }
  }
  return plans;
}

/**
 * The planned and written packs whose names share words with a subject and topic, best first, at most `count`:
 * `[{ subject, pack, title, written, planned }]`. Only a hint: a maintainer decides where a topic goes.
 */
export function matches(subject, topic, bank, plans, count = 3) {
  const subjectWords = words(subject);
  const topicWords = words(topic);
  const found = new Map();
  const score = (inSubject, title, concepts) => {
    const named = new Set([...words(title), ...concepts.flatMap((name) => [...words(name)])]);
    const shared = [...topicWords].filter((word) => named.has(word)).length;
    return shared ? shared * 2 + ([...subjectWords].some((word) => words(inSubject).has(word)) ? 1 : 0) : 0;
  };
  const add = (subjectId, pack, title, points, how) => {
    if (!points) return;
    const key = `${subjectId}/${pack}`;
    const known = found.get(key) ?? { subject: subjectId, pack, title, written: false, planned: false, points: 0 };
    known[how] = true;
    known.points = Math.max(known.points, points);
    found.set(key, known);
  };
  for (const [subjectId, plan] of Object.entries(plans)) {
    for (const entry of plan.packs) add(subjectId, entry.pack, entry.title, score(subjectId, `${entry.title} ${entry.pack}`, (entry.concepts ?? []).map((one) => one.name)), "planned");
  }
  for (const pack of bank.packs) {
    add(pack.subjectFolder, pack.folder, pack.data?.title ?? pack.folder, score(pack.subjectFolder, `${pack.data?.title ?? ""} ${pack.folder}`, (pack.data?.concepts ?? []).map((one) => one.name)), "written");
  }
  return [...found.values()].sort((a, b) => b.points - a.points || `${a.subject}/${a.pack}`.localeCompare(`${b.subject}/${b.pack}`)).slice(0, count).map(({ points, ...rest }) => rest);
}

/** What checkBank says once `pack` is in the whole bank: clashes with packs, concepts and items already there. */
export function bankClashes(pack, bank, root = bankRoot) {
  const entry = entryFor(root, pack);
  const subjects = bank.subjects.some((one) => one.folder === entry.subjectFolder) ? bank.subjects : [...bank.subjects, standIn(root, entry.subjectFolder)];
  const clashes = bank.packs.some((one) => one.data?.id === pack.id) ? [`the bank already has the pack ${pack.id}`] : [];
  const all = { subjects, packs: [...bank.packs.filter((one) => one.data?.id !== pack.id), entry], problems: [] };
  return [...clashes, ...checkBank({ subjects, packs: [entry], problems: [] }, { root, all, ...KIND_OPTIONS }).errors];
}

/** Writes what passed into `out`: drafts/<id>/pack.json and intake.json, and requests.json added up. Returns the paths. */
export function stage({ header, requests, drafts }, out, { bank, plans, root = bankRoot } = {}) {
  const written = [];
  for (const draft of drafts) {
    const dir = join(out, "drafts", draft.id);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "pack.json"), JSON.stringify(draft.pack, null, 2) + "\n");
    const meta = {
      id: draft.id, subject: draft.subject, topic: draft.topic, level: draft.level, route: draft.route,
      author: draft.author, checker: draft.checker, sameModel: draft.checks.sameModel, verdicts: draft.checks.verdicts,
      createdOn: draft.createdOn, exportedAt: header.exportedAt,
      matches: matches(draft.subject, draft.topic, bank, plans), clashes: bankClashes(draft.pack, bank, root),
    };
    writeFileSync(join(dir, "intake.json"), JSON.stringify(meta, null, 2) + "\n");
    written.push(dir);
  }
  const file = join(out, "requests.json");
  const before = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : { exports: [], requests: [] };
  if (!before.exports.includes(header.exportedAt)) {
    before.exports.push(header.exportedAt);
    for (const request of requests) {
      const key = `${request.subject.toLowerCase()}\n${request.topic.toLowerCase()}`;
      const known = before.requests.find((one) => `${one.subject.toLowerCase()}\n${one.topic.toLowerCase()}` === key);
      if (known) {
        known.students += request.students;
        if (request.firstDay < known.firstDay) known.firstDay = request.firstDay;
      } else before.requests.push({ subject: request.subject, topic: request.topic, students: request.students, firstDay: request.firstDay });
    }
  }
  for (const request of before.requests) request.matches = matches(request.subject, request.topic, bank, plans);
  before.requests.sort((a, b) => b.students - a.students || a.subject.localeCompare(b.subject) || a.topic.localeCompare(b.topic));
  mkdirSync(out, { recursive: true });
  writeFileSync(file, JSON.stringify(before, null, 2) + "\n");
  written.push(file);
  return written;
}

/**
 * A staged draft's pack, renamed to subjects/<subject>/<pack> and to the plan's concepts there. `concepts` maps a
 * draft concept's ID to a planned one's; a draft concept the plan names the same way is matched without it.
 * Returns `{ pack, notes }`, or throws with what to do.
 */
export function placed(draft, { subject, pack: folder, plan = null, concepts = {} }) {
  if (!SLUG.test(subject) || subject.length > 40 || !SLUG.test(folder) || folder.length > 40) throw new Error(`“${subject}/${folder}” isn't <subject>/<pack> in lowercase words joined by hyphens`);
  const notes = [];
  const planned = plan?.packs.find((entry) => entry.pack === folder) ?? null;
  const id = `${subject}.${folder}`;
  const rename = new Map();
  for (const concept of draft.concepts) {
    let to = concepts[concept.id];
    if (!to && planned) to = planned.concepts.find((one) => one.id === concept.id || one.name.toLowerCase() === concept.name.toLowerCase())?.id;
    if (planned && !to) throw new Error(`The draft's concept “${concept.id}” (“${concept.name}”) isn't one ${subject}'s plan lists for ${folder}: give --concept ${concept.id}=<one of ${planned.concepts.map((one) => one.id).join(", ")}>`);
    if (planned && !planned.concepts.some((one) => one.id === to)) throw new Error(`${to} isn't a concept ${subject}'s plan lists for ${folder}`);
    to ??= concept.id;
    if (!SLUG.test(to)) throw new Error(`“${to}” isn't a concept ID`);
    if ([...rename.values()].includes(to)) throw new Error(`Two of the draft's concepts would both become “${to}”`);
    rename.set(concept.id, to);
  }
  const names = new Map((planned?.concepts ?? []).map((one) => [one.id, one.name]));
  const counts = new Map();
  const items = draft.items.map((item) => {
    const concept = rename.get(item.concept);
    const n = (counts.get(concept) ?? 0) + 1;
    counts.set(concept, n);
    return { ...item, id: `${id}.${concept}-${n}`, concept };
  });
  const result = {
    ...draft, id, subject,
    concepts: draft.concepts.map((concept) => ({ ...concept, id: rename.get(concept.id), name: names.get(rename.get(concept.id)) ?? concept.name })),
    items,
  };
  if (!planned) notes.push(`plan/${subject}.json doesn't list ${folder}: add it, with exactly the concepts ${result.concepts.map((one) => one.id).join(", ")}, before the pull request (plan/README.md).`);
  else {
    const missing = planned.concepts.filter((one) => !result.concepts.some((concept) => concept.id === one.id)).map((one) => one.id);
    if (missing.length) notes.push(`The plan has ${missing.join(", ")} in ${folder} too; write them into the pack (pipeline/prompts/author.md), or plan.mjs check fails.`);
  }
  return { pack: result, notes };
}

/** Puts a staged draft into the bank at `root`. Returns `{ file, notes }`, or throws, writing nothing. */
export function place(id, { out, root = bankRoot, as = null, concepts = {} }) {
  if (!UUID.test(id)) throw new Error(`“${id}” isn't a draft's ID from the export`);
  const staged = join(out, "drafts", id, "pack.json");
  if (!existsSync(staged)) throw new Error(`No staged draft ${id} in ${out}: run intake on the export first.`);
  const draft = JSON.parse(readFileSync(staged, "utf8"));
  const [subject, folder] = as ? as.split("/") : [draft.subject, draft.id.slice(draft.subject.length + 1)];
  const bank = loadBank(root);
  if (!bank.subjects.some((one) => one.folder === subject)) throw new Error(`The bank has no subject ${subject}. Add it first (CONTRIBUTING.md, "Asking for a subject", steps 2 to 5), or place the draft --as <subject>/<pack> in one it has.`);
  const dir = join(root, "subjects", subject, folder ?? "");
  if (existsSync(dir)) throw new Error(`subjects/${subject}/${folder} already exists. Never overwrite a pack: copy the items you want into it by hand, or place the draft --as another pack.`);
  const plan = readPlans(root)[subject] ?? null;
  const { pack, notes } = placed(draft, { subject, pack: folder ?? "", plan, concepts });
  const entry = { dir, folder, subjectFolder: subject, data: pack };
  const { errors } = checkBank({ subjects: bank.subjects.filter((one) => one.folder === subject), packs: [entry], problems: [] }, { root, all: { ...bank, packs: [...bank.packs, entry] }, ...KIND_OPTIONS });
  if (errors.length) throw new Error(`The pack wouldn't pass the bank's checks there:\n${errors.map((error) => `  ${error}`).join("\n")}`);
  mkdirSync(dir, { recursive: true });
  const file = join(dir, "pack.json");
  writeFileSync(file, JSON.stringify(pack, null, 2) + "\n", { flag: "wx" });
  return { file, notes };
}

function main(args) {
  const option = (name) => {
    const at = args.indexOf(name);
    return at >= 0 ? args[at + 1] : undefined;
  };
  const root = resolve(option("--root") ?? bankRoot);
  const out = resolve(option("--out") ?? join(root, ".work", "intake"));
  const placing = option("--place");
  if (placing) {
    const concepts = {};
    args.forEach((arg, at) => {
      if (arg !== "--concept") return;
      const [from, to] = (args[at + 1] ?? "").split("=");
      if (!from || !to) throw new Error("--concept takes <draft concept>=<plan concept>");
      concepts[from] = to;
    });
    const { file, notes } = place(placing, { out, root, as: option("--as") ?? null, concepts });
    console.log(`Placed ${file}. Every item is still a draft; verify it with the blind solve (pipeline/README.md, steps 2 to 5).`);
    for (const note of notes) console.log(note);
    return 0;
  }
  const valued = new Set(["--out", "--root"]);
  const file = args.find((arg, at) => !arg.startsWith("--") && !valued.has(args[at - 1]));
  if (!file) throw new Error("Usage: node tools/intake.mjs <export.jsonl> [--out <dir>], or --place <draft id> [--as <subject>/<pack>] [--concept <from>=<to>]");
  const bank = loadBank(root);
  const plans = readPlans(root);
  const read = readExport(readFileSync(resolve(file), "utf8"), bank, root);
  if (read.header) stage(read, out, { bank, plans, root });
  for (const failure of read.failures) console.log(`error: ${failure}`);
  for (const draft of read.drafts) {
    const meta = JSON.parse(readFileSync(join(out, "drafts", draft.id, "intake.json"), "utf8"));
    console.log(`draft ${draft.id}: “${draft.subject}” / “${draft.topic}” (${draft.level}), ${draft.pack.items.length} items as ${draft.pack.id}, by ${draft.author}${draft.checks.sameModel ? ", checked by the same model" : `, checked by ${draft.checker}`}`);
    for (const match of meta.matches) console.log(`  shares words with ${match.subject}/${match.pack} (“${match.title}”), ${match.written ? "written" : "planned, not written"}`);
    for (const clash of meta.clashes) console.log(`  clashes with the bank: ${clash}`);
  }
  console.log(`${read.requests.length} topic request${read.requests.length === 1 ? "" : "s"} added to ${join(out, "requests.json")}; ${read.drafts.length} draft${read.drafts.length === 1 ? "" : "s"} staged in ${join(out, "drafts")}; ${read.failures.length} error${read.failures.length === 1 ? "" : "s"}.`);
  return read.failures.length ? 1 : 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.exit(main(process.argv.slice(2)));
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
