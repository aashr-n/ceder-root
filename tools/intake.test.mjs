import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fixtureRoot, toolsDir } from "./fixtures/fixture.mjs";
import { draftProblems, lineProblems, matches, nameProblem, place, readExport, stage } from "./intake.mjs";
import { checkBank, loadBank } from "./validate.mjs";

const fixture = JSON.parse(readFileSync(join(toolsDir, "fixtures", "intake-draft.json"), "utf8"));
const ID = "0b8f3c3e-6a1d-4c55-9a51-2f4e2d1c9b70";
const OTHER = "6c1e2a77-3f0b-4b8e-8d0e-4a1b2c3d4e5f";

const header = (requests, drafts) => ({ kind: "header", format: 1, exportedAt: "2026-11-14T12:00:00.000Z", requests, drafts });
const request = (topic = "Telomeres and telomerase", students = 2) => ({ kind: "request", subject: "Molecular biology", topic, students, firstDay: "2026-11-13" });
const draft = (change = () => {}, id = ID) => {
  const line = {
    kind: "draft", id, subject: "Molecular biology", topic: "Telomeres and telomerase", level: "intro", route: "ceder-ai",
    author: "vertex/gemini-4-hydrogen", checker: "anthropic/claude-sonnet-5", createdOn: "2026-11-14",
    checks: { verdicts: structuredClone(fixture.verdicts), sameModel: false }, pack: structuredClone(fixture.pack),
  };
  change(line);
  return line;
};
const file = (lines) => lines.map((line) => JSON.stringify(line)).join("\n") + "\n";
const problems = (line, root = fixtureRoot()) => lineProblems(line, loadBank(root), root);
const hasProblem = (list, text) => assert.ok(list.some((problem) => problem.includes(text)), `no problem with “${text}” in:\n${list.join("\n")}`);

/** A plan for the fixture's subject, with one planned pack the draft fits. */
function withPlan(root) {
  mkdirSync(join(root, "plan"), { recursive: true });
  writeFileSync(join(root, "plan", "testing.json"), JSON.stringify({
    formatVersion: 1, subject: "testing", covers: "Fixture.",
    packs: [{ pack: "chromosome-ends", title: "Chromosome ends", brief: "Telomeres and the enzyme that extends them.", concepts: [{ id: "telomere", name: "Telomere" }, { id: "telomerase", name: "Telomerase" }, { id: "senescence", name: "Senescence" }, { id: "t-loop", name: "T-loop" }], buildsOn: [] }],
  }));
  return root;
}

test("the app's draft passes ceder-root's own text-only checks as it is", () => {
  const root = fixtureRoot();
  assert.deepEqual(draftProblems(fixture.pack, loadBank(root), root), []);
  assert.deepEqual(problems(draft()), []);
  assert.deepEqual(problems(request()), []);
  assert.deepEqual(problems(header(1, 1)), []);
});

test("a line with a key it shouldn't have, or without one, fails", () => {
  hasProblem(problems({ ...request(), userId: "x" }), "exactly");
  hasProblem(problems(draft((line) => { line.email = "a@b.org"; })), "exactly");
  hasProblem(problems(draft((line) => { delete line.checker; })), "exactly");
  hasProblem(problems({ ...header(0, 0), by: "someone" }), "exactly");
  hasProblem(problems({ kind: "student" }), "isn't a header");
});

test("names follow the queue's rules: no web or email addresses, file names or parts of a course", () => {
  for (const good of ["Acid/base balance", "Telomeres and telomerase", "Photosynthèse", "pH scale"]) assert.equal(nameProblem(good), "", good);
  for (const bad of ["x", "www.example.org notes", "notes.pdf", "a@b", "BIO 101", "Week 3 review", "Dr Smith", "//share", "  spaced", "a".repeat(81), "1234"]) assert.notEqual(nameProblem(bad), "", bad);
  hasProblem(problems(request("Lecture 4 slides.pdf")), "its topic");
});

test("a draft with anything but exact draft verification fails, and nothing verified gets through", () => {
  hasProblem(problems(draft((line) => { line.pack.items[0].verification = { status: "verified", solvers: 2, agreed: 2, method: "blind", at: "2026-11-14" }; })), "status");
  hasProblem(problems(draft((line) => { line.pack.items[0].verification = { status: "draft", note: "fine" }; })), "exactly { \"status\": \"draft\" }");
});

