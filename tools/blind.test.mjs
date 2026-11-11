import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { blindId, blindKey, exportBlind, permutation } from "./blind.mjs";
import { pngSize } from "./build.mjs";
import { fixtureRoot, readPack, toolsDir } from "./fixtures/fixture.mjs";

const outFile = () => join(mkdtempSync(join(tmpdir(), "bank-blind-")), "blind", "questions.json");
const exported = (root, paths, options = {}) => {
  const out = outFile();
  const result = exportBlind(paths, out, { root, ...options });
  return { out, result, data: JSON.parse(readFileSync(out, "utf8")) };
};

test("exports only draft items, and with --all verified ones too, never rejected", () => {
  const root = fixtureRoot();
  const drafts = exported(root, [join(root, "subjects", "testing")]).data.items.map((item) => item.id);
  assert.deepEqual(drafts, ["testing.cells.draft-choice", "testing.cells.draft-recall", "testing.cells.draft-order", "testing.cells.draft-label", "testing.drafts.tissue-made-of"].map(blindId));
  const all = exported(root, [join(root, "subjects", "testing")], { all: true }).data.items.map((item) => item.id);
  assert.equal(all.length, 9);
  assert.ok(!all.includes(blindId("testing.cells.old-question")));
});

test("takes pack folders relative to the bank's root, and several at once without repeats", () => {
  const root = fixtureRoot();
  const { data } = exported(root, ["subjects/testing/drafts", "subjects/testing/drafts", "subjects/testing/cells"]);
  assert.equal(data.items.length, 5);
  assert.equal(data.items[0].id, blindId("testing.drafts.tissue-made-of"));
});

test("an item carries nothing that gives the answer away", () => {
  const root = fixtureRoot();
  const { data } = exported(root, ["subjects/testing"], { all: true });
  const allowed = { choice: ["id", "kind", "subject", "prompt", "choices"], recall: ["id", "kind", "subject", "prompt"], order: ["id", "kind", "subject", "prompt", "steps"], label: ["id", "kind", "subject", "prompt", "image", "spots"] };
  for (const item of data.items) {
    assert.match(item.id, /^q-[0-9a-f]{12}$/);
    assert.deepEqual(Object.keys(item), allowed[item.kind], item.id);
    for (const spot of item.spots ?? []) assert.deepEqual(Object.keys(spot), ["letter", "x", "y"]);
  }
  const text = JSON.stringify(data);
  for (const secret of ["testing.cells", "verification", "explanation", "sources", "The cell's DNA", "\"The Golgi apparatus\"", "Similar cells working together", "mitochondrion", "find-nucleus"]) assert.ok(!text.includes(secret), secret);
});

test("an order item's steps are shuffled the same way every time, and the key solves them", () => {
  const root = fixtureRoot();
  const pack = readPack(root);
  const source = pack.items.find((item) => item.id === "testing.cells.draft-order");
  const first = exported(root, ["subjects/testing/cells"]).data.items.find((item) => item.id === blindId(source.id));
  const second = exported(root, ["subjects/testing/cells"]).data.items.find((item) => item.id === blindId(source.id));
  assert.deepEqual(first.steps, second.steps);
  assert.notDeepEqual(first.steps, source.steps);
  assert.deepEqual([...first.steps].sort(), [...source.steps].sort());
  const key = blindKey(source, pack);
  assert.deepEqual(key.map((index) => first.steps[index]), source.steps);
});

test("a label item's picture is rendered beside the file with lettered spots, and the key names the target's letter", () => {
  const root = fixtureRoot();
  const pack = readPack(root);
  const source = pack.items.find((item) => item.id === "testing.cells.draft-label");
  const { out, data } = exported(root, ["subjects/testing/cells"]);
  const item = data.items.find((entry) => entry.id === blindId(source.id));
  assert.equal(item.image, join(out, "..", `questions.${blindId(source.id)}.png`));
  assert.ok(existsSync(item.image));
  assert.deepEqual(pngSize(readFileSync(item.image)), { width: 1200, height: 900 });
  assert.deepEqual(item.spots.map((spot) => spot.letter), ["A", "B", "C", "D"]);
  const target = pack.artifacts[0].hotspots.find((spot) => spot.id === "mitochondrion");
  const spot = item.spots.find((entry) => entry.letter === blindKey(source, pack));
  assert.deepEqual([spot.x, spot.y], [target.x, target.y]);
});

test("a shuffle of two or more is never the original order", () => {
  for (let count = 2; count <= 12; count++) {
    for (let n = 0; n < 200; n++) {
      const order = permutation(`testing.cells.item-${n}`, count, "steps");
      assert.deepEqual([...order].sort((a, b) => a - b), [...Array(count).keys()]);
      assert.ok(order.some((value, index) => value !== index), `${count} ${n}`);
    }
  }
});

test("the command line needs --out and a folder", () => {
  const usage = spawnSync(process.execPath, [join(toolsDir, "blind.mjs"), "subjects/testing"], { encoding: "utf8" });
  assert.equal(usage.status, 2);
  const root = fixtureRoot();
  const out = outFile();
  const run = spawnSync(process.execPath, [join(toolsDir, "blind.mjs"), "--root", root, "subjects/testing/cells", "--out", out], { encoding: "utf8" });
  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout, /testing\.cells: 4 of 9 items/);
  const missing = spawnSync(process.execPath, [join(toolsDir, "blind.mjs"), "--root", root, "subjects/nothing", "--out", out], { encoding: "utf8" });
  assert.equal(missing.status, 1);
});
