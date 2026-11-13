// Builds the bank that apps read (FORMAT.md, "The built bank"): one flat folder holding bank-index.json, a
// bankpack-<id>.json for each pack with at least one verified item, and a bankasset-<hash>.<ext> for each file those
// packs use. It validates first and builds nothing if the bank has errors.
//
//   node tools/build.mjs                  writes dist/
//   --out <dir>                           writes there instead
//   --app --app-dir <dir>                 also writes an app's copy into <dir>: the built bank, plus library-index.json and
//                                         its libraryasset-* files, and sources-index.json (FORMAT.md, "An app's copy")
//   --check-app --app-dir <dir>           writes nothing; exits 1 if <dir> isn't exactly what --app would write
//   --root <dir>                          the bank's folder (this tool's parent folder when not given)
//
// The same source always gives the same bytes: keys are written in a fixed order, packs and subjects by ID, and an
// asset is named by its own hash. Diagrams are rendered from SVG here, with their text set in the fonts in tools/fonts/
// (render.mjs), so a picture is the same on every machine.

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { renderSvg } from "./render.mjs";
import { buildLibrary, buildSourcesIndex } from "./library.mjs";
import { bankRoot, checkBank, loadBank } from "./validate.mjs";

export const FORMAT_VERSION = 1;
export const INDEX_FILE = "bank-index.json";
/**
 * The files a built bank and an app's copy of it are made of, and so the only files the build removes from a folder it
 * writes into: the bank's, the library's (library-index.json, libraryasset-*) and the source catalogue's.
 */
export const BUILT_FILE = /^(bank-index\.json|bankpack-.+\.json|bankasset-[0-9a-f]{16}\.[a-z0-9]+|library-index\.json|libraryasset-[0-9a-f]{16}\.[a-z0-9]+|sources-index\.json)$/;

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const json = (value) => Buffer.from(JSON.stringify(value, null, 2) + "\n");

/** The object with only these keys, in this order, leaving out those that aren't set. */
function pick(object, keys) {
  const picked = {};
  for (const key of keys) if (object[key] !== undefined) picked[key] = object[key];
  return picked;
}

