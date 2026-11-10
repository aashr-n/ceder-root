import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { buildBank, differences, pngSize, writeBuilt } from "./build.mjs";
import { editPack, fixtureRoot, toolsDir } from "./fixtures/fixture.mjs";

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const parse = (result, name) => JSON.parse(result.files.get(name).toString("utf8"));
const run = (args) => spawnSync(process.execPath, [join(toolsDir, "build.mjs"), ...args], { encoding: "utf8" });
const temp = () => mkdtempSync(join(tmpdir(), "bank-out-"));

test("builds the packs with verified items and leaves out the rest, saying why", () => {
  const result = buildBank({ root: fixtureRoot() });
  assert.deepEqual(result.errors, []);
  const names = [...result.files.keys()].sort();
  assert.equal(names.filter((name) => name.startsWith("bankpack-")).join(), "bankpack-testing.cells.json");
  assert.ok(names.includes("bank-index.json"));
  assert.deepEqual(result.leftOut, [{ pack: "testing.drafts", reason: "no verified items (1 draft, 0 rejected)" }]);
  for (const name of names.filter((name) => name.startsWith("bankasset-"))) {
    assert.match(name, /^bankasset-[0-9a-f]{16}\.(png|usdz|glb)$/);
    assert.equal(name.slice(10, 26), sha256(result.files.get(name)).slice(0, 16));
  }
});

test("a built pack has only verified items, without verification, in the shape types.ts gives", () => {
  const result = buildBank({ root: fixtureRoot() });
  const pack = parse(result, "bankpack-testing.cells.json");
  assert.deepEqual(Object.keys(pack), ["formatVersion", "id", "subject", "title", "summary", "license", "concepts", "items", "artifacts"]);
  assert.deepEqual(pack.items.map((item) => item.id), ["testing.cells.membrane-role", "testing.cells.nucleus-holds", "testing.cells.protein-path", "testing.cells.find-nucleus"]);
  assert.ok(pack.items.every((item) => !("verification" in item)));
  const [choice, recall, order, label] = pack.items;
  assert.deepEqual(Object.keys(choice), ["id", "concept", "element", "kind", "difficulty", "prompt", "choices", "answer", "explanation", "sources"]);
  assert.equal(recall.answer, "The cell's DNA");
  assert.equal(order.steps.length, 4);
  assert.deepEqual([label.artifact, label.target], ["cell-diagram", "nucleus"]);
  // A concept with no verified items left would still be there; here both have some.
  assert.deepEqual(pack.concepts.map((concept) => concept.id), ["cell", "organelle"]);

  const [diagram, model, sequence] = pack.artifacts;
  assert.deepEqual(Object.keys(diagram), ["id", "kind", "title", "alt", "image", "hotspots"]);
  assert.deepEqual([diagram.image.width, diagram.image.height], [1200, 900]);
  assert.ok(!("file" in diagram));
  assert.equal(pngSize(result.files.get(diagram.image.file)).width, 1200);
  assert.deepEqual(Object.keys(model), ["id", "kind", "title", "alt", "credit", "usdz", "glb", "poster"]);
  assert.deepEqual([model.poster.width, model.poster.height], [64, 48]);
  assert.match(model.usdz, /\.usdz$/);
  assert.deepEqual(Object.keys(sequence), ["id", "kind", "title", "alt", "over", "steps"]);
  assert.ok(!("focus" in sequence.steps[0]));
});

test("the index lists each pack's file, hash, counts and assets, and the subjects it uses", () => {
  const result = buildBank({ root: fixtureRoot() });
  const index = parse(result, "bank-index.json");
  assert.deepEqual(Object.keys(index), ["formatVersion", "revision", "subjects", "packs"]);
  assert.match(index.revision, /^[0-9a-f]{16}$/);
  assert.deepEqual(index.subjects.map((subject) => subject.id), ["testing"]);
  const [summary] = index.packs;
  assert.deepEqual(Object.keys(summary), ["id", "subject", "title", "summary", "file", "hash", "concepts", "items", "assets"]);
  assert.equal(summary.hash, sha256(result.files.get(summary.file)));
  assert.deepEqual([summary.concepts, summary.items, summary.assets.length], [2, 4, 4]);
  assert.deepEqual(summary.assets, [...summary.assets].sort());
  for (const name of summary.assets) assert.ok(result.files.has(name), name);
});

