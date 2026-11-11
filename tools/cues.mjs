// Lists what could give a pack's right answers away without knowing the subject, for an author to fix.
//
//   node tools/cues.mjs subjects/chemistry/matter
//
// It prints every choice item whose right choice is longer than all its other choices, and every one whose right
// choice is shorter than all of them, with the lengths, and the pack's count of each against what validate.mjs allows.
// Fix an item by making its choices alike in length: trim the long ones first, and pad a short one only with
// something a student would have to weigh. Padding only the wrong choices makes the right one the shortest, which
// gives it away just as well. Never change which choice is right.

import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { LONGEST_SHARE, bankRoot, loadBank, rightIsLongest, rightIsShortest } from "./validate.mjs";

const lengths = (item) => ({ id: item.id, right: item.choices[item.answer].length, others: item.choices.filter((_, index) => index !== item.answer).map((choice) => choice.length) });

/** `{ choices, longest: [{ id, right, others }], shortest: [...] }` for one pack's data. */
export function cueReport(pack) {
  const choices = pack.items.filter((item) => item.kind === "choice" && item.verification?.status !== "rejected").length;
  return { choices, longest: rightIsLongest(pack.items).map(lengths), shortest: rightIsShortest(pack.items).map(lengths) };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const only = process.argv.slice(2).find((arg) => !arg.startsWith("--"));
  const bank = loadBank(bankRoot, only);
  for (const problem of bank.problems) console.log(`error: ${problem}`);
  for (const pack of bank.packs) {
    const report = cueReport(pack.data);
    const allowed = Math.floor(report.choices * LONGEST_SHARE);
    for (const word of ["longest", "shortest"]) for (const item of report[word]) console.log(`${item.id}: the right choice is the ${word}, at ${item.right} characters against ${item.others.join(", ")}`);
    for (const word of ["longest", "shortest"]) console.log(`${pack.data.id}: the right choice is the ${word} in ${report[word].length} of ${report.choices} choice items; validate allows ${allowed}${report[word].length > allowed ? `, so fix at least ${report[word].length - allowed}` : ""}`);
  }
}
