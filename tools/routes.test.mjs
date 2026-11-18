import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { buildAppCopy } from "./build.mjs";
import { fixtureRoot, realRoot, toolsDir } from "./fixtures/fixture.mjs";
import { KIND_ORDER, buildRoutes, coverage, coverageTable, routeOrder } from "./routes.mjs";

const run = (args) => spawnSync(process.execPath, [join(toolsDir, "routes.mjs"), ...args], { encoding: "utf8" });
const checked = { date: "2026-11-18", evidence: [{ url: "https://terms.example.org", quote: "The source's own terms." }] };
const entry = (id, change = {}) => ({ id, name: id, url: `https://${id}.example.org`, goodFor: "Tests.", license: "CC-BY-4.0", apps: "show", bank: "none", attribution: "Credit.", checked, notes: "Fixture.", ...change });

/**
 * The fixture bank with a second subject that has only a subject.json, a catalogue whose sources are tagged for one or
 * both, a plan for `testing`, and one library piece.
 */
function routesRoot() {
  const root = fixtureRoot();
  mkdirSync(join(root, "subjects", "empty"), { recursive: true });
  writeFileSync(join(root, "subjects", "empty", "subject.json"), JSON.stringify({ formatVersion: 1, id: "empty", name: "Empty", domain: "social", summary: "A subject with no plan or pack.", aliases: ["Nothing yet"] }));
  const entries = [
    entry("videos", { kinds: ["video"], subjects: ["testing"] }),
    entry("book", { kinds: ["textbook", "exercises"], subjects: ["testing", "empty"] }),
    entry("atlas", { kinds: ["reference"], subjects: ["testing"] }),
    entry("plain", { subjects: ["testing"] }),
    entry("another-book", { kinds: ["textbook"], subjects: ["testing"] }),
    entry("links", { apps: "link", license: "CC-BY-NC-4.0", attribution: undefined, kinds: ["lessons"], subjects: ["empty"] }),
    entry("general", { kinds: ["reference"] }),
    entry("banned", { apps: "none", license: "CC-BY-NC-4.0", attribution: undefined }),
  ];
  mkdirSync(join(root, "sources", "entries"), { recursive: true });
  for (const one of entries) writeFileSync(join(root, "sources", "entries", `${one.id}.json`), JSON.stringify(one));
  mkdirSync(join(root, "plan"), { recursive: true });
  const concepts = (ids) => ids.map((id) => ({ id, name: id }));
  writeFileSync(join(root, "plan", "testing.json"), JSON.stringify({
    formatVersion: 1, subject: "testing", covers: "A test subject.",
    packs: [
      { pack: "cells", title: "Cells", brief: "Cells.", concepts: concepts(["cell", "organelle"]) },
      { pack: "drafts", title: "Drafts", brief: "Drafts.", concepts: concepts(["tissue"]) },
      { pack: "organs", title: "Organs", brief: "Organs.", concepts: concepts(["heart", "lung", "liver", "kidney"]) },
    ],
  }));
  mkdirSync(join(root, "library", "items", "book"), { recursive: true });
  cpSync(join(realRoot, "library", "item.schema.json"), join(root, "library", "item.schema.json"));
  writeFileSync(join(root, "library", "items", "book", "cells.json"), JSON.stringify({ id: "book/cells", source: "book", kind: "link", title: "Cells", url: "https://book.example.org/cells", retrieved: "2026-11-18", concepts: ["testing/cell"] }));
  return root;
}

const index = (root) => JSON.parse(buildRoutes({ root }).files.get("routes-index.json"));

test("routes-index.json lists every subject, packs or none, sorted by id, in a fixed shape", () => {
  const root = routesRoot();
  const result = buildRoutes({ root });
  assert.deepEqual(result.errors, []);
  const built = index(root);
  assert.deepEqual(Object.keys(built), ["formatVersion", "revision", "subjects"]);
  assert.match(built.revision, /^[0-9a-f]{16}$/);
  assert.deepEqual(built.subjects.map((subject) => subject.id), ["empty", "testing"]);
  const [empty, testing] = built.subjects;
  assert.deepEqual(Object.keys(empty), ["id", "name", "domain", "summary", "aliases", "packs", "sources"]);
  assert.deepEqual(empty, { id: "empty", name: "Empty", domain: "social", summary: "A subject with no plan or pack.", aliases: ["Nothing yet"], packs: 0, sources: ["book", "links"] });
  // A subject with no aliases has an empty list, and only packs with a verified item count.
  assert.deepEqual(testing.aliases, []);
  assert.equal(testing.packs, 1);
});