/** A PNG's size in pixels, from its header. */
export function pngSize(bytes) {
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (bytes.length < 24 || signature.some((byte, index) => bytes[index] !== byte) || bytes.toString("latin1", 12, 16) !== "IHDR") return null;
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

const concept = (source) => {
  const built = pick(source, ["id", "name", "aliases", "summary", "requires"]);
  if (source.elements) built.elements = source.elements.map((element) => pick(element, ["id", "name", "aliases"]));
  if (source.explain) built.explain = pick(source.explain, ["text", "artifact"]);
  if (source.misconceptions) built.misconceptions = source.misconceptions.map((entry) => pick(entry, ["id", "claim", "correction"]));
  return built;
};

const item = (source) => {
  const built = pick(source, ["id", "concept", "element", "kind", "difficulty", "prompt", "choices", "answer", "steps", "target", "explanation", "artifact"]);
  if (source.kind !== "choice") delete built.choices;
  if (source.kind !== "choice" && source.kind !== "recall") delete built.answer;
  if (source.kind !== "order") delete built.steps;
  if (source.kind !== "label") delete built.target;
  if (source.sources) built.sources = source.sources.map((entry) => pick(entry, ["title", "url"]));
  // What each wrong choice gives away is published only once a second model, blind to it, has named the same mistake.
  if (source.kind === "choice" && source.mistakes && source.verification.diagnosed >= 1 && source.mistakes.some((entry) => entry !== null)) built.mistakes = [...source.mistakes];
  return built;
};

/**
 * The built bank in memory: `{ files, built, leftOut, errors, warnings }`. `files` maps each file name to its bytes;
 * `built` and `leftOut` say what went in and why the rest didn't. When `errors` isn't empty, `files` is empty.
 */
export function buildBank({ root = bankRoot } = {}) {
  const source = loadBank(root);
  const { errors, warnings } = checkBank(source, { root });
  const result = { files: new Map(), built: [], leftOut: [], errors: [...errors], warnings, revision: null };
  if (errors.length) return result;

  const assets = new Map();
  /** Adds one asset by its bytes and returns its name. */
  const addAsset = (bytes, ext) => {
    const name = `bankasset-${sha256(bytes).slice(0, 16)}.${ext}`;
    assets.set(name, bytes);
    return name;
  };
  const rendered = new Map();
  const diagramImage = (file) => {
    if (!rendered.has(file)) {
      const { png, width, height } = renderSvg(readFileSync(file, "utf8"));
      rendered.set(file, { file: addAsset(png, "png"), width, height });
    }
    return rendered.get(file);
  };

  const summaries = [];
  const subjectsUsed = new Set();
  for (const pack of source.packs) {
    const data = pack.data;
    const status = (name) => data.items.filter((entry) => entry.verification.status === name).length;
    const verified = data.items.filter((entry) => entry.verification.status === "verified");
    if (!verified.length) {
      result.leftOut.push({ pack: data.id, reason: `no verified items (${status("draft")} draft, ${status("rejected")} rejected)` });
      continue;
    }
    const packAssets = new Set();
    const artifacts = [];
    for (const artifact of data.artifacts) {
      const built = pick(artifact, ["id", "kind", "title", "alt", "credit"]);
      if (artifact.kind === "diagram") {
        built.image = diagramImage(join(pack.dir, artifact.file));
        packAssets.add(built.image.file);
        if (artifact.hotspots) built.hotspots = artifact.hotspots.map((spot) => pick(spot, ["id", "label", "x", "y", "r"]));
      } else if (artifact.kind === "model3d") {
        built.usdz = addAsset(readFileSync(join(pack.dir, artifact.files.usdz)), "usdz");
        packAssets.add(built.usdz);
        if (artifact.files.glb) {
          built.glb = addAsset(readFileSync(join(pack.dir, artifact.files.glb)), "glb");
          packAssets.add(built.glb);
        }
        const poster = readFileSync(join(pack.dir, artifact.poster));
        const size = pngSize(poster);
        if (!size) {
          result.errors.push(`${data.id}: model “${artifact.id}”’s poster ${artifact.poster} isn't a PNG`);
          continue;
        }
        built.poster = { file: addAsset(poster, "png"), width: size.width, height: size.height };
        packAssets.add(built.poster.file);
      } else if (artifact.kind === "sequence") {
        built.over = artifact.over;
        built.steps = artifact.steps.map((step) => pick(step, ["title", "text", "focus"]));
      }
      artifacts.push(built);
    }
    const built = {
      formatVersion: FORMAT_VERSION,
      ...pick(data, ["id", "subject", "title", "summary", "license"]),
      concepts: data.concepts.map(concept),
      items: verified.map(item),
      artifacts,
    };
    const file = `bankpack-${data.id}.json`;
    const bytes = json(built);
    result.files.set(file, bytes);
    subjectsUsed.add(data.subject);
    summaries.push({
      ...pick(data, ["id", "subject", "title", "summary"]),
      file,
      hash: sha256(bytes),
      concepts: data.concepts.length,
      items: verified.length,
      assets: [...packAssets].sort(),
    });
    result.built.push({ pack: data.id, file, concepts: data.concepts.length, items: verified.length, draft: status("draft"), rejected: status("rejected"), assets: packAssets.size });
  }
  if (result.errors.length) {
    result.files.clear();
    return result;
  }

  const subjects = source.subjects.filter((subject) => subjectsUsed.has(subject.data.id)).map((subject) => pick(subject.data, ["id", "name", "domain", "summary"]));
  for (const subject of source.subjects) if (!subjectsUsed.has(subject.data.id)) result.leftOut.push({ subject: subject.data.id, reason: "no built packs" });
  const assetNames = [...assets.keys()].sort();
  // Over everything an app reads: the subjects, each pack's file hash, and the assets' names, which are their hashes.
  const revision = sha256(JSON.stringify({ subjects, packs: summaries.map((pack) => [pack.id, pack.hash]), assets: assetNames })).slice(0, 16);
  result.revision = revision;
  result.files.set(INDEX_FILE, json({ formatVersion: FORMAT_VERSION, revision, subjects, packs: summaries }));
  for (const name of assetNames) result.files.set(name, assets.get(name));
  return result;
}

/**
 * An app's copy in memory: the built bank's files plus the library's and the source catalogue's, as `buildBank` does,
 * with `bankFiles` holding the bank's alone. A problem in the library or the catalogue is an error, and then `files`
 * is empty, so nothing is half-exported.
 */
export function buildAppCopy({ root = bankRoot } = {}) {
  const result = buildBank({ root });
  if (result.errors.length) return { ...result, bankFiles: result.files };
  const library = buildLibrary({ root });
  const sources = buildSourcesIndex({ root });
  const errors = [...library.errors, ...sources.errors];
  const bankFiles = result.files;
  if (errors.length) return { ...result, files: new Map(), bankFiles, errors };
  const files = new Map([...bankFiles, ...library.files, ...sources.files]);
  return { ...result, files, bankFiles, libraryItems: library.items, libraryRevision: library.revision, sources: sources.sources };
}

/** The built bank's files already in a folder, by name. */
export function builtFilesIn(dir) {
  const files = new Map();
  if (!existsSync(dir)) return files;
  for (const name of readdirSync(dir).sort()) if (BUILT_FILE.test(name)) files.set(name, readFileSync(join(dir, name)));
  return files;
}

/** Replaces the built bank's files in `dir` with `files`, leaving every other file there alone. */
export function writeBuilt(files, dir) {
  mkdirSync(dir, { recursive: true });
  for (const name of builtFilesIn(dir).keys()) rmSync(join(dir, name));
  for (const [name, bytes] of files) writeFileSync(join(dir, name), bytes);
}

/** How `dir` differs from `files`, as sentences. Empty when it holds exactly these built files. */
export function differences(files, dir) {
  const there = builtFilesIn(dir);
  const found = [];
  for (const [name, bytes] of files) {
    if (!there.has(name)) found.push(`${name} is missing`);
    else if (!there.get(name).equals(bytes)) found.push(`${name} differs`);
  }
  for (const name of there.keys()) if (!files.has(name)) found.push(`${name} is there but the build doesn't make it`);
  return found.sort();
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const USAGE = "usage: node tools/build.mjs [--out <dir>] [(--app | --check-app) --app-dir <dir>] [--root <dir>]";
  const args = process.argv.slice(2);
  let root = bankRoot;
  let out = null;
  let appDir = null;
  let app = false;
  let checkApp = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--root") root = resolve(args[++i]);
    else if (args[i] === "--out") out = resolve(args[++i]);
    else if (args[i] === "--app-dir") appDir = resolve(args[++i]);
    else if (args[i] === "--app") app = true;
    else if (args[i] === "--check-app") checkApp = true;
    else {
      console.error(`unknown option ${args[i]}`);
      console.error(USAGE);
      process.exit(2);
    }
  }
  out ??= join(root, "dist");
  if ((app || checkApp) && !appDir) {
    console.error("--app and --check-app need --app-dir <dir>, the folder that holds the app's copy of the built bank");
    console.error(USAGE);
    process.exit(2);
  }

  const result = app || checkApp ? buildAppCopy({ root }) : buildBank({ root });
  if (result.errors.length) {
    for (const error of result.errors) console.log(`error: ${error}`);
    console.log(`not built: ${result.errors.length} error${result.errors.length === 1 ? "" : "s"} (node tools/validate.mjs lists them too)`);
    process.exit(1);
  }
  if (result.warnings.length) console.log(`${result.warnings.length} validation warning${result.warnings.length === 1 ? "" : "s"}; node tools/validate.mjs lists them`);
  for (const pack of result.built) {
    const missing = pack.draft + pack.rejected;
    console.log(`built ${pack.file}: ${pack.concepts} concepts, ${pack.items} items${missing ? ` (left out ${pack.draft} draft, ${pack.rejected} rejected)` : ""}, ${pack.assets} asset${pack.assets === 1 ? "" : "s"}`);
  }
  for (const entry of result.leftOut) console.log(`left out ${entry.pack ?? `subject ${entry.subject}`}: ${entry.reason}`);
  const assetCount = [...result.files.keys()].filter((name) => name.startsWith("bankasset-")).length;
  const libraryNote = result.libraryItems === undefined ? "" : `, ${result.libraryItems} library item${result.libraryItems === 1 ? "" : "s"}, ${result.sources} source${result.sources === 1 ? "" : "s"}`;
  const summary = `${result.built.length} pack${result.built.length === 1 ? "" : "s"}, ${assetCount} asset${assetCount === 1 ? "" : "s"}${libraryNote}, revision ${result.revision}`;

  if (checkApp) {
    const found = differences(result.files, appDir);
    if (found.length) {
      for (const line of found) console.log(`seed bank: ${line}`);
      console.log(`${appDir} isn't what the build makes (${summary}); run node tools/build.mjs --app --app-dir ${appDir}`);
      process.exit(1);
    }
    console.log(`${appDir} matches the build (${summary})`);
    process.exit(0);
  }
  writeBuilt(result.bankFiles ?? result.files, out);
  console.log(`wrote ${(result.bankFiles ?? result.files).size} file${(result.bankFiles ?? result.files).size === 1 ? "" : "s"} to ${out}: ${summary}`);
  if (app) {
    writeBuilt(result.files, appDir);
    console.log(`wrote ${result.files.size} file${result.files.size === 1 ? "" : "s"} to ${appDir}`);
  }
}
