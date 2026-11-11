import assert from "node:assert/strict";
import test from "node:test";
import { cueReport } from "./cues.mjs";

test("cueReport lists the choice items whose right choice is the longest or the shortest, leaving out rejected ones", () => {
  const item = (id, choices, answer, status = "draft") => ({ id, kind: "choice", choices, answer, verification: { status } });
  const report = cueReport({ items: [
    item("p.long", ["No", "A long right answer", "Never"], 1),
    item("p.even", ["Four", "Five", "Nine"], 0),
    item("p.tie", ["Twelve", "Eleven"], 0),
    item("p.rejected", ["No", "A long right answer"], 1, "rejected"),
    { id: "p.order", kind: "order", steps: ["a", "b", "c"], verification: { status: "draft" } },
  ] });
  assert.equal(report.choices, 3);
  assert.deepEqual(report.longest, [{ id: "p.long", right: 19, others: [2, 5] }]);
  assert.deepEqual(report.shortest, []);
  assert.deepEqual(cueReport({ items: [item("p.short", ["A long wrong answer", "No", "Another wrong one"], 1)] }).shortest, [{ id: "p.short", right: 2, others: [19, 17] }]);
});
