// The subject-level routing table (FORMAT.md, "An app's copy"): every subject in subjects/, with or without packs,
// and the catalogue's sources tagged for it, in a fixed order. A tutor that has classified a student's question into a
// subject looks the subject up here, by its id or by its name or an alias, and offers its sources without any model
// judgement. Concept-level routes stay in library-index.json.
//
//   node tools/routes.mjs build [--out <dir>]    writes routes-index.json (dist/routes/ when not given)
//   node tools/routes.mjs coverage               prints, per subject, its tagged sources, planned and written concepts,
//                                                and written concepts with a library piece, then totals
//   --root <dir>                                 the bank's folder (this tool's parent folder when not given)
//
// `node tools/build.mjs --app` writes routes-index.json into an app's copy too, and --check-app compares it.

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadCatalogue, loadLibrary } from "./library.mjs";
import { bankRoot, checkBank, loadBank, ships } from "./validate.mjs";

export const FORMAT_VERSION = 1;
export const ROUTES_FILE = "routes-index.json";
/**
 * The order a subject's sources are listed in, by the first of each source's `kinds`: a course's own text first, then
 * lessons, then reference works, and so on. A source with no `kinds` comes after all of these, and ties go by id.
 */
export const KIND_ORDER = ["textbook", "lessons", "reference", "documentation", "exercises", "texts", "data", "media", "simulation", "video"];

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const json = (value) => Buffer.from(JSON.stringify(value, null, 2) + "\n");
const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));
/** Compares two strings by their code points, so an order never depends on the machine's locale. */
const byCodePoint = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const kindRank = (entry) => {
  const rank = KIND_ORDER.indexOf(entry.kinds?.[0]);
  return rank === -1 ? KIND_ORDER.length : rank;
};

/** Catalogue entries in their routing order: by the first of their `kinds` in `KIND_ORDER`, those without last, then by id. */
export const routeOrder = (a, b) => kindRank(a) - kindRank(b) || byCodePoint(a.id, b.id);

/**
 * The routing table in memory: `{ files, subjects, errors, revision }`. `routes-index.json` lists every subject that
 * has a subject.json, by id, with its name, domain, summary, aliases, how many packs the build ships for it, and the
 * ids of the catalogue's sources tagged for it that an app may use (`apps` show or link), in `routeOrder`. `files` is
 * empty when there are errors. It doesn't validate the bank: build.mjs and this tool's command line do that first.
 */
export function buildRoutes({ root = bankRoot } = {}) {
  const bank = loadBank(root);
  const result = { files: new Map(), subjects: 0, errors: [...bank.problems], revision: null };
  const ids = new Set(bank.subjects.map((subject) => subject.data.id));
  const packs = new Map();
  for (const pack of bank.packs) if (ships(pack.data)) packs.set(pack.data.subject, (packs.get(pack.data.subject) ?? 0) + 1);
  const tagged = new Map();
  for (const entry of [...loadCatalogue(root).values()].sort(routeOrder)) {
    if (!["show", "link"].includes(entry.apps)) continue;
    for (const subject of entry.subjects ?? []) {
      if (!ids.has(subject)) result.errors.push(`${entry.id}: subjects names “${subject}”, which has no subjects/${subject}/subject.json`);
      tagged.set(subject, [...(tagged.get(subject) ?? []), entry.id]);
    }
  }
  if (result.errors.length) return result;
  const subjects = bank.subjects
    .map((subject) => subject.data)
    .sort((a, b) => byCodePoint(a.id, b.id))
    .map((subject) => ({
      id: subject.id,
      name: subject.name,
      domain: subject.domain,
      summary: subject.summary,
      aliases: [...(subject.aliases ?? [])],
      packs: packs.get(subject.id) ?? 0,
      sources: tagged.get(subject.id) ?? [],
    }));
  const revision = sha256(JSON.stringify(subjects)).slice(0, 16);
  result.revision = revision;
  result.subjects = subjects.length;
  result.files.set(ROUTES_FILE, json({ formatVersion: FORMAT_VERSION, revision, subjects }));
  return result;
}

