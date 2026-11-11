import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { blindId, blindKey } from "./blind.mjs";
import { cellsFile, editPack, fixtureRoot, readPack, toolsDir } from "./fixtures/fixture.mjs";
import { grade, readAnswers, reviewFile } from "./grade.mjs";

const DATE = "2026-11-09";

/** Writes one answers file per solver and returns their paths. */
function answerFiles(solvers) {
  const dir = mkdtempSync(join(tmpdir(), "bank-answers-"));
  return Object.entries(solvers).map(([solver, answers]) => {
    const file = join(dir, `${solver}.json`);
    writeFileSync(file, JSON.stringify({ solver, answers }));
    return file;
  });
}

/** The answers a solver who agrees with every key gives, for the cells pack's draft items. */
function rightAnswers(root) {
  const pack = readPack(root);
  const answers = {};
  for (const item of pack.items.filter((entry) => entry.verification.status === "draft")) {
    answers[item.id] = { answer: item.kind === "recall" ? item.answer : blindKey(item, pack) };
  }
  return answers;
}

const verificationOf = (root, id) => readPack(root).items.find((item) => item.id === id).verification;
const withoutVerification = (data) => ({ ...data, items: data.items.map(({ verification, ...rest }) => rest) });

test("an item every solver agreed with becomes verified, with solvers, agreed, method and date", () => {
  const root = fixtureRoot();
  const right = rightAnswers(root);
  grade(readAnswers(answerFiles({ a: right, b: right })), { root, date: DATE });
  for (const id of ["testing.cells.draft-choice", "testing.cells.draft-order", "testing.cells.draft-label"]) {
    assert.deepEqual(verificationOf(root, id), { status: "verified", method: "blind-solve", solvers: 2, agreed: 2, at: DATE }, id);
  }
});

