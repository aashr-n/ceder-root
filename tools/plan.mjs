// Checks a subject's plan (plan/README.md) and says which of its packs to write next.
//
//   node tools/plan.mjs check plan/physics.json    exits 1 if the plan breaks its format or disagrees with the bank
//   node tools/plan.mjs next physics [count]       the next packs the plan has and the bank doesn't, as JSON (1 if no count)
//   node tools/plan.mjs written physics            the packs the bank has in a subject, with their concepts, as JSON
//   node tools/plan.mjs overview                   writes plan/OVERVIEW.md, every plan as one page a person can read
//   --root <dir>                                   the bank's folder (this tool's parent folder when not given)

import Ajv2020 from "ajv/dist/2020.js";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { bankRoot, loadBank } from "./validate.mjs";

const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));

/**
 * What's wrong with a plan, given the bank as `loadBank` reads it: `{ errors, warnings }`. `plans` holds other
 * subjects' plans by subject ID, so a pack can build on a concept that is planned and not yet written.
 */
export function checkPlan(plan, bank, { root = bankRoot, plans = {} } = {}) {
  const errors = [];
  const warnings = [];
  const validate = new Ajv2020({ allErrors: true }).compile(readJson(join(root, "schema", "plan.schema.json")));
  if (!validate(plan)) {
    for (const error of validate.errors) errors.push(`${error.instancePath || "/"} ${error.message}`);
    return { errors, warnings };
  }
  if (!bank.subjects.some((subject) => subject.data.id === plan.subject)) errors.push(`subject ${plan.subject} has no subjects/${plan.subject}/subject.json`);

  const written = new Map(bank.packs.filter((pack) => pack.data.subject === plan.subject).map((pack) => [pack.data.id, pack.data]));
  const packs = new Set();
  const concepts = new Map();
  for (const entry of plan.packs) {
    const id = `${plan.subject}.${entry.pack}`;
    if (packs.has(entry.pack)) errors.push(`pack ${entry.pack} is planned twice`);
    packs.add(entry.pack);
    const existing = written.get(id);
    if (existing) {
      const has = existing.concepts.map((concept) => concept.id).sort().join(", ");
      const says = entry.concepts.map((concept) => concept.id).sort().join(", ");
      if (has !== says) errors.push(`pack ${entry.pack} is already written with the concepts ${has}; the plan must list exactly those`);
    } else if (entry.concepts.length < 4) errors.push(`pack ${entry.pack} plans ${entry.concepts.length} concept${entry.concepts.length === 1 ? "" : "s"}; a pack has 4 to 12`);
    for (const concept of entry.concepts) {
      if (concepts.has(concept.id)) errors.push(`concept ${concept.id} is in both ${concepts.get(concept.id)} and ${entry.pack}; a concept's ID is unique in its subject`);
      else concepts.set(concept.id, entry.pack);
    }
    for (const ref of entry.buildsOn ?? []) {
      if (!ref.includes("/")) {
        const from = concepts.get(ref);
        if (!from) errors.push(`pack ${entry.pack} builds on ${ref}, which no earlier pack in this plan has`);
        else if (from === entry.pack) errors.push(`pack ${entry.pack} builds on its own concept ${ref}; buildsOn is for concepts from other packs`);
        continue;
      }
      const [subject, concept] = ref.split("/");
      if (subject === plan.subject) { errors.push(`pack ${entry.pack} builds on ${ref}; name a concept in this subject by its ID alone`); continue; }
      const inBank = bank.packs.some((pack) => pack.data.subject === subject && pack.data.concepts.some((one) => one.id === concept));
      const inPlan = (plans[subject]?.packs ?? []).some((pack) => pack.concepts.some((one) => one.id === concept));
      if (!inBank && !inPlan) warnings.push(`pack ${entry.pack} builds on ${ref}, which is in neither the bank nor ${subject}'s plan`);
    }
  }
  for (const id of written.keys()) if (!packs.has(id.slice(plan.subject.length + 1))) errors.push(`the bank has the pack ${id}, and the plan leaves it out`);
  return { errors, warnings };
}