test("a subject's sources go textbook first, by first kind, then by id, with untyped ones last and unusable ones out", () => {
  const testing = index(routesRoot()).subjects.find((subject) => subject.id === "testing");
  assert.deepEqual(testing.sources, ["another-book", "book", "atlas", "videos", "plain"]);
  assert.deepEqual(KIND_ORDER, ["textbook", "lessons", "reference", "documentation", "exercises", "texts", "data", "media", "simulation", "video"]);
  const sorted = [{ id: "b" }, { id: "a", kinds: ["video"] }, { id: "c", kinds: ["textbook"] }, { id: "a" }].sort(routeOrder);
  assert.deepEqual(sorted.map((one) => `${one.id}:${one.kinds?.[0] ?? "-"}`), ["c:textbook", "a:video", "a:-", "b:-"]);
});

test("pack-less subjects are in routes-index.json and stay out of bank-index.json", () => {
  const copy = buildAppCopy({ root: routesRoot() });
  assert.deepEqual(copy.errors, []);
  assert.deepEqual(JSON.parse(copy.files.get("bank-index.json")).subjects.map((subject) => subject.id), ["testing"]);
  assert.deepEqual(JSON.parse(copy.files.get("routes-index.json")).subjects.map((subject) => subject.id), ["empty", "testing"]);
});

test("the same source gives the same bytes, and a change in a subject or its sources changes the revision", () => {
  const root = routesRoot();
  const first = buildRoutes({ root }).files.get("routes-index.json");
  assert.ok(first.equals(buildRoutes({ root: routesRoot() }).files.get("routes-index.json")));
  writeFileSync(join(root, "sources", "entries", "plain.json"), JSON.stringify(entry("plain", { kinds: ["media"], subjects: ["testing"] })));
  assert.notEqual(index(root).revision, JSON.parse(first).revision);
});

test("a source tagged for a subject with no subject.json is an error, and nothing is built", () => {
  const root = routesRoot();
  mkdirSync(join(root, "subjects", "hollow"));
  writeFileSync(join(root, "sources", "entries", "plain.json"), JSON.stringify(entry("plain", { subjects: ["hollow"] })));
  const result = buildRoutes({ root });
  assert.match(result.errors.join("\n"), /plain: subjects names “hollow”, which has no subjects\/hollow\/subject\.json/);
  assert.equal(result.files.size, 0);
});

test("coverage counts tagged sources, planned and written concepts, and written ones with a library piece", () => {
  const rows = coverage({ root: routesRoot() });
  assert.deepEqual(rows, [
    { id: "empty", sources: 2, show: 1, planned: 0, written: 0, withLibrary: 0 },
    { id: "testing", sources: 5, show: 5, planned: 7, written: 3, withLibrary: 1 },
  ]);
  const table = coverageTable(rows).split("\n");
  assert.equal(table[0], "subject         sources  show  planned  written  with library");
  assert.equal(table[1], "empty                 2     1        0        0             0");
  assert.equal(table[2], "testing               5     5        7        3             1");
  assert.equal(table[3], "all 2 subjects        7     6        7        3             1");
  assert.equal(table[4], "0 of 2 subjects have no tagged source; 1 have no written concept");
});

test("the command line builds into a folder, prints coverage, and refuses anything else", () => {
  const root = routesRoot();
  const out = mkdtempSync(join(tmpdir(), "routes-out-"));
  writeFileSync(join(out, "keep.txt"), "not ours");
  const built = run(["build", "--root", root, "--out", out]);
  assert.equal(built.status, 0, built.stdout + built.stderr);
  assert.match(built.stdout, /wrote routes-index\.json to .*: 2 subjects, revision [0-9a-f]{16}/);
  assert.deepEqual(readdirSync(out).sort(), ["keep.txt", "routes-index.json"]);
  assert.deepEqual(JSON.parse(readFileSync(join(out, "routes-index.json"))), index(root));

  const report = run(["coverage", "--root", root]);
  assert.equal(report.status, 0, report.stderr);
  assert.match(report.stdout, /^subject +sources +show +planned +written +with library$/m);
  assert.match(report.stdout, /have no tagged source/);

  assert.equal(run(["nope", "--root", root]).status, 2);
});

test("the repository's routing table lists every subject folder, and only sources an app may use", () => {
  const result = buildRoutes({ root: realRoot });
  assert.deepEqual(result.errors, []);
  const built = JSON.parse(result.files.get("routes-index.json"));
  const folders = readdirSync(join(realRoot, "subjects"), { withFileTypes: true }).filter((one) => one.isDirectory()).map((one) => one.name).sort();
  assert.deepEqual(built.subjects.map((subject) => subject.id), folders);
  for (const subject of built.subjects) {
    for (const id of subject.sources) {
      const source = JSON.parse(readFileSync(join(realRoot, "sources", "entries", `${id}.json`), "utf8"));
      assert.ok(["show", "link"].includes(source.apps), id);
      assert.ok(source.subjects.includes(subject.id), `${id} for ${subject.id}`);
    }
  }
});
