// Checks every file in sources/entries/ against source.schema.json, and the rules a schema can't express.
// Run from anywhere: node sources/validate.mjs
import { readdirSync, readFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import Ajv from "ajv";

const here = dirname(fileURLToPath(import.meta.url));
const entriesDir = join(here, "entries");
const schema = JSON.parse(readFileSync(join(here, "source.schema.json"), "utf8"));
const validate = new Ajv({ allErrors: true }).compile(schema);

const SPDX = /^[A-Za-z0-9.+-]+$/;
const errors = [];
const ids = new Set();
const files = readdirSync(entriesDir).filter((f) => f.endsWith(".json")).sort();

for (const file of files) {
  const fail = (message) => errors.push(`${file}: ${message}`);
  let entry;
  try {
    entry = JSON.parse(readFileSync(join(entriesDir, file), "utf8"));
  } catch (error) {
    fail(`not valid JSON (${error.message})`);
    continue;
  }
  if (!validate(entry)) {
    for (const e of validate.errors) fail(`${e.instancePath || "/"} ${e.message}`);
    continue;
  }
  if (entry.id !== basename(file, ".json")) fail(`id "${entry.id}" doesn't match the file name`);
  if (ids.has(entry.id)) fail(`duplicate id "${entry.id}"`);
  ids.add(entry.id);
  if (entry.license !== "per-item" && entry.license !== "unknown" && !SPDX.test(entry.license)) {
    fail(`license "${entry.license}" is not an SPDX id, "per-item" or "unknown"`);
  }
  if (entry.use === "copy-share-alike" && entry.license !== "per-item" && !/-SA-/.test(entry.license)) {
    fail(`use is copy-share-alike but license "${entry.license}" isn't a share-alike licence`);
  }
  if (/-NC(-|$)/.test(entry.license) && entry.use !== "link-only") {
    fail(`license "${entry.license}" is NonCommercial, so use must be link-only`);
  }
  if (entry.use === "copy" && !/^(CC0|CC-BY-\d|PDDL|MIT)/.test(entry.license) && entry.license !== "per-item") {
    fail(`use is copy but license "${entry.license}" doesn't allow copying into the CC BY bank`);
  }
}

if (files.length === 0) errors.push("no entries found");
for (const error of errors) console.log(`error: ${error}`);
console.log(`${files.length} source${files.length === 1 ? "" : "s"}: ${errors.length} error${errors.length === 1 ? "" : "s"}`);
process.exit(errors.length ? 1 : 0);
