// Checks every file in sources/entries/ against source.schema.json, and the rules a schema can't hold: a source's
// licence has to allow what the entry says may be done with it, and nothing may be shown or copied on a licence that
// nobody checked against the source's own pages. Run from the repository's root:
//
//   node sources/validate.mjs [folder of entries]
//
// It doesn't fetch anything. node sources/recheck.mjs re-reads the evidence pages and reports quotes that have gone.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import Ajv from "ajv";
import { SITES } from "../tools/ref.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const folder = process.argv[2] ? resolve(process.argv[2]) : join(here, "entries");
/** The bank's subject IDs, which an entry's `subjects` must come from. */
const subjectIds = new Set(existsSync(join(here, "..", "subjects")) ? readdirSync(join(here, "..", "subjects"), { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name) : []);
const check = new Ajv({ allErrors: true }).compile(JSON.parse(readFileSync(join(here, "source.schema.json"), "utf8")));

/** An SPDX licence ID, or one of the two words for a source that has no single licence or whose licence isn't known. */
const LICENSE = /^([A-Za-z0-9.+-]+|per-item|unknown)$/;
const nonCommercial = (license) => /-NC(-|$)/.test(license);

/** The rules on what may be done under a licence, for an entry or for one of its parts. */
function licenceRules(item, fail) {
  if (!LICENSE.test(item.license)) fail(`license "${item.license}" isn't an SPDX ID, "per-item" or "unknown"`);
  // Ceder has paid plans, so it can't show what's licensed for non-commercial use, or what nobody has a licence for.
  if (item.apps === "show" && (nonCommercial(item.license) || item.license === "unknown" || item.license === "per-item")) {
    fail(`apps is "show", but license "${item.license}" doesn't allow it: use "link"`);
  }
  if (item.apps === "show" && item.license !== "CC0-1.0" && !item.attribution) fail(`apps is "show" under a licence that asks for credit, so it needs an attribution`);
  // Only a licence read on the source's own pages, with the quotes to show it, can let an app show something.
  if (item.apps === "show" && item.checked === null) fail(`apps is "show", but the licence isn't checked: use "link" until it is`);
}

const errors = [];
const ids = new Set();
const files = readdirSync(folder).filter((file) => file.endsWith(".json")).sort();
for (const file of files) {
  const fail = (message) => errors.push(`${file}: ${message}`);
  let entry;
  try {
    entry = JSON.parse(readFileSync(join(folder, file), "utf8"));
  } catch (error) {
    fail(`isn't JSON (${error.message})`);
    continue;
  }
  if (!check(entry)) {
    for (const problem of check.errors) fail(`${problem.instancePath || "/"} ${problem.message}`);
    continue;
  }
  if (entry.id !== basename(file, ".json")) fail(`its id, "${entry.id}", isn't its file's name`);
  if (ids.has(entry.id)) fail(`another entry has the id "${entry.id}"`);
  ids.add(entry.id);
  licenceRules(entry, fail);
  for (const subject of entry.subjects ?? []) if (!subjectIds.has(subject)) fail(`subjects names “${subject}”, which isn't a subject in the bank (subjects/)`);
  if (entry.subjects && !["show", "link"].includes(entry.apps)) fail(`it has subjects, but apps is "${entry.apps}", so no app offers it for a subject`);
  // The bank is CC0, so only what's CC0 can be copied into it, and agents read only what tools/ref.mjs reaches.
  if (entry.bank === "copy" && entry.license !== "CC0-1.0") fail(`bank is "copy", but only a CC0-1.0 source can be copied into the bank`);
  if (entry.bank === "copy" && entry.checked === null) fail(`bank is "copy", but the licence isn't checked`);
  if (entry.bank !== "none" && !(entry.id in SITES)) fail(`bank is "${entry.bank}", but tools/ref.mjs doesn't reach this source, so agents can't read it`);
  // Conditions on a link only mean something where an app may link to the source.
  if (entry.linking && !["link", "show"].includes(entry.apps)) fail(`it has linking conditions, but apps is "${entry.apps}", so nothing links to it`);
  if (entry.linking && !entry.url) fail(`it has linking conditions, so it needs the url a link opens`);
  const partIds = new Set();
  for (const part of entry.parts ?? []) {
    if (partIds.has(part.id)) fail(`two parts have the id "${part.id}"`);
    partIds.add(part.id);
    licenceRules(part, (message) => fail(`part "${part.id}": ${message}`));
  }
}

if (files.length === 0) errors.push("there are no entries");
for (const error of errors) console.log(`error: ${error}`);
console.log(`${files.length} source${files.length === 1 ? "" : "s"}: ${errors.length} error${errors.length === 1 ? "" : "s"}`);
process.exit(errors.length ? 1 : 0);
