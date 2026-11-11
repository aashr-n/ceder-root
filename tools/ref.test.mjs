import assert from "node:assert/strict";
import test from "node:test";
import { RUN_LENGTH, SITES, packTexts, plainText, sharedRuns, slug } from "./ref.mjs";

test("the tool only knows Wikipedia, Wikibooks and Wikidata", () => {
  assert.deepEqual(SITES, { wikipedia: "en.wikipedia.org", wikibooks: "en.wikibooks.org", wikidata: "www.wikidata.org" });
});

test("slug makes a file name from a page title", () => {
  assert.equal(slug("Outline of calculus"), "outline-of-calculus");
  assert.equal(slug("  Trace (linear algebra) "), "trace-linear-algebra");
  assert.equal(slug("…"), "page");
});

test("plainText keeps headings and lists, and drops templates, references, tables, files and markup", () => {
  const text = plainText([
    "{{Short description|A {{nested}} template}}",
    "'''Calculus''' is the study of [[continuous function|continuous change]].<ref name=\"a\">A book.</ref><ref name=\"b\" />",
    "<!-- a note -->",
    "[[File:Curve.svg|thumb|A [[curve]].]]",
    "== Branches ==",
    "* [[Differential calculus]]",
    "* [https://example.org an outside link]",
    "{| class=\"wikitable\"",
    "| a || b",
    "|}",
  ].join("\n"));
  assert.equal(text, "Calculus is the study of continuous change.\n\n== Branches ==\n* Differential calculus\n* an outside link");
});

test("sharedRuns finds a run of words a pack shares with a page, whatever the case and punctuation", () => {
  const page = { name: "wikipedia/derivative.txt", text: "The derivative of a function of a real variable measures the sensitivity to change of the function value." };
  const copied = { where: "item prompt", text: "Recall: the derivative of a function of a real variable measures the SENSITIVITY to change. Why?" };
  const own = { where: "item explanation", text: "A derivative says how fast a function's output changes when its input changes a little." };
  const short = { where: "item answer", text: "The derivative of a function" };
  const found = sharedRuns([copied, own, short], [page]);
  assert.equal(found.length, 1);
  assert.equal(found[0].where, "item prompt");
  assert.equal(found[0].page, "wikipedia/derivative.txt");
  assert.equal(found[0].run.split(" ").length, RUN_LENGTH);
  assert.deepEqual(sharedRuns([copied], [page], 40), []);
});

test("packTexts lists a pack's prose with where it is", () => {
  const texts = packTexts({
    summary: "A pack.",
    concepts: [{ id: "cell", summary: "The unit of life.", explain: { text: "Every living thing is made of cells." } }],
    items: [
      { id: "t.p.a", prompt: "Which?", explanation: "Because.", choices: ["One", "Two"], answer: 0 },
      { id: "t.p.b", prompt: "What?", explanation: "So.", answer: "A membrane" },
      { id: "t.p.c", prompt: "Order.", explanation: "Then.", steps: ["First", "Second", "Third"] },
    ],
    artifacts: [{ id: "d", alt: "A cell.", steps: [{ text: "Look." }] }],
  });
  assert.deepEqual(texts.map((entry) => entry.where), [
    "summary", "concept cell summary", "concept cell explain",
    "t.p.a prompt", "t.p.a explanation", "t.p.a choice 0", "t.p.a choice 1",
    "t.p.b prompt", "t.p.b explanation", "t.p.b answer",
    "t.p.c prompt", "t.p.c explanation", "t.p.c step 0", "t.p.c step 1", "t.p.c step 2",
    "artifact d alt", "artifact d step 0",
  ]);
});