test("an item any solver disagreed with stays draft, with a note saying what each answered", () => {
  const root = fixtureRoot();
  const right = rightAnswers(root);
  const wrong = { ...right, "testing.cells.draft-choice": { answer: 0, note: "The nucleus controls the cell." }, "testing.cells.draft-label": { answer: null, note: "Can't tell the parts apart." } };
  const result = grade(readAnswers(answerFiles({ a: right, b: wrong })), { root, date: DATE });
  const choice = verificationOf(root, "testing.cells.draft-choice");
  assert.equal(choice.status, "draft");
  assert.equal(choice.agreed, 1);
  assert.match(choice.note, /Key: choice 2 “Mitochondrion”\./);
  assert.match(choice.note, /a: choice 2 “Mitochondrion” \(agrees\)\./);
  assert.match(choice.note, /b: choice 0 “Nucleus”\./);
  assert.match(choice.note, /b's note: The nucleus controls the cell\./);
  const label = verificationOf(root, "testing.cells.draft-label");
  assert.match(label.note, /b: no answer\./);
  assert.equal(verificationOf(root, "testing.cells.draft-order").status, "verified");
  assert.deepEqual(result.rows[0], { pack: "testing.cells", answered: 4, verified: 1, draft: 2, review: 1, tooFew: 0, rejected: 0 });
});

test("answers keyed by the blind file's IDs are graded the same", () => {
  const root = fixtureRoot();
  const blind = Object.fromEntries(Object.entries(rightAnswers(root)).map(([id, answer]) => [blindId(id), answer]));
  const result = grade(readAnswers(answerFiles({ a: blind, b: blind })), { root, date: DATE });
  assert.deepEqual(result.unknown, []);
  assert.equal(verificationOf(root, "testing.cells.draft-label").status, "verified");
});

test("an order answer is reported in the pack's own step numbers", () => {
  const root = fixtureRoot();
  const right = rightAnswers(root);
  const key = right["testing.cells.draft-order"].answer;
  const swapped = [key[1], key[0], ...key.slice(2)];
  grade(readAnswers(answerFiles({ a: right, b: { ...right, "testing.cells.draft-order": { answer: swapped } } })), { root, date: DATE });
  assert.match(verificationOf(root, "testing.cells.draft-order").note, /b: steps 2, 1, 3, 4, 5\./);
});

test("recall items go to review, and the verdicts settle them", () => {
  const root = fixtureRoot();
  const right = rightAnswers(root);
  const files = answerFiles({ a: right, b: { ...right, "testing.cells.draft-recall": { answer: "The Golgi body" } } });
  const first = grade(readAnswers(files), { root, date: DATE });
  assert.deepEqual(first.review.map((entry) => entry.id), ["testing.cells.draft-recall"]);
  assert.equal(verificationOf(root, "testing.cells.draft-recall").status, "draft");
  assert.ok(!("method" in verificationOf(root, "testing.cells.draft-recall")));

  const form = reviewFile(first.review);
  assert.deepEqual(form.verdicts["testing.cells.draft-recall"], { agrees: { a: null, b: null }, note: "" });

  const halfJudged = { "testing.cells.draft-recall": { agrees: { a: true }, note: "" } };
  assert.equal(grade(readAnswers(files), { root, date: DATE, verdicts: halfJudged }).review.length, 1);

  const agreed = { "testing.cells.draft-recall": { agrees: { a: true, b: true }, note: "Golgi body is another name for it." } };
  grade(readAnswers(files), { root, date: DATE, verdicts: agreed });
  assert.deepEqual(verificationOf(root, "testing.cells.draft-recall"), { status: "verified", method: "blind-solve", solvers: 2, agreed: 2, at: DATE, note: "Golgi body is another name for it." });

  const differed = { "testing.cells.draft-recall": { agrees: { a: true, b: false }, note: "b named a different organelle." } };
  grade(readAnswers(files), { root, date: DATE, verdicts: differed });
  const verification = verificationOf(root, "testing.cells.draft-recall");
  assert.equal(verification.status, "draft");
  assert.match(verification.note, /b differed: “The Golgi body”/);
});

test("rejected items and items with too few solvers are left as they are", () => {
  const root = fixtureRoot();
  const right = rightAnswers(root);
  right["testing.cells.old-question"] = { answer: 1 };
  const result = grade(readAnswers(answerFiles({ a: right })), { root, date: DATE });
  assert.equal(result.rows[0].tooFew, 4);
  assert.equal(result.rows[0].rejected, 1);
  assert.equal(result.changed.length, 0);
  assert.deepEqual(verificationOf(root, "testing.cells.old-question"), { status: "rejected", note: "Too easy to guess from the wording." });
  grade(readAnswers(answerFiles({ a: right })), { root, date: DATE, minSolvers: 1 });
  assert.equal(verificationOf(root, "testing.cells.draft-choice").status, "verified");
});

test("only verification changes, and the file is written with two-space indentation and a final newline", () => {
  const root = fixtureRoot();
  const before = JSON.parse(readFileSync(cellsFile(root), "utf8"));
  const right = rightAnswers(root);
  grade(readAnswers(answerFiles({ a: right, b: right })), { root, date: DATE });
  const text = readFileSync(cellsFile(root), "utf8");
  assert.equal(text, JSON.stringify(JSON.parse(text), null, 2) + "\n");
  assert.deepEqual(withoutVerification(JSON.parse(text)), withoutVerification(before));
});

test("grading again with the same answers changes nothing", () => {
  const root = fixtureRoot();
  const right = rightAnswers(root);
  const files = answerFiles({ a: right, b: right });
  grade(readAnswers(files), { root, date: DATE });
  const text = readFileSync(cellsFile(root), "utf8");
  const second = grade(readAnswers(files), { root, date: DATE });
  assert.deepEqual(second.changed, []);
  assert.equal(readFileSync(cellsFile(root), "utf8"), text);
});

test("a pack nobody answered isn't touched, and unknown items are named", () => {
  const root = fixtureRoot();
  const drafts = join(root, "subjects", "testing", "drafts", "pack.json");
  const before = statSync(drafts).mtimeMs;
  const right = { ...rightAnswers(root), "testing.cells.no-such-item": { answer: 1 } };
  const result = grade(readAnswers(answerFiles({ a: right, b: right })), { root, date: DATE });
  assert.equal(statSync(drafts).mtimeMs, before);
  assert.deepEqual(result.unknown, ["testing.cells.no-such-item"]);
});

test("one solver in two files is refused", () => {
  const files = answerFiles({ a: {}, b: {} });
  writeFileSync(files[1], JSON.stringify({ solver: "a", answers: {} }));
  assert.throws(() => readAnswers(files), /in two answers files/);
});

test("the command line prints a table, writes the review file, and settles recall with --recall-verdicts", () => {
  const root = fixtureRoot();
  editPack(root, () => {});
  const right = rightAnswers(root);
  const files = answerFiles({ a: right, b: right });
  const tool = join(toolsDir, "grade.mjs");
  const first = spawnSync(process.execPath, [tool, "--root", root, "--answers", ...files, "--date", DATE], { encoding: "utf8" });
  assert.equal(first.status, 0, first.stderr);
  assert.match(first.stdout, /pack\s+answered\s+verified\s+draft\s+recall to judge/);
  assert.match(first.stdout, /testing\.cells\s+4\s+3\s+0\s+1\s+0\s+0/);
  const review = files[0].replace(/\.json$/, ".recall-review.json");
  const form = JSON.parse(readFileSync(review, "utf8"));
  form.verdicts["testing.cells.draft-recall"] = { agrees: { a: true, b: true }, note: "Both named the Golgi apparatus." };
  writeFileSync(review, JSON.stringify(form));
  const second = spawnSync(process.execPath, [tool, "--root", root, "--answers", ...files, "--date", DATE, "--recall-verdicts", review], { encoding: "utf8" });
  assert.equal(second.status, 0, second.stderr);
  assert.match(second.stdout, /testing\.cells\s+4\s+4\s+0\s+0/);
  assert.equal(verificationOf(root, "testing.cells.draft-recall").status, "verified");
  const usage = spawnSync(process.execPath, [tool, "--date", "today"], { encoding: "utf8" });
  assert.equal(usage.status, 2);
});
