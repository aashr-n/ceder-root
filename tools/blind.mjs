// Writes a set of questions without their answers, for solvers who must never see the keys
// (pipeline/prompts/solver.md).
//
//   node tools/blind.mjs subjects/biology/dna-replication --out .work/blind/dna-a.json
//   node tools/blind.mjs subjects/biology subjects/chemistry --out .work/blind/all.json --all
//
//   --out <file>     where the questions go. A label item's picture is written beside it as <file name>.<blind ID>.png.
//   --all            also export verified items, to check them again. Rejected items are never exported.
//   --root <dir>     the bank's folder (this tool's parent folder when not given)
//
// Each item keeps its prompt and loses its answer, explanation, verification, sources, concept and element. Its ID is
// replaced by a blind ID made from a hash of the real one, because authors name items after what they check
// ("find-helicase"), which can give a label item's answer away. An order item's steps and a label item's lettered spots
// are shuffled by a hash of the item's ID too, so tools/grade.mjs finds the item and redoes the same shuffles without a
// key file anywhere a solver could read it.

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { renderSvg } from "./render.mjs";
import { bankRoot, loadBank } from "./validate.mjs";

const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const INK = "#1D2A24";

/**
 * A shuffle of `count` places decided by `id`: `order[j]` is the original index of what sits at place j. When there are
 * at least two places it is never the original order, so a solver can't answer by leaving the list as it is.
 */
export function permutation(id, count, salt) {
  let order = [];
  for (let attempt = 0; attempt < 16; attempt++) {
    const bytes = createHash("sha256").update(`${salt}:${id}:${attempt}`).digest();
    order = [...Array(count).keys()];
    for (let i = count - 1; i > 0; i--) {
      const j = bytes.readUInt16BE(((count - 1 - i) * 2) % 32) % (i + 1);
      [order[i], order[j]] = [order[j], order[i]];
    }
    if (count < 2 || order.some((value, index) => value !== index)) return order;
  }
  // Sixteen hashes in a row that all give the original order can't happen in practice; rotate to be sure.
  return order.map((_, index) => (index + 1) % count);
}

/** The order an order item's steps are shown in. */
export const stepOrder = (item) => permutation(item.id, item.steps.length, "steps");

/** The order a label item's hotspots are lettered in: letter k is hotspot `spotOrder(...)[k]`. */
export const spotOrder = (item, diagram) => permutation(item.id, (diagram.hotspots ?? []).length, "spots");

/** The ID an item goes by in a blind file: "q-" and 12 hex digits of a hash of its real ID. */
export const blindId = (id) => `q-${createHash("sha256").update(`blind:${id}`).digest("hex").slice(0, 12)}`;

export const letter = (index) => LETTERS[index] ?? `Z${index}`;

/**
 * What a solver who agrees with the key answers, in the terms of the blind file: a choice's index, the shuffled steps'
 * indexes in the right order, or a spot's letter. Null for a recall item, which a person or an agent judges.
 * `packData` is the pack.json the item is in.
 */
export function blindKey(item, packData) {
  if (item.kind === "choice") return item.answer;
  if (item.kind === "order") {
    const order = stepOrder(item);
    return item.steps.map((_, place) => order.indexOf(place));
  }
  if (item.kind === "label") {
    const diagram = packData.artifacts.find((artifact) => artifact.id === item.artifact);
    const spots = diagram.hotspots ?? [];
    const order = spotOrder(item, diagram);
    return letter(order.indexOf(spots.findIndex((spot) => spot.id === item.target)));
  }
  return null;
}

/** An SVG with each spot drawn as a dashed ring and a lettered badge, for a solver to name. */
export function letteredSvg(svg, spots) {
  const marks = spots.map(({ letter: name, x, y, r }) => {
    const cx = x * 1200;
    const cy = y * 900;
    const radius = r * 1200;
    // The badge sits on the ring's upper right, so the part under the spot's centre stays visible.
    const bx = Math.min(1160, Math.max(40, cx + radius * 0.71));
    const by = Math.min(860, Math.max(40, cy - radius * 0.71));
    const n = (value) => Math.round(value * 10) / 10;
    return `<circle cx="${n(cx)}" cy="${n(cy)}" r="${n(radius)}" fill="none" stroke="${INK}" stroke-width="5" stroke-dasharray="14 10"/>` +
      `<circle cx="${n(bx)}" cy="${n(by)}" r="30" fill="#FFFFFF" stroke="${INK}" stroke-width="4"/>` +
      `<text x="${n(bx)}" y="${n(by + 13)}" font-family="sans-serif" font-size="36" font-weight="bold" text-anchor="middle" fill="${INK}">${name}</text>`;
  }).join("");
  const end = svg.lastIndexOf("</svg>");
  if (end < 0) throw new Error("not an SVG: it has no </svg>");
  return `${svg.slice(0, end)}<g>${marks}</g>${svg.slice(end)}`;
}

