// Checks every file in sources/entries/ against source.schema.json, and the rules a schema can't hold: a source's
// licence has to allow what the entry says may be done with it. Run from the repository's root:
//
//   node sources/validate.mjs [folder of entries]
import { readdirSync, readFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import Ajv from "ajv";
import { SITES } from "../tools/ref.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const folder = process.argv[2] ? resolve(process.argv[2]) : join(here, "entries");
const check = new Ajv({ allErrors: true }).compile(JSON.parse(readFileSync(join(here, "source.schema.json"), "utf8")));

/** An SPDX licence ID, or one of the two words for a source that has no single licence or whose licence isn't known. */
const LICENSE = /^([A-Za-z0-9.+-]+|per-item|unknown)$/;
const nonCommercial = (license) => /-NC(-|$)/.test(license);

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
  if (!LICENSE.test(entry.license)) fail(`license "${entry.license}" isn't an SPDX ID, "per-item" or "unknown"`);
  // The bank is CC0, so only what's CC0 can be copied into it, and agents read only what tools/ref.mjs reaches.
  if (entry.bank === "copy" && entry.license !== "CC0-1.0") fail(`bank is "copy", but only a CC0-1.0 source can be copied into the bank`);
  if (entry.bank !== "none" && !(entry.id in SITES)) fail(`bank is "${entry.bank}", but tools/ref.mjs doesn't reach this source, so agents can't read it`);
  // Ceder has paid plans, so it can't show what's licensed for non-commercial use, or what nobody has a licence for.
  if (entry.apps === "show" && (nonCommercial(entry.license) || entry.license === "unknown" || entry.license === "per-item")) {
    fail(`apps is "show", but license "${entry.license}" doesn't allow it: use "link"`);
  }
  if (entry.apps === "show" && entry.license !== "CC0-1.0" && !entry.attribution) fail(`apps is "show" under a licence that asks for credit, so it needs an attribution`);
}

if (files.length === 0) errors.push("there are no entries");
for (const error of errors) console.log(`error: ${error}`);
console.log(`${files.length} source${files.length === 1 ? "" : "s"}: ${errors.length} error${errors.length === 1 ? "" : "s"}`);
process.exit(errors.length ? 1 : 0);
