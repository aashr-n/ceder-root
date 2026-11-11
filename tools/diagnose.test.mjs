import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { buildBank } from "./build.mjs";
import { applyDiagnosis, diagnosisFor, entryId } from "./diagnose.mjs";
import { editPack, fixtureRoot, readPack, toolsDir } from "./fixtures/fixture.mjs";
import { checkBank, loadBank } from "./validate.mjs";

const check = (root, options = {}) => checkBank(loadBank(root), { root, ...options });
const hasError = (result, text) => assert.ok(result.errors.some((error) => error.includes(text)), `no error with “${text}” in:\n${result.errors.join("\n")}`);

/** Gives the fixture's first concept two misconceptions, and tags the wrong choices of its first verified choice item. */
function withMistakes(root) {
  let id;
  editPack(root, (data) => {
    data.concepts[0].misconceptions = [
      { id: "bigger-is-older", claim: "A bigger cell is an older cell.", correction: "Size depends on the kind of cell, not its age." },
      { id: "all-cells-alike", claim: "Every cell has the same parts.", correction: "Cells differ in which parts they have." },
    ];
    const item = data.items.find((one) => one.kind === "choice" && one.verification.status === "verified");
    item.mistakes = item.choices.map((_, index) => index === item.answer ? null : "bigger-is-older");
    id = item.id;
  });
  return id;
}

test("mistakes must match the choices, leave the right one alone, and name misconceptions the pack has", () => {
  const root = fixtureRoot();
  const id = withMistakes(root);
  assert.deepEqual(check(root).errors, []);

  editPack(root, (data) => { data.items.find((item) => item.id === id).mistakes.pop(); });
  hasError(check(root), "it needs one for each");

  const named = fixtureRoot();
  const second = withMistakes(named);
  editPack(named, (data) => { const item = data.items.find((one) => one.id === second); item.mistakes[item.answer] = "all-cells-alike"; });
  hasError(check(named), "names a mistake for its right choice");

  const unknown = fixtureRoot();
  const third = withMistakes(unknown);
  editPack(unknown, (data) => { const item = data.items.find((one) => one.id === third); item.mistakes[item.mistakes.findIndex((entry) => entry !== null)] = "no-such-idea"; });
  hasError(check(unknown), "which no concept in the pack lists as a misconception");
});

test("--fidelity asks for misconceptions on every concept, each given away in two items, and few plain facts", () => {
  const root = fixtureRoot();
  withMistakes(root);
  const result = check(root, { fidelity: true });
  hasError(result, "name at least 2 wrong ideas");
  hasError(result, "it takes 2 to tell it from a slip");
});

test("a diagnoser sees every wrong choice of a tagged, verified item, and never the tags", () => {
  const root = fixtureRoot();
  const id = withMistakes(root);
  const pack = readPack(root);
  const item = pack.items.find((one) => one.id === id);
  const diagnosis = diagnosisFor(pack);
  assert.equal(diagnosis.entries.length, item.choices.length - 1);
  assert.deepEqual(diagnosis.misconceptions.map((entry) => entry.id).sort(), ["all-cells-alike", "bigger-is-older"]);
  assert.ok(diagnosis.entries.every((entry) => entry.right === item.choices[item.answer] && entry.picked !== entry.right));
  assert.ok(!JSON.stringify(diagnosis.entries).includes("bigger-is-older"));
});

test("a tag stays only where the diagnoser names the same mistake, and the build publishes only checked tags", () => {
  const root = fixtureRoot();
  const id = withMistakes(root);
  const unchecked = JSON.parse(buildBank({ root }).files.get("bankpack-testing.cells.json"));
  assert.ok(unchecked.items.every((item) => !("mistakes" in item)));
  assert.equal(unchecked.concepts[0].misconceptions.length, 2);

  const pack = readPack(root);
  const item = pack.items.find((one) => one.id === id);
  const wrong = item.choices.map((_, index) => index).filter((index) => index !== item.answer);
  const answers = Object.fromEntries(wrong.map((index, place) => [entryId(item, index), place === 0 ? "bigger-is-older" : null]));
  assert.deepEqual(applyDiagnosis(pack, answers), { items: 1, confirmed: 1, dropped: wrong.length - 1, unanswered: 0 });
  assert.deepEqual(item.mistakes.filter((entry) => entry !== null), ["bigger-is-older"]);
  assert.equal(item.verification.diagnosed, 1);

  const partial = readPack(root);
  const again = partial.items.find((one) => one.id === id);
  assert.deepEqual(applyDiagnosis(partial, { [entryId(again, wrong[0])]: "bigger-is-older" }), { items: 0, confirmed: 0, dropped: 0, unanswered: wrong.length > 1 ? 1 : 0 });
});

test("the command line exports wrong choices and grades a diagnoser's answers into the pack", () => {
  const root = fixtureRoot();
  const id = withMistakes(root);
  const out = join(mkdtempSync(join(tmpdir(), "bank-diagnose-")), "cells.json");
  const run = (args) => spawnSync(process.execPath, [join(toolsDir, "diagnose.mjs"), ...args, "--root", root], { encoding: "utf8" });
  const exported = run(["export", "subjects/testing/cells", "--out", out]);
  assert.equal(exported.status, 0, exported.stdout + exported.stderr);
  const file = JSON.parse(readFileSync(out, "utf8"));
  assert.equal(file.packs.length, 1);
  const answersFile = out.replace(".json", ".answers.json");
  writeFileSync(answersFile, JSON.stringify({ solver: "d", answers: Object.fromEntries(file.packs[0].entries.map((entry) => [entry.id, "bigger-is-older"])) }));
  const graded = run(["grade", "--answers", answersFile]);
  assert.equal(graded.status, 0, graded.stdout + graded.stderr);
  assert.match(graded.stdout, /testing\.cells: 1 items diagnosed, \d+ tags confirmed, 0 dropped/);
  const item = readPack(root).items.find((one) => one.id === id);
  assert.equal(item.verification.diagnosed, 1);
  const built = JSON.parse(buildBank({ root }).files.get("bankpack-testing.cells.json"));
  assert.deepEqual(built.items.find((one) => one.id === id).mistakes, item.mistakes);
});