test("a draft with a recall or label item, an artifact, or a web address fails", () => {
  hasProblem(problems(draft((line) => { Object.assign(line.pack.items[0], { kind: "recall", answer: "DNA" }); delete line.pack.items[0].choices; })), "is a recall item");
  hasProblem(problems(draft((line) => { line.pack.artifacts.push({ id: "x", kind: "diagram", file: "assets/x.svg", alt: "x" }); })), "");
  hasProblem(problems(draft((line) => { line.pack.items[0].kind = "label"; })), "");
  hasProblem(problems(draft((line) => { line.pack.items[1].explanation = "See https://example.org for the reason it shortens."; })), "web address");
  hasProblem(problems(draft((line) => { line.pack.items[1].explanation = "Ask someone@example.org why the lagging strand shortens."; })), "email address");
  hasProblem(problems(draft((line) => { line.pack.items[1].prompt = "Which is it? See the first choice."; })), "place");
});

test("every item in a draft must be one the second model agreed with", () => {
  hasProblem(problems(draft((line) => { line.checks.verdicts[line.pack.items[0].id] = "disagreed"; })), "didn't agree");
  hasProblem(problems(draft((line) => { line.checks.verdicts.extra = "maybe"; })), "verdict");
  hasProblem(problems(draft((line) => { line.checks.checker = "x/y"; })), "checks");
});

test("models, levels, routes, days and the queue's ID are checked", () => {
  hasProblem(problems(draft((line) => { line.author = "someone@example.org"; })), "wrote it");
  hasProblem(problems(draft((line) => { line.level = "phd"; })), "level");
  hasProblem(problems(draft((line) => { line.route = "teacher"; })), "route");
  hasProblem(problems(draft((line) => { line.id = "1"; })), "id");
  assert.deepEqual(problems(draft((line) => { line.checker = null; line.checks.sameModel = true; line.route = "own-key"; })), []);
});