/** The first `count` packs, in the plan's order, that the bank doesn't have. */
export function nextPacks(plan, bank, count = 1) {
  const written = new Set(bank.packs.map((pack) => pack.data.id));
  return plan.packs.filter((entry) => !written.has(`${plan.subject}.${entry.pack}`)).slice(0, count);
}

/** Every plan as one page a person can read: each subject's packs in order, with their concepts, and which are written. */
export function overview(plans, bank) {
  const written = new Set(bank.packs.map((pack) => pack.data.id));
  const names = new Map(bank.subjects.map((subject) => [subject.data.id, subject.data.name]));
  const lines = ["# What the bank plans to cover", "", "Made by `node tools/plan.mjs overview` from the plans in this folder. Don't edit it: change a plan and run that again.", "", "Each subject's packs are in the order a student meets them, with the concepts each one teaches. ✓ marks a pack that is written.", ""];
  for (const plan of [...plans].sort((a, b) => a.subject.localeCompare(b.subject))) {
    const done = plan.packs.filter((entry) => written.has(`${plan.subject}.${entry.pack}`)).length;
    const concepts = plan.packs.reduce((sum, entry) => sum + entry.concepts.length, 0);
    lines.push(`## ${names.get(plan.subject) ?? plan.subject}`, "", `${plan.covers} ${plan.packs.length} packs, ${concepts} concepts, ${done} written.`, "");
    plan.packs.forEach((entry, index) => lines.push(`${index + 1}. **${entry.title}**${written.has(`${plan.subject}.${entry.pack}`) ? " ✓" : ""}: ${entry.concepts.map((concept) => concept.name).join(", ")}`));
    lines.push("");
  }
  return lines.join("\n");
}

function otherPlans(root, except) {
  const plans = {};
  for (const subject of loadBank(root).subjects.map((one) => one.data.id)) {
    const file = join(root, "plan", `${subject}.json`);
    if (subject === except || !existsSync(file)) continue;
    try { plans[subject] = readJson(file); } catch { /* that plan's own check reports it */ }
  }
  return plans;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  let root = bankRoot;
  const rest = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--root") root = resolve(args[++i]);
    else rest.push(args[i]);
  }
  const [command, target, count] = rest;
  try {
    if (command === "check" && target) {
      const plan = readJson(resolve(target));
      const { errors, warnings } = checkPlan(plan, loadBank(root), { root, plans: otherPlans(root, plan.subject) });
      for (const warning of warnings) console.log(`warning: ${warning}`);
      for (const error of errors) console.log(`error: ${error}`);
      const packs = Array.isArray(plan.packs) ? plan.packs : [];
      console.log(`${target}: ${packs.length} packs, ${packs.reduce((sum, pack) => sum + (pack.concepts?.length ?? 0), 0)} concepts: ${errors.length} error${errors.length === 1 ? "" : "s"}, ${warnings.length} warning${warnings.length === 1 ? "" : "s"}`);
      process.exit(errors.length ? 1 : 0);
    } else if (command === "next" && target) {
      const plan = readJson(join(root, "plan", `${target}.json`));
      console.log(JSON.stringify(nextPacks(plan, loadBank(root), Math.max(1, Number(count) || 1)), null, 2));
    } else if (command === "written" && target) {
      const packs = loadBank(root).packs.filter((pack) => pack.data.subject === target);
      console.log(JSON.stringify(packs.map((pack) => ({ pack: pack.data.id.slice(target.length + 1), title: pack.data.title, summary: pack.data.summary, concepts: pack.data.concepts.map((concept) => ({ id: concept.id, name: concept.name })) })), null, 2));
    } else if (command === "overview") {
      const bank = loadBank(root);
      const plans = bank.subjects.map((subject) => join(root, "plan", `${subject.data.id}.json`)).filter((file) => existsSync(file)).map(readJson);
      writeFileSync(join(root, "plan", "OVERVIEW.md"), overview(plans, bank));
      console.log(`wrote plan/OVERVIEW.md: ${plans.length} subjects, ${plans.reduce((sum, plan) => sum + plan.packs.length, 0)} packs`);
    } else throw new Error("usage: node tools/plan.mjs check plan/<subject>.json | next <subject> [count] | written <subject> | overview");
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
