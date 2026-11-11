// Tests for the source catalogue's validator and the re-check script's text handling. Run from the repository's root:
//
//   node --test "sources/*.test.mjs"
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { evidenceOf, normalQuote, ownScripts, pageText } from "./recheck.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");

/** Runs the validator on these entries; returns its exit code and output. */
function validate(...entries) {
  const folder = mkdtempSync(join(tmpdir(), "sources-"));
  try {
    for (const entry of entries) writeFileSync(join(folder, `${entry.id}.json`), JSON.stringify(entry));
    const run = spawnSync(process.execPath, [join(here, "validate.mjs"), folder], { cwd: root, encoding: "utf8" });
    return { code: run.status, out: run.stdout + run.stderr };
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
}

const checked = { date: "2026-11-11", evidence: [{ url: "https://example.org/terms", quote: "a quote from the page" }] };
const base = { id: "example", name: "Example", goodFor: "Testing.", license: "CC-BY-4.0", apps: "link", bank: "none", checked: null, notes: "A test entry." };
const shown = { ...base, apps: "show", attribution: "Example, CC BY 4.0", checked };

test("the catalogue's own entries pass", () => {
  const run = spawnSync(process.execPath, [join(here, "validate.mjs")], { cwd: root, encoding: "utf8" });
  assert.equal(run.status, 0, run.stdout);
});

test("a checked, credited CC BY source may be shown", () => {
  assert.equal(validate(shown).code, 0);
});

test("nothing is shown on an unchecked licence", () => {
  const run = validate({ ...shown, checked: null });
  assert.equal(run.code, 1);
  assert.match(run.out, /isn't checked/);
});

test("a check needs a date and at least one quote", () => {
  assert.equal(validate({ ...base, checked: { date: "2026-11-11", evidence: [] } }).code, 1);
  assert.equal(validate({ ...base, checked: { date: "2026-11-11" } }).code, 1);
  assert.equal(validate({ ...base, checked: { date: "2026-11-11", basis: "a search result" } }).code, 1);
  assert.equal(validate({ ...base, checked: { evidence: checked.evidence } }).code, 1);
  assert.equal(validate({ ...base, checked: { date: "2026-11-11", evidence: [{ url: "http://example.org", quote: "a quote from the page" }] } }).code, 1);
});

test("NonCommercial, unknown and per-item licences can't be shown", () => {
  for (const license of ["CC-BY-NC-4.0", "CC-BY-NC-SA-4.0", "unknown", "per-item"]) {
    const run = validate({ ...shown, license });
    assert.equal(run.code, 1, license);
    assert.match(run.out, /use "link"/);
  }
});

test("showing under a licence that asks for credit needs an attribution", () => {
  const { attribution, ...uncredited } = shown;
  assert.equal(validate(uncredited).code, 1);
  assert.equal(validate({ ...uncredited, license: "CC0-1.0" }).code, 0);
});

test("only a checked CC0 source reachable by tools/ref.mjs may be copied into the bank", () => {
  const wikidata = { ...base, id: "wikidata", license: "CC0-1.0", bank: "copy", checked };
  assert.equal(validate(wikidata).code, 0);
  assert.equal(validate({ ...wikidata, checked: null }).code, 1);
  assert.equal(validate({ ...wikidata, license: "CC-BY-4.0" }).code, 1);
  assert.equal(validate({ ...wikidata, id: "example" }).code, 1);
});

test("apps may be none", () => {
  assert.equal(validate({ ...base, apps: "none" }).code, 0);
});

test("parts follow the same rules as entries", () => {
  const part = { id: "a-book", name: "A book", license: "CC-BY-4.0", apps: "link", checked: null, notes: "A part." };
  assert.equal(validate({ ...base, license: "per-item", parts: [part] }).code, 0);
  assert.equal(validate({ ...base, license: "per-item", parts: [{ ...part, apps: "show", attribution: "A book" }] }).code, 1);
  assert.equal(validate({ ...base, license: "per-item", parts: [{ ...part, apps: "show", attribution: "A book", checked }] }).code, 0);
  assert.equal(validate({ ...base, license: "per-item", parts: [{ ...part, license: "CC-BY-NC-SA-4.0", apps: "show", attribution: "A book", checked }] }).code, 1);
  assert.equal(validate({ ...base, license: "per-item", parts: [part, part] }).code, 1);
});

test("a page's text has its tags, scripts and character references dealt with", () => {
  const html = `<html><head><style>p{}</style><script>var x = "<b>";</script></head>
    <body><p>Text is <a href="/x">CC&nbsp;BY-SA</a>,\n  isn&#39;t it &amp; more&#x2019;s</p><!-- hidden --></body></html>`;
  assert.equal(pageText(html), "Text is CC BY-SA , isn't it & more’s");
});

test("a JSON answer is compared as its strings, in order", () => {
  const json = JSON.stringify({ items: [{ id: 1, title: "Physics", license_name: "Creative Commons Attribution License", license_version: "4.0", body: "<p>Is <i>licensed</i></p>" }] });
  assert.equal(pageText(json), "Physics Creative Commons Attribution License 4.0 Is licensed");
});

test("a quote's white space doesn't matter", () => {
  assert.equal(normalQuote("  a\n quote\tsplit "), "a quote split");
});

test("only a page's scripts from its own host are read", () => {
  const html = `<script src="/_m/app.js?x=1&amp;y=2"></script><script src="https://cdn.example.net/lib.js"></script><script>inline()</script>`;
  assert.deepEqual(ownScripts(html, "https://phet.example.org/en/licensing"), ["https://phet.example.org/_m/app.js?x=1&y=2"]);
});

test("evidence is gathered from an entry and its parts", () => {
  const entry = { checked, parts: [{ checked }, { checked: null }] };
  assert.equal(evidenceOf(entry).length, 2);
  assert.equal(evidenceOf({ checked: null }).length, 0);
});