/**
 * How far routing reaches, per subject, by id: `{ id, sources, show, planned, written, withLibrary }`. `sources` counts
 * the catalogue's entries tagged for the subject, `show` those an app may show, `planned` the concepts in its plan,
 * `written` the concepts in its packs, and `withLibrary` the written ones at least one library piece names.
 */
export function coverage({ root = bankRoot } = {}) {
  const bank = loadBank(root);
  const catalogue = [...loadCatalogue(root).values()];
  const pieces = new Set(loadLibrary(root).items.flatMap((item) => Array.isArray(item.data?.concepts) ? item.data.concepts : []));
  return bank.subjects.map((subject) => subject.data.id).sort(byCodePoint).map((id) => {
    const sources = catalogue.filter((entry) => (entry.subjects ?? []).includes(id));
    const planFile = join(root, "plan", `${id}.json`);
    let planned = 0;
    try {
      if (existsSync(planFile)) planned = readJson(planFile).packs.reduce((sum, pack) => sum + pack.concepts.length, 0);
    } catch { /* plan.mjs check reports a broken plan */ }
    const refs = bank.packs.filter((pack) => pack.subjectFolder === id).flatMap((pack) => (pack.data?.concepts ?? []).map((concept) => `${id}/${concept.id}`));
    return {
      id,
      sources: sources.length,
      show: sources.filter((entry) => entry.apps === "show").length,
      planned,
      written: refs.length,
      withLibrary: refs.filter((ref) => pieces.has(ref)).length,
    };
  });
}

/** The coverage report as a plain text table, one subject a line, then the totals. */
export function coverageTable(rows) {
  const header = ["subject", "sources", "show", "planned", "written", "with library"];
  const sum = (key) => rows.reduce((total, row) => total + row[key], 0);
  const body = rows.map((row) => [row.id, row.sources, row.show, row.planned, row.written, row.withLibrary]);
  const total = [`all ${rows.length} subjects`, sum("sources"), sum("show"), sum("planned"), sum("written"), sum("withLibrary")];
  const table = [header, ...body, total].map((cells) => cells.map(String));
  const widths = header.map((_, column) => Math.max(...table.map((cells) => cells[column].length)));
  const line = (cells) => cells.map((cell, column) => (column === 0 ? cell.padEnd(widths[column]) : cell.padStart(widths[column]))).join("  ").trimEnd();
  const untagged = rows.filter((row) => row.sources === 0).length;
  // A source tagged for several subjects counts once in each, so the sources total counts tags.
  return [
    ...table.map(line),
    `${untagged} of ${rows.length} subject${rows.length === 1 ? "" : "s"} have no tagged source; ${rows.filter((row) => row.written === 0).length} have no written concept`,
  ].join("\n");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const USAGE = "usage: node tools/routes.mjs build [--out <dir>] | coverage   [--root <dir>]";
  const args = process.argv.slice(2);
  let root = bankRoot;
  let out = null;
  const rest = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--root") root = resolve(args[++i]);
    else if (args[i] === "--out") out = resolve(args[++i]);
    else rest.push(args[i]);
  }
  const [command] = rest;
  if (command === "build" && rest.length === 1) {
    const { errors: bankErrors } = checkBank(loadBank(root), { root });
    const result = bankErrors.length ? { errors: bankErrors } : buildRoutes({ root });
    if (result.errors.length) {
      for (const error of result.errors) console.log(`error: ${error}`);
      console.log(`not built: ${result.errors.length} error${result.errors.length === 1 ? "" : "s"}`);
      process.exit(1);
    }
    out ??= join(root, "dist", "routes");
    mkdirSync(out, { recursive: true });
    for (const [name, bytes] of result.files) writeFileSync(join(out, name), bytes);
    console.log(`wrote ${ROUTES_FILE} to ${out}: ${result.subjects} subject${result.subjects === 1 ? "" : "s"}, revision ${result.revision}`);
  } else if (command === "coverage" && rest.length === 1) {
    console.log(coverageTable(coverage({ root })));
  } else {
    console.error(USAGE);
    process.exit(2);
  }
}