test("readExport wants the header first and its counts right, and keeps the lines that pass", () => {
  const root = fixtureRoot();
  const bank = loadBank(root);
  const good = readExport(file([header(1, 1), request(), draft()]), bank, root);
  assert.deepEqual(good.failures, []);
  assert.equal(good.drafts.length, 1);
  assert.match(readExport(file([request(), header(1, 0)]), bank, root).failures.join("\n"), /before the header|not the first line/);
  assert.match(readExport(file([header(2, 1), request(), draft()]), bank, root).failures.join("\n"), /counts 2 requests/);
  const mixed = readExport(file([header(1, 2), request(), draft(), draft((line) => { line.level = "phd"; }, OTHER)]) + "not json\n", bank, root);
  assert.equal(mixed.drafts.length, 1);
  assert.match(mixed.failures.join("\n"), new RegExp(`${OTHER}\\): has the level`));
  assert.match(mixed.failures.join("\n"), /isn't JSON/);
});

test("staging writes the pack and its meta under the staging folder, and adds requests up once per export", () => {
  const root = withPlan(fixtureRoot());
  const bank = loadBank(root);
  const out = join(root, ".work", "intake");
  const read = readExport(file([header(1, 1), request(), draft()]), bank, root);
  stage(read, out, { bank, plans: { testing: JSON.parse(readFileSync(join(root, "plan", "testing.json"), "utf8")) }, root });
  stage(read, out, { bank, plans: {}, root });
  assert.deepEqual(JSON.parse(readFileSync(join(out, "drafts", ID, "pack.json"), "utf8")), fixture.pack);
  const meta = JSON.parse(readFileSync(join(out, "drafts", ID, "intake.json"), "utf8"));
  assert.equal(meta.route, "ceder-ai");
  assert.deepEqual(meta.clashes, []);
  const requests = JSON.parse(readFileSync(join(out, "requests.json"), "utf8"));
  assert.equal(requests.requests.length, 1);
  assert.equal(requests.requests[0].students, 2);
  assert.ok(!existsSync(join(root, "subjects", "molecular-biology")), "staging never writes into subjects/");
  const text = readFileSync(join(out, "requests.json"), "utf8") + readFileSync(join(out, "drafts", ID, "intake.json"), "utf8");
  assert.doesNotMatch(text, /user_?id|email/i);
});

test("matches points at planned packs that share the topic's words", () => {
  const root = withPlan(fixtureRoot());
  const found = matches("Molecular biology", "Telomeres and telomerase", loadBank(root), { testing: JSON.parse(readFileSync(join(root, "plan", "testing.json"), "utf8")) });
  assert.deepEqual(found[0], { subject: "testing", pack: "chromosome-ends", title: "Chromosome ends", written: false, planned: true });
});

/** Stages the fixture draft in `root` and returns the staging folder. */
function staged(root) {
  const bank = loadBank(root);
  const out = join(root, ".work", "intake");
  stage(readExport(file([header(0, 1), draft()]), bank, root), out, { bank, plans: {}, root });
  return out;
}

test("placing renames the draft to a planned pack and its concepts, and the bank still checks clean", () => {
  const root = withPlan(fixtureRoot());
  const out = staged(root);
  const { file: placedFile, notes } = place(ID, { out, root, as: "testing/chromosome-ends", concepts: { telomeres: "telomere" } });
  const pack = JSON.parse(readFileSync(placedFile, "utf8"));
  assert.equal(pack.id, "testing.chromosome-ends");
  assert.deepEqual(pack.concepts.map((concept) => concept.id), ["telomere", "telomerase"]);
  assert.ok(pack.items.every((item) => item.id.startsWith("testing.chromosome-ends.") && item.verification.status === "draft"));
  assert.match(notes.join("\n"), /senescence, t-loop/);
  assert.doesNotMatch(readFileSync(placedFile, "utf8"), new RegExp(`${ID}|2026-11-14|gemini|claude`));
  const result = checkBank(loadBank(root), { root, textOnly: false });
  assert.deepEqual(result.errors, []);
});

test("placing refuses a concept the plan doesn't list, a subject the bank lacks, and an existing folder", () => {
  const root = withPlan(fixtureRoot());
  const out = staged(root);
  assert.throws(() => place(ID, { out, root, as: "testing/chromosome-ends" }), /--concept telomeres=/);
  assert.throws(() => place(ID, { out, root }), /no subject molecular-biology/);
  assert.throws(() => place(ID, { out, root, as: "testing/cells" }), /already exists/);
  assert.throws(() => place(OTHER, { out, root, as: "testing/x" }), /No staged draft/);
  assert.ok(!existsSync(join(root, "subjects", "testing", "chromosome-ends")));
});

test("placing refuses a pack whose concepts clash with the bank's", () => {
  const root = fixtureRoot();
  const out = staged(root);
  assert.throws(() => place(ID, { out, root, as: "testing/telomeres", concepts: { telomeres: "cell" } }), /wouldn't pass/);
  assert.ok(!existsSync(join(root, "subjects", "testing", "telomeres")));
});

test("the command stages an export, exits 1 on a bad line, and places a draft", () => {
  const root = withPlan(fixtureRoot());
  const dir = mkdtempSync(join(tmpdir(), "bank-intake-"));
  const run = (args) => spawnSync(process.execPath, [join(toolsDir, "intake.mjs"), "--root", root, ...args], { encoding: "utf8" });
  writeFileSync(join(dir, "good.jsonl"), file([header(1, 1), request(), draft()]));
  const good = run([join(dir, "good.jsonl")]);
  assert.equal(good.status, 0, good.stdout + good.stderr);
  assert.match(good.stdout, /testing\/chromosome-ends/);
  writeFileSync(join(dir, "bad.jsonl"), file([header(0, 1), draft((line) => { line.pack.items[0].verification = { status: "verified" }; })]));
  assert.equal(run([join(dir, "bad.jsonl")]).status, 1);
  const placing = run(["--place", ID, "--as", "testing/chromosome-ends", "--concept", "telomeres=telomere"]);
  assert.equal(placing.status, 0, placing.stdout + placing.stderr);
  assert.ok(existsSync(join(root, "subjects", "testing", "chromosome-ends", "pack.json")));
});