/** One item as a solver sees it. `imageFor(item)` gives the path a label item's picture is written to. */
export function blindItem(item, pack, subjectName, imageFor) {
  const blind = { id: blindId(item.id), kind: item.kind, subject: subjectName, prompt: item.prompt };
  if (item.kind === "choice") blind.choices = [...item.choices];
  if (item.kind === "order") blind.steps = stepOrder(item).map((index) => item.steps[index]);
  if (item.kind === "label") {
    const diagram = pack.data.artifacts.find((artifact) => artifact.id === item.artifact);
    const hotspots = diagram.hotspots ?? [];
    const spots = spotOrder(item, diagram).map((index, place) => ({ letter: letter(place), x: hotspots[index].x, y: hotspots[index].y, r: hotspots[index].r }));
    const image = imageFor(item);
    const svg = readFileSync(join(pack.dir, diagram.file), "utf8");
    writeFileSync(image, renderSvg(letteredSvg(svg, spots)).png);
    blind.image = image;
    blind.spots = spots.map(({ letter: name, x, y }) => ({ letter: name, x, y }));
  }
  return blind;
}

/** The packs under each of `paths` (subject or pack folders, from the working folder or the bank's root). */
export function packsUnder(paths, root = bankRoot) {
  const packs = [];
  const subjects = new Map();
  for (const path of paths) {
    let folder = resolve(path);
    if (!existsSync(folder)) folder = resolve(root, path);
    if (!existsSync(folder)) throw new Error(`${path}: no such folder`);
    if (!folder.startsWith(resolve(root, "subjects") + "/")) throw new Error(`${path}: not a subject's or a pack's folder in ${root}`);
    const bank = loadBank(root, folder);
    if (bank.problems.length) throw new Error(bank.problems.join("\n"));
    if (!bank.packs.length) throw new Error(`${path}: no packs there`);
    for (const subject of bank.subjects) subjects.set(subject.folder, subject.data);
    for (const pack of bank.packs) if (!packs.some((known) => known.dir === pack.dir)) packs.push(pack);
  }
  return { packs, subjects };
}

/** Writes the blind file and its pictures. Returns what it wrote, by pack. */
export function exportBlind(paths, out, { root = bankRoot, all = false } = {}) {
  const { packs, subjects } = packsUnder(paths, root);
  const target = resolve(out);
  mkdirSync(dirname(target), { recursive: true });
  const stem = basename(target).replace(/\.json$/, "");
  const imageFor = (item) => join(dirname(target), `${stem}.${blindId(item.id)}.png`);
  const items = [];
  const counts = [];
  for (const pack of packs) {
    const wanted = (pack.data.items ?? []).filter((item) => item.verification?.status === "draft" || (all && item.verification?.status === "verified"));
    for (const item of wanted) items.push(blindItem(item, pack, subjects.get(pack.subjectFolder)?.name ?? pack.subjectFolder, imageFor));
    counts.push({ pack: pack.data.id, items: wanted.length, of: (pack.data.items ?? []).length });
  }
  writeFileSync(target, JSON.stringify({ items }, null, 2) + "\n");
  return { file: target, items: items.length, counts };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const paths = [];
  let out = null;
  let root = bankRoot;
  let all = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--out") out = args[++i];
    else if (args[i] === "--root") root = resolve(args[++i]);
    else if (args[i] === "--all") all = true;
    else if (args[i].startsWith("--")) {
      console.error(`unknown option ${args[i]}`);
      process.exit(2);
    } else paths.push(args[i]);
  }
  if (!paths.length || !out) {
    console.error("usage: node tools/blind.mjs <subject or pack folder> [...] --out <file> [--all] [--root <dir>]");
    process.exit(2);
  }
  try {
    const result = exportBlind(paths, out, { root, all });
    for (const count of result.counts) console.log(`${count.pack}: ${count.items} of ${count.of} items`);
    console.log(`wrote ${result.items} item${result.items === 1 ? "" : "s"} to ${result.file}`);
  } catch (error) {
    console.error(`error: ${error.message}`);
    process.exit(1);
  }
}
