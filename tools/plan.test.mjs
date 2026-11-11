import assert from "node:assert/strict";
import test from "node:test";
import { fixtureRoot } from "./fixtures/fixture.mjs";
import { checkPlan, nextPacks, overview } from "./plan.mjs";
import { loadBank } from "./validate.mjs";

/** A plan that lists the fixture bank's packs as they are, then one new pack. */
function fixturePlan(root) {
  const bank = loadBank(root);
  const packs = bank.packs.map((pack) => ({
    pack: pack.data.id.split(".")[1],
    title: pack.data.title,
    brief: pack.data.summary,
    concepts: pack.data.concepts.map((concept) => ({ id: concept.id, name: concept.name })),
  }));
  const known = packs[0].concepts[0].id;
  packs.push({
    pack: "tissues",
    title: "Tissues",
    brief: "How similar cells work together.",
    concepts: ["epithelium", "connective-tissue", "muscle-tissue", "nervous-tissue"].map((id) => ({ id, name: id.replace(/-/g, " ") })),
    buildsOn: [known],
  });
  return { bank, plan: { formatVersion: 1, subject: "testing", covers: "A test subject.", packs } };
}

const check = (root, plan, bank, plans) => checkPlan(plan, bank, { root, plans });
const hasError = (result, text) => assert.ok(result.errors.some((error) => error.includes(text)), `no error with “${text}” in:\n${result.errors.join("\n")}`);

test("a plan that matches the bank and adds a pack has no errors, and that pack is next", () => {
  const root = fixtureRoot();
  const { bank, plan } = fixturePlan(root);
  assert.deepEqual(check(root, plan, bank), { errors: [], warnings: [] });
  assert.deepEqual(nextPacks(plan, bank).map((pack) => pack.pack), ["tissues"]);
  assert.deepEqual(nextPacks(plan, bank, 5).map((pack) => pack.pack), ["tissues"]);
});

test("a plan that breaks its schema says where", () => {
  const root = fixtureRoot();
  const { bank, plan } = fixturePlan(root);
  plan.packs.at(-1).pack = "Not A Slug";
  hasError(check(root, plan, bank), "/packs/");
});

test("a concept planned in two packs is an error", () => {
  const root = fixtureRoot();
  const { bank, plan } = fixturePlan(root);
  plan.packs.at(-1).concepts[0].id = plan.packs[0].concepts[0].id;
  plan.packs.at(-1).buildsOn = [];
  hasError(check(root, plan, bank), "unique in its subject");
});

test("a plan must list a written pack's concepts as they are, and leave no written pack out", () => {
  const root = fixtureRoot();
  const changed = fixturePlan(root);
  changed.plan.packs[0].concepts[0].id = "renamed";
  changed.plan.packs.at(-1).buildsOn = [];
  hasError(check(root, changed.plan, changed.bank), "already written");

  const short = fixturePlan(root);
  short.plan.packs.at(-1).buildsOn = [];
  short.plan.packs.shift();
  hasError(check(root, short.plan, short.bank), "leaves it out");
});

test("a new pack needs 4 concepts, and may only build on what exists or is planned earlier", () => {
  const root = fixtureRoot();
  const few = fixturePlan(root);
  few.plan.packs.at(-1).concepts.length = 3;
  hasError(check(root, few.plan, few.bank), "a pack has 4 to 12");

  const unknown = fixturePlan(root);
  unknown.plan.packs.at(-1).buildsOn = ["nowhere"];
  hasError(check(root, unknown.plan, unknown.bank), "no earlier pack");

  const other = fixturePlan(root);
  other.plan.packs.at(-1).buildsOn = ["chemistry/atom"];
  const missing = check(root, other.plan, other.bank);
  assert.deepEqual(missing.errors, []);
  assert.equal(missing.warnings.length, 1);
  const planned = { chemistry: { packs: [{ concepts: [{ id: "atom" }] }] } };
  assert.deepEqual(check(root, other.plan, other.bank, planned).warnings, []);
});

test("a plan for a subject the bank doesn't have is an error", () => {
  const root = fixtureRoot();
  const { bank, plan } = fixturePlan(root);
  plan.subject = "elsewhere";
  hasError(check(root, plan, bank), "has no subjects/elsewhere/subject.json");
});

test("overview lists each subject's packs in order and marks the written ones", () => {
  const root = fixtureRoot();
  const { bank, plan } = fixturePlan(root);
  const page = overview([plan], bank);
  assert.match(page, /^## Testing$/m);
  assert.match(page, /^\d+\. \*\*Tissues\*\*: epithelium, connective tissue, muscle tissue, nervous tissue$/m);
  assert.equal(page.split("\n").filter((line) => line.includes(" ✓: ")).length, plan.packs.length - 1);
});
