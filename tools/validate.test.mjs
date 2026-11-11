import assert from "node:assert/strict";
import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { editPack, fixtureRoot } from "./fixtures/fixture.mjs";
import { checkBank, loadBank } from "./validate.mjs";

const check = (root, options = {}) => checkBank(loadBank(root), { root, ...options });
const hasError = (result, text) => assert.ok(result.errors.some((error) => error.includes(text)), `no error with “${text}” in:\n${result.errors.join("\n")}`);

test("the fixture bank has no errors, and warns about concepts short of verified items", () => {
  const root = fixtureRoot();
  const result = check(root);
  assert.deepEqual(result.errors, []);
  assert.equal(result.warnings.length, 3);
  assert.ok(result.warnings.every((warning) => warning.includes("verified item")));
});

test("--require-verified turns short concepts into errors", () => {
  const root = fixtureRoot();
  const result = check(root, { requireVerified: true });
  assert.equal(result.errors.length, 3);
});

test("loadBank limits itself to one pack's folder", () => {
  const root = fixtureRoot();
  const bank = loadBank(root, join(root, "subjects", "testing", "drafts"));
  assert.deepEqual(bank.packs.map((pack) => pack.data.id), ["testing.drafts"]);
  assert.equal(bank.subjects.length, 1);
});

test("a pack under any licence but CC0 is an error", () => {
  const root = fixtureRoot();
  editPack(root, (data) => { data.license = "CC-BY-4.0"; });
  hasError(check(root), "license");
});

test("a pack whose right choice is too often the longest gets a warning, and fails with strictCues", () => {
  const root = fixtureRoot();
  editPack(root, (data) => {
    const concept = data.concepts[0].id;
    for (let n = 0; n < 12; n++) {
      data.items.push({ id: `${data.id}.cue-${n}`, concept, kind: "choice", difficulty: 1, prompt: `Question ${n}?`, choices: ["No", "The long and careful right answer", "Never"], answer: 1, explanation: "Because.", verification: { status: "draft" } });
    }
  });
  const result = check(root);
  assert.deepEqual(result.errors, []);
  assert.ok(result.warnings.some((warning) => warning.includes("is the longest in")), result.warnings.join("\n"));
  hasError(check(root, { strictCues: true }), "is the longest in");

  const padded = fixtureRoot();
  editPack(padded, (data) => {
    const concept = data.concepts[0].id;
    for (let n = 0; n < 12; n++) {
      data.items.push({ id: `${data.id}.cue-${n}`, concept, kind: "choice", difficulty: 1, prompt: `Question ${n}?`, choices: ["A wrong choice, padded with a reason", "Right", "Another wrong one, padded as well"], answer: 1, explanation: "Because.", verification: { status: "draft" } });
    }
  });
  assert.ok(check(padded).warnings.some((warning) => warning.includes("is the shortest in")));
});

test("an explanation that names a choice by its place is an error, since apps shuffle choices", () => {
  const root = fixtureRoot();
  editPack(root, (data) => { data.items.find((item) => item.kind === "choice").explanation = "The first choice mixes up the two parts."; });
  hasError(check(root), "names a choice by its place (“first choice”)");

  const maybe = fixtureRoot();
  editPack(maybe, (data) => { data.items.find((item) => item.kind === "choice").explanation = "The third is wrong because it has no nucleus."; });
  const result = check(maybe);
  assert.deepEqual(result.errors, []);
  assert.ok(result.warnings.some((warning) => warning.includes("seems to name a choice by its place")));
  hasError(check(maybe, { strictCues: true }), "seems to name a choice by its place");

  const value = fixtureRoot();
  editPack(value, (data) => { data.items.find((item) => item.kind === "choice").explanation = "The answer 4 forgets the first step, and the choice a fails."; });
  assert.deepEqual(check(value).errors, []);
});

test("textOnly and kinds refuse pictures and other kinds of item", () => {
  const root = fixtureRoot();
  const text = check(root, { textOnly: true });
  hasError(text, "this pack is text only");
  hasError(text, "uses a picture");
  const kinds = check(root, { kinds: ["choice", "order"] });
  hasError(kinds, "this pack takes only choice and order items");
  assert.deepEqual(check(root, { kinds: ["choice", "recall", "order", "label"] }).errors, []);
});

test("a prerequisite cycle is an error", () => {
  const root = fixtureRoot();
  editPack(root, (data) => { data.concepts[0].requires = ["organelle"]; });
  hasError(check(root), "prerequisites cycle");
});

test("a prerequisite the bank doesn't have is an error", () => {
  const root = fixtureRoot();
  editPack(root, (data) => { data.concepts[1].requires = ["chemistry/atom"]; });
  hasError(check(root), "requires “chemistry/atom”, which isn't in the bank");
});

test("overlapping hotspots are an error", () => {
  const root = fixtureRoot();
  editPack(root, (data) => { data.artifacts[0].hotspots[1] = { ...data.artifacts[0].hotspots[1], x: 0.52, y: 0.52 }; });
  hasError(check(root), "overlap");
});

test("an SVG with a script is an error", () => {
  const root = fixtureRoot();
  writeFileSync(join(root, "subjects", "testing", "cells", "assets", "cell.svg"), '<svg viewBox="0 0 1200 900"><script>alert(1)</script></svg>');
  hasError(check(root), "holds something an SVG here may not");
});

test("a missing asset is an error, or a warning with --allow-missing-assets", () => {
  const root = fixtureRoot();
  rmSync(join(root, "subjects", "testing", "cells", "assets", "cell.glb"));
  hasError(check(root), "cell.glb is missing");
  const relaxed = check(root, { allowMissingAssets: true });
  assert.deepEqual(relaxed.errors, []);
  assert.ok(relaxed.warnings.some((warning) => warning.includes("cell.glb is missing")));
});

test("an item named outside its pack, or a label aimed at no hotspot, is an error", () => {
  const root = fixtureRoot();
  editPack(root, (data) => {
    data.items[0].id = "testing.other.membrane-role";
    data.items[3].target = "ribosome";
  });
  const result = check(root);
  hasError(result, "should be named “testing.cells.<name>”");
  hasError(result, "targets “ribosome”");
});

test("schema errors are reported with where they are", () => {
  const root = fixtureRoot();
  editPack(root, (data) => { data.items[0].choices.push("All of the above"); data.items[1].difficulty = 4; });
  const result = check(root);
  hasError(result, "/items/1/difficulty");
});

test("a pack.json that isn't JSON is a problem, not a crash", () => {
  const root = fixtureRoot();
  writeFileSync(join(root, "subjects", "testing", "drafts", "pack.json"), "{ not json");
  hasError(check(root), "subjects/testing/drafts/pack.json");
});

test("a verified item claiming more agreements than solvers is an error", () => {
  const root = fixtureRoot();
  editPack(root, (data) => { data.items[0].verification.agreed = 3; });
  hasError(check(root), "says more solvers agreed than answered");
});
