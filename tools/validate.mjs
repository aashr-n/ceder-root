// Checks the bank's source against FORMAT.md: every subject.json and pack.json against its schema, then what a schema
// can't say: that IDs are unique and resolve, that prerequisites don't cycle, that files exist and are safe to ship.
//
//   node tools/validate.mjs                     the whole bank
//   node tools/validate.mjs subjects/biology    one subject, or one pack's folder
//   --allow-missing-assets                      a missing asset file is a warning (while its maker is still at work)
//   --require-verified                          a pack with a concept that has fewer than 4 verified items fails
//
// Exits 1 when anything fails. Other tools import `loadBank` and `checkBank`.

import Ajv2020 from "ajv/dist/2020.js";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const bankRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const MAX_ASSET_BYTES = 2 * 1024 * 1024;
/** What an SVG may not hold: anything that runs, loads, or points outside the file. */
const SVG_FORBIDDEN = [/<script\b/i, /<foreignObject\b/i, /<image\b/i, /<a\b/i, /<filter\b/i, /\bon[a-z]+\s*=/i, /\bhref\s*=\s*["'](?!#)/i, /url\(\s*["']?(?!#)/i, /<!ENTITY/i, /<style\b/i];

const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));
const folders = (path) => existsSync(path) ? readdirSync(path).filter((name) => !name.startsWith(".") && statSync(join(path, name)).isDirectory()).sort() : [];

/**
 * The bank's source as it is on disk: `{ subjects: [{ dir, data }], packs: [{ dir, data }], problems }`. A file that
 * isn't JSON is reported in `problems` and left out. `only` limits it to one subject's or pack's folder.
 */
export function loadBank(root = bankRoot, only) {
  const problems = [];
  const subjects = [];
  const packs = [];
  const wanted = only ? resolve(only) : null;
  for (const subject of folders(join(root, "subjects"))) {
    const subjectDir = join(root, "subjects", subject);
    if (wanted && !(wanted === subjectDir || wanted.startsWith(subjectDir + "/"))) continue;
    const file = join(subjectDir, "subject.json");
    try {
      subjects.push({ dir: subjectDir, folder: subject, data: readJson(file) });
    } catch (error) {
      problems.push(`${relative(root, file)}: ${error.message}`);
    }
    for (const pack of folders(subjectDir)) {
      const packDir = join(subjectDir, pack);
      if (wanted && wanted !== subjectDir && wanted !== packDir) continue;
      const packFile = join(packDir, "pack.json");
      if (!existsSync(packFile)) {
        problems.push(`${relative(root, packDir)}: no pack.json`);
        continue;
      }
      try {
        packs.push({ dir: packDir, folder: pack, subjectFolder: subject, data: readJson(packFile) });
      } catch (error) {
        problems.push(`${relative(root, packFile)}: ${error.message}`);
      }
    }
  }
  return { subjects, packs, problems };
}

const refOf = (subject, id) => id.includes("/") ? id : `${subject}/${id}`;

/**
 * Everything wrong with a loaded bank, as `{ errors, warnings }` of plain sentences. `all` is the whole bank when
 * `bank` is only part of it, so prerequisites in other packs resolve.
 */