test("the same source gives the same bytes, and a change changes the revision", () => {
  const first = buildBank({ root: fixtureRoot() });
  const second = buildBank({ root: fixtureRoot() });
  assert.deepEqual([...first.files.keys()].sort(), [...second.files.keys()].sort());
  for (const [name, bytes] of first.files) assert.ok(bytes.equals(second.files.get(name)), name);

  const root = fixtureRoot();
  editPack(root, (data) => { data.items[4].verification = { status: "verified", method: "blind-solve", solvers: 2, agreed: 2, at: "2026-11-09" }; });
  const changed = buildBank({ root });
  assert.notEqual(parse(changed, "bank-index.json").revision, parse(first, "bank-index.json").revision);
  assert.equal(parse(changed, "bankpack-testing.cells.json").items.length, 5);
});

test("a bank with errors isn't built", () => {
  const root = fixtureRoot();
  editPack(root, (data) => { data.concepts[0].requires = ["organelle"]; });
  const result = buildBank({ root });
  assert.ok(result.errors.length > 0);
  assert.equal(result.files.size, 0);
  const cli = run(["--root", root, "--out", temp()]);
  assert.equal(cli.status, 1);
  assert.match(cli.stdout, /not built/);
});

test("a poster that isn't a PNG stops the build", () => {
  const root = fixtureRoot();
  writeFileSync(join(root, "subjects", "testing", "cells", "assets", "cell-poster.png"), "not a png");
  const result = buildBank({ root });
  assert.ok(result.errors.some((error) => error.includes("isn't a PNG")));
  assert.equal(result.files.size, 0);
});

test("writing replaces built files and leaves other files alone", () => {
  const dir = temp();
  writeFileSync(join(dir, "bankasset-0000000000000000.png"), "stale");
  writeFileSync(join(dir, "bankpack-old.pack.json"), "{}");
  writeFileSync(join(dir, "README.md"), "kept");
  const result = buildBank({ root: fixtureRoot() });
  writeBuilt(result.files, dir);
  const names = readdirSync(dir).sort();
  assert.ok(names.includes("README.md"));
  assert.ok(!names.includes("bankasset-0000000000000000.png"));
  assert.ok(!names.includes("bankpack-old.pack.json"));
  assert.deepEqual(differences(result.files, dir), []);
});

test("the command line writes --out, --app writes the seed bank, and --check-app compares without writing", () => {
  const root = fixtureRoot();
  const out = join(temp(), "dist");
  const app = join(temp(), "SeedBank");

  const missing = run(["--root", root, "--check-app", "--app-dir", app]);
  assert.equal(missing.status, 1);
  assert.match(missing.stdout, /seed bank: bank-index\.json is missing/);
  assert.ok(!existsSync(app));

  const built = run(["--root", root, "--out", out, "--app", "--app-dir", app]);
  assert.equal(built.status, 0, built.stdout + built.stderr);
  assert.match(built.stdout, /built bankpack-testing\.cells\.json: 2 concepts, 4 items \(left out 4 draft, 1 rejected\), 4 assets/);
  assert.match(built.stdout, /left out testing\.drafts: no verified items/);
  assert.deepEqual(readdirSync(out).sort(), readdirSync(app).sort());

  const same = run(["--root", root, "--check-app", "--app-dir", app]);
  assert.equal(same.status, 0, same.stdout);
  assert.match(same.stdout, /matches the build/);

  writeFileSync(join(app, "bank-index.json"), "{}");
  mkdirSync(join(app, "other"));
  writeFileSync(join(app, "bankasset-1111111111111111.png"), "extra");
  const drifted = run(["--root", root, "--check-app", "--app-dir", app]);
  assert.equal(drifted.status, 1);
  assert.match(drifted.stdout, /bank-index\.json differs/);
  assert.match(drifted.stdout, /bankasset-1111111111111111\.png is there but the build doesn't make it/);
  assert.equal(readFileSync(join(app, "bank-index.json"), "utf8"), "{}");
});

test("pngSize reads a PNG's header and refuses anything else", () => {
  assert.equal(pngSize(Buffer.from("not a png at all, really not")), null);
  const result = buildBank({ root: fixtureRoot() });
  const png = [...result.files.entries()].find(([name]) => name.endsWith(".png"))[1];
  assert.ok(pngSize(png).width > 0);
});

test("unknown options are refused", () => {
  assert.equal(run(["--nope"]).status, 2);
});