export function checkBank(bank, { root = bankRoot, allowMissingAssets = false, requireVerified = false, all = bank } = {}) {
  const errors = [...bank.problems];
  const warnings = [];
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  const validSubject = ajv.compile(readJson(join(root, "schema", "subject.schema.json")));
  const validPack = ajv.compile(readJson(join(root, "schema", "pack.schema.json")));
  const where = (entry, file) => relative(root, join(entry.dir, file));
  const schemaErrors = (validate, at) => (validate.errors ?? []).slice(0, 12).map((error) => `${at}${error.instancePath || ""}: ${error.message}${error.params?.additionalProperty ? ` (${error.params.additionalProperty})` : ""}${error.params?.unevaluatedProperty ? ` (${error.params.unevaluatedProperty})` : ""}`);

  for (const subject of bank.subjects) {
    const at = where(subject, "subject.json");
    if (!validSubject(subject.data)) errors.push(...schemaErrors(validSubject, at));
    else if (subject.data.id !== subject.folder) errors.push(`${at}: id “${subject.data.id}” doesn't match its folder “${subject.folder}”`);
  }

  // Every concept in the whole bank, by ref, so prerequisites can cross packs and subjects.
  const concepts = new Map();
  const itemIds = new Map();
  for (const pack of all.packs) {
    for (const concept of Array.isArray(pack.data?.concepts) ? pack.data.concepts : []) {
      if (typeof concept?.id !== "string") continue;
      const ref = `${pack.subjectFolder}/${concept.id}`;
      if (concepts.has(ref) && concepts.get(ref).pack !== pack) {
        if (bank.packs.includes(pack)) errors.push(`${where(pack, "pack.json")}: concept “${concept.id}” is also in ${concepts.get(ref).pack.data.id}`);
        continue;
      }
      concepts.set(ref, { pack, concept });
    }
    for (const item of Array.isArray(pack.data?.items) ? pack.data.items : []) {
      if (typeof item?.id !== "string") continue;
      if (itemIds.has(item.id) && itemIds.get(item.id) !== pack && bank.packs.includes(pack)) errors.push(`${where(pack, "pack.json")}: item “${item.id}” is also in ${itemIds.get(item.id).data.id}`);
      itemIds.set(item.id, pack);
    }
  }

  for (const pack of bank.packs) {
    const at = where(pack, "pack.json");
    const data = pack.data;
    if (!validPack(data)) {
      errors.push(...schemaErrors(validPack, at));
      continue;
    }
    const fail = (message) => errors.push(`${at}: ${message}`);
    if (data.subject !== pack.subjectFolder) fail(`subject “${data.subject}” doesn't match its folder “${pack.subjectFolder}”`);
    if (data.id !== `${pack.subjectFolder}.${pack.folder}`) fail(`id “${data.id}” should be “${pack.subjectFolder}.${pack.folder}”`);
    if (!all.subjects.some((subject) => subject.folder === pack.subjectFolder)) fail(`its subject has no subject.json`);

    const byId = new Map();
    for (const concept of data.concepts) {
      if (byId.has(concept.id)) fail(`concept “${concept.id}” appears twice`);
      byId.set(concept.id, concept);
      const names = [concept.name, ...(concept.aliases ?? [])].map((name) => name.toLowerCase());
      if (new Set(names).size !== names.length) fail(`concept “${concept.id}” repeats its name in its aliases`);
      const elements = new Set();
      for (const element of concept.elements ?? []) {
        if (elements.has(element.id)) fail(`concept “${concept.id}” has element “${element.id}” twice`);
        elements.add(element.id);
      }
      for (const required of concept.requires ?? []) {
        const ref = refOf(data.subject, required);
        if (ref === `${data.subject}/${concept.id}`) fail(`concept “${concept.id}” requires itself`);
        else if (!concepts.has(ref)) fail(`concept “${concept.id}” requires “${required}”, which isn't in the bank`);
      }
      const words = (concept.explain?.text ?? "").trim().split(/\s+/).filter(Boolean).length;
      if (concept.explain && (words < 40 || words > 130)) fail(`concept “${concept.id}” has an explanation of ${words} words; write 50 to 110`);
    }

    const artifacts = new Map();
    for (const artifact of data.artifacts) {
      if (artifacts.has(artifact.id)) fail(`artifact “${artifact.id}” appears twice`);
      artifacts.set(artifact.id, artifact);
    }
    const asset = (path, what) => {
      const file = join(pack.dir, path);
      if (!existsSync(file)) {
        (allowMissingAssets ? warnings : errors).push(`${at}: ${what} file ${path} is missing`);
        return null;
      }
      const size = statSync(file).size;
      if (size > MAX_ASSET_BYTES) fail(`${path} is ${(size / 1048576).toFixed(1)} MB; keep assets under 2 MB`);
      return file;
    };
    for (const artifact of data.artifacts) {
      if (artifact.kind === "diagram") {
        const file = asset(artifact.file, `diagram “${artifact.id}”’s`);
        if (file) {
          const svg = readFileSync(file, "utf8");
          if (!/viewBox\s*=\s*["']0 0 1200 900["']/.test(svg)) fail(`${artifact.file} needs viewBox="0 0 1200 900"`);
          for (const pattern of SVG_FORBIDDEN) if (pattern.test(svg)) fail(`${artifact.file} holds something an SVG here may not: ${pattern.source}`);
        }
        const spots = artifact.hotspots ?? [];
        const seen = new Set();
        for (const spot of spots) {
          if (seen.has(spot.id)) fail(`diagram “${artifact.id}” has hotspot “${spot.id}” twice`);
          seen.add(spot.id);
        }
        // x and r are fractions of the width, y of the height: compare in the picture's own 1200 by 900 units.
        for (let i = 0; i < spots.length; i++) {
          for (let j = i + 1; j < spots.length; j++) {
            const distance = Math.hypot((spots[i].x - spots[j].x) * 1200, (spots[i].y - spots[j].y) * 900);
            if (distance < (spots[i].r + spots[j].r) * 1200) fail(`diagram “${artifact.id}”: hotspots “${spots[i].id}” and “${spots[j].id}” overlap`);
          }
        }
      } else if (artifact.kind === "model3d") {
        asset(artifact.files.usdz, `model “${artifact.id}”’s`);
        if (artifact.files.glb) asset(artifact.files.glb, `model “${artifact.id}”’s`);
        asset(artifact.poster, `model “${artifact.id}”’s poster`);
      } else if (artifact.kind === "sequence") {
        const over = artifacts.get(artifact.over);
        if (!over || over.kind !== "diagram") fail(`sequence “${artifact.id}” plays over “${artifact.over}”, which isn't a diagram in this pack`);
        else {
          const spots = new Set((over.hotspots ?? []).map((spot) => spot.id));
          for (const step of artifact.steps) if (step.focus && !spots.has(step.focus)) fail(`sequence “${artifact.id}” focuses on “${step.focus}”, which isn't a hotspot of “${artifact.over}”`);
        }
      }
    }
    for (const concept of data.concepts) {
      if (concept.explain?.artifact && !artifacts.has(concept.explain.artifact)) fail(`concept “${concept.id}” explains with “${concept.explain.artifact}”, which isn't an artifact in this pack`);
    }

    const verified = new Map(data.concepts.map((concept) => [concept.id, 0]));
    const seenItems = new Set();
    for (const item of data.items) {
      const failItem = (message) => fail(`item “${item.id}” ${message}`);
      if (seenItems.has(item.id)) failItem("appears twice");
      seenItems.add(item.id);
      if (!item.id.startsWith(`${data.id}.`) || !SLUG.test(item.id.slice(data.id.length + 1))) failItem(`should be named “${data.id}.<name>”`);
      const concept = byId.get(item.concept);
      if (!concept) {
        failItem(`checks “${item.concept}”, which isn't a concept in this pack`);
        continue;
      }
      if (item.element && !(concept.elements ?? []).some((element) => element.id === item.element)) failItem(`checks element “${item.element}”, which “${item.concept}” doesn't have`);
      if (item.artifact && !artifacts.has(item.artifact)) failItem(`shows “${item.artifact}”, which isn't an artifact in this pack`);
      if (item.kind === "choice") {
        if (item.answer >= item.choices.length) failItem("has an answer past its last choice");
        if (item.choices.some((choice) => /^(all|none) of the above\.?$/i.test(choice.trim()))) failItem("has an “all of the above” choice");
      }
      if (item.kind === "label") {
        const diagram = artifacts.get(item.artifact);
        if (!diagram || diagram.kind !== "diagram") failItem("needs a diagram to tap");
        else if (!(diagram.hotspots ?? []).some((spot) => spot.id === item.target)) failItem(`targets “${item.target}”, which isn't a hotspot of “${item.artifact}”`);
        else if ((diagram.hotspots ?? []).length < 3) failItem("is on a diagram with fewer than 3 hotspots, so it's a guess");
      }
      if (item.verification.status === "verified") {
        if (item.verification.agreed > item.verification.solvers) failItem("says more solvers agreed than answered");
        verified.set(item.concept, verified.get(item.concept) + 1);
      }
    }
    for (const [id, count] of verified) {
      if (count < 4) (requireVerified ? errors : warnings).push(`${at}: concept “${id}” has ${count} verified item${count === 1 ? "" : "s"}; a pack needs 4 for each`);
    }
    // A student can score without knowing the subject when the right choice stands out by its length or its place.
    const choices = data.items.filter((item) => item.kind === "choice" && item.verification.status !== "rejected");
    if (choices.length >= 12) {
      const longest = choices.filter((item) => item.choices.every((choice, index) => index === item.answer || choice.length < item.choices[item.answer].length)).length;
      if (longest / choices.length > 0.4) warnings.push(`${at}: the right choice is the longest in ${longest} of ${choices.length} choice items; make each item's choices alike in length`);
      const places = new Map();
      for (const item of choices) places.set(item.answer, (places.get(item.answer) ?? 0) + 1);
      const [place, most] = [...places].sort((a, b) => b[1] - a[1])[0];
      if (most / choices.length > 0.45) warnings.push(`${at}: the right choice is in place ${place + 1} in ${most} of ${choices.length} choice items; spread it across the places`);
    }
  }

  // Prerequisites must not cycle, anywhere in the bank.
  const state = new Map();
  const visit = (ref, path) => {
    if (state.get(ref) === "done") return;
    if (state.get(ref) === "open") {
      errors.push(`prerequisites cycle: ${[...path.slice(path.indexOf(ref)), ref].join(" → ")}`);
      return;
    }
    state.set(ref, "open");
    const entry = concepts.get(ref);
    for (const required of entry?.concept.requires ?? []) {
      const next = refOf(entry.pack.subjectFolder, required);
      if (concepts.has(next)) visit(next, [...path, ref]);
    }
    state.set(ref, "done");
  };
  for (const ref of concepts.keys()) visit(ref, []);

  return { errors: [...new Set(errors)], warnings: [...new Set(warnings)] };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const only = args.find((arg) => !arg.startsWith("--"));
  const all = loadBank(bankRoot);
  const bank = only ? loadBank(bankRoot, only) : all;
  const { errors, warnings } = checkBank(bank, {
    all,
    allowMissingAssets: args.includes("--allow-missing-assets"),
    requireVerified: args.includes("--require-verified"),
  });
  for (const warning of warnings) console.log(`warning: ${warning}`);
  for (const error of errors) console.log(`error: ${error}`);
  const items = bank.packs.flatMap((pack) => Array.isArray(pack.data?.items) ? pack.data.items : []);
  const verified = items.filter((item) => item?.verification?.status === "verified").length;
  console.log(`${bank.subjects.length} subject${bank.subjects.length === 1 ? "" : "s"}, ${bank.packs.length} pack${bank.packs.length === 1 ? "" : "s"}, ${items.length} items (${verified} verified): ${errors.length} error${errors.length === 1 ? "" : "s"}, ${warnings.length} warning${warnings.length === 1 ? "" : "s"}`);
  process.exit(errors.length ? 1 : 0);
}
