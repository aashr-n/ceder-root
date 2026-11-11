// The only outside reading an agent may do while it plans, writes or checks packs (pipeline/prompts/sources.md): pages
// from Wikipedia and Wikibooks, and names from Wikidata. Nothing else is fetched, every page read is written to
// plan/sources.jsonl, and `check` looks for text a pack took from a page it read.
//
//   node tools/ref.mjs search "<words>"                  titles on Wikipedia that match
//   node tools/ref.mjs wikipedia "<page title>"          saves the page as text and prints its sections with line numbers
//   node tools/ref.mjs wikibooks "<page title>"          the same, from Wikibooks
//   node tools/ref.mjs wikidata "<name>"                 a concept's name and other names (CC0, so they may be copied)
//   node tools/ref.mjs check subjects/<subject>/<pack>   exits 1 if the pack shares a run of 10 words with a saved page
//   --for <who>                                          who is reading, for the log (such as planner:physics)
//
// Pages are saved under .work/refs/, which isn't committed, and read from there the next time. Wikipedia and Wikibooks
// text is CC BY-SA 4.0: read it for what a topic covers, and never copy or reword its sentences into the bank, which is
// CC0. Requests go one at a time, at least 1.5 seconds apart, through the sites' API.

import { spawnSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmdirSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { bankRoot, loadBank } from "./validate.mjs";

/** The only hosts this tool talks to. */
export const SITES = { wikipedia: "en.wikipedia.org", wikibooks: "en.wikibooks.org", wikidata: "www.wikidata.org" };
/** How many words in a row a pack may not share with a page it read. */
export const RUN_LENGTH = 10;
const GAP_MS = 1500;
const USER_AGENT = process.env.REF_USER_AGENT || "question-bank-ref/0.1";

const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

/** A file name for a page title. */
export const slug = (title) => title.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 120) || "page";

/** Wikitext as plain text: headings and list items stay, templates, references, tables, files and markup go. */
export function plainText(wikitext) {
  let text = wikitext.replace(/<!--[\s\S]*?-->/g, "").replace(/<ref\b[^>]*\/>/gi, "").replace(/<ref\b[^>]*>[\s\S]*?<\/ref>/gi, "");
  for (let before = null; before !== text;) { before = text; text = text.replace(/\{\{[^{}]*\}\}/g, ""); }
  for (let before = null; before !== text;) { before = text; text = text.replace(/\{\|[^{]*?\|\}/g, ""); }
  // Innermost links first, so a picture's caption can hold links of its own.
  for (let before = null; before !== text;) {
    before = text;
    text = text
      .replace(/\[\[(?:File|Image|Category):[^\[\]]*\]\]/gi, "")
      .replace(/\[\[(?!(?:File|Image|Category):)[^\[\]|]*\|([^\[\]]*)\]\]/gi, "$1")
      .replace(/\[\[(?!(?:File|Image|Category):)([^\[\]|]*)\]\]/gi, "$1");
  }
  return text
    .replace(/\[https?:\/\/\S+\s+([^\]]*)\]/g, "$1")
    .replace(/\[https?:\/\/\S+\]/g, "")
    .replace(/<\/?[a-z][^>]*>/gi, "")
    .replace(/'{2,}/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

const words = (text) => text.toLowerCase().match(/[a-z0-9]+/g) ?? [];

/**
 * Runs of `length` words that a pack's text shares with a page: `[{ where, run, page }]`, one per place in the pack.
 * `texts` is `[{ where, text }]` and `pages` is `[{ name, text }]`.
 */
export function sharedRuns(texts, pages, length = RUN_LENGTH) {
  const seen = new Map();
  for (const page of pages) {
    const list = words(page.text);
    for (let i = 0; i + length <= list.length; i++) {
      const run = list.slice(i, i + length).join(" ");
      if (!seen.has(run)) seen.set(run, page.name);
    }
  }
  const found = [];
  for (const { where, text } of texts) {
    const list = words(text);
    for (let i = 0; i + length <= list.length; i++) {
      const run = list.slice(i, i + length).join(" ");
      if (seen.has(run)) { found.push({ where, run, page: seen.get(run) }); break; }
    }
  }
  return found;
}

/** Every piece of prose in a pack, with where it is. */
export function packTexts(pack) {
  const texts = [{ where: "summary", text: pack.summary ?? "" }];
  for (const concept of pack.concepts ?? []) {
    texts.push({ where: `concept ${concept.id} summary`, text: concept.summary ?? "" });
    if (concept.explain?.text) texts.push({ where: `concept ${concept.id} explain`, text: concept.explain.text });
  }
  for (const item of pack.items ?? []) {
    for (const key of ["prompt", "explanation"]) if (item[key]) texts.push({ where: `${item.id} ${key}`, text: item[key] });
    if (typeof item.answer === "string") texts.push({ where: `${item.id} answer`, text: item.answer });
    for (const [index, text] of (item.choices ?? item.steps ?? []).entries()) texts.push({ where: `${item.id} ${item.choices ? "choice" : "step"} ${index}`, text });
  }
  for (const artifact of pack.artifacts ?? []) {
    if (artifact.alt) texts.push({ where: `artifact ${artifact.id} alt`, text: artifact.alt });
    for (const [index, step] of (artifact.steps ?? []).entries()) texts.push({ where: `artifact ${artifact.id} step ${index}`, text: step.text ?? "" });
  }
  return texts;
}

function savedPages(refs) {
  const pages = [];
  for (const site of ["wikipedia", "wikibooks"]) {
    const dir = join(refs, site);
    if (!existsSync(dir)) continue;
    for (const name of readdirSync(dir).filter((file) => file.endsWith(".txt")).sort()) pages.push({ name: `${site}/${name}`, text: readFileSync(join(dir, name), "utf8") });
  }
  return pages;
}

/** One request at a time across every agent, at least GAP_MS after the last, and again when the site says to slow down. */
async function get(site, params, refs) {
  const url = `https://${SITES[site]}/w/api.php?${new URLSearchParams({ ...params, format: "json", formatversion: "2" })}`;
  const lock = join(refs, ".lock");
  const last = join(refs, ".last");
  for (let attempt = 0; ; attempt++) {
    for (let waited = 0; ; waited += 200) {
      try { mkdirSync(lock); break; } catch {
        if (waited > 120000 || (existsSync(lock) && Date.now() - statSync(lock).mtimeMs > 60000)) { try { rmdirSync(lock); } catch { /* another reader took it */ } }
        sleep(200);
      }
    }
    try {
      const since = existsSync(last) ? Date.now() - Number(readFileSync(last, "utf8")) : GAP_MS;
      if (since < GAP_MS) sleep(GAP_MS - since);
      const response = await fetch(url, { headers: { "user-agent": USER_AGENT, accept: "application/json" } });
      writeFileSync(last, String(Date.now()));
      if (response.ok) return await response.json();
      if (response.status !== 429 && response.status < 500) throw new Error(`${SITES[site]} answered ${response.status}`);
      if (attempt >= 4) throw new Error(`${SITES[site]} answered ${response.status} five times; try again in a few minutes`);
      const wait = Number(response.headers.get("retry-after")) || 5 * 3 ** attempt;
      writeFileSync(last, String(Date.now() + Math.min(wait, 120) * 1000));
    } finally {
      try { rmdirSync(lock); } catch { /* already gone */ }
    }
  }
}

function log(root, entry) {
  mkdirSync(join(root, "plan"), { recursive: true });
  appendFileSync(join(root, "plan", "sources.jsonl"), JSON.stringify({ at: new Date().toISOString().slice(0, 10), ...entry }) + "\n");
}

async function page(site, title, { root, refs, who }) {
  const dir = join(refs, site);
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${slug(title)}.txt`);
  let text;
  if (existsSync(file)) text = readFileSync(file, "utf8");
  else {
    const data = await get(site, { action: "parse", page: title, prop: "wikitext|revid", redirects: "1" }, refs);
    if (!data.parse) throw new Error(`${site} has no page called “${title}”${data.error?.info ? ` (${data.error.info})` : ""}; try: node tools/ref.mjs search "${title}"`);
    const address = `https://${SITES[site]}/wiki/${encodeURIComponent(data.parse.title.replace(/ /g, "_"))}`;
    const body = [plainText(data.parse.wikitext)];
    if (site === "wikibooks") {
      // A book's contents are built by templates, which plainText drops, so list the pages it links to in its own order.
      const html = (await get(site, { action: "parse", page: data.parse.title, prop: "text" }, refs)).parse?.text ?? "";
      const prefix = `${data.parse.title.replace(/ /g, "_")}/`;
      const chapters = [];
      for (const [, href] of html.matchAll(/href="\/wiki\/([^"#?]+)"/g)) {
        const name = decodeURIComponent(href);
        if (name.startsWith(prefix) && !chapters.includes(name)) chapters.push(name);
      }
      if (chapters.length) body.push("", "== Pages of this book, in its order ==", ...chapters.map((name) => `* ${name.replace(/_/g, " ")}`));
    }
    text = [`# ${data.parse.title}`, `# ${address} (revision ${data.parse.revid}), CC BY-SA 4.0. Read for what the topic covers; never copy or reword its sentences.`, "", ...body].join("\n") + "\n";
    writeFileSync(file, text);
  }
  const lines = text.split("\n");
  const revision = Number(/\(revision (\d+)\)/.exec(lines[1] ?? "")?.[1]) || null;
  log(root, { site, title: lines[0].replace(/^# /, ""), revision, for: who });
  console.log(`${file}: ${lines.length} lines. Read the parts you need by line number.`);
  lines.forEach((line, index) => { if (/^={2,3}[^=].*={2,3}\s*$/.test(line)) console.log(`  line ${index + 1}: ${line.replace(/=/g, "").trim()}`); });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  // Node's fetch only goes through a proxy when it is told to, so run again with that set where a proxy is.
  if ((process.env.HTTPS_PROXY || process.env.https_proxy) && !process.env.NODE_USE_ENV_PROXY) {
    const again = spawnSync(process.execPath, process.argv.slice(1), { stdio: "inherit", env: { ...process.env, NODE_USE_ENV_PROXY: "1", NODE_NO_WARNINGS: "1" } });
    process.exit(again.status ?? 1);
  }
  const args = process.argv.slice(2);
  let who = "unknown";
  let root = bankRoot;
  const rest = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--for") who = args[++i];
    else if (args[i] === "--root") root = resolve(args[++i]);
    else rest.push(args[i]);
  }
  const [command, subject] = rest;
  const refs = join(root, ".work", "refs");
  mkdirSync(refs, { recursive: true });
  try {
    if (!subject || rest.length !== 2) throw new Error("usage: node tools/ref.mjs (search | wikipedia | wikibooks | wikidata) \"<words>\" [--for <who>], or check <pack folder>");
    if (command === "wikipedia" || command === "wikibooks") await page(command, subject, { root, refs, who });
    else if (command === "search") {
      const data = await get("wikipedia", { action: "query", list: "search", srsearch: subject, srlimit: "10", srprop: "size" }, refs);
      log(root, { site: "wikipedia", search: subject, for: who });
      for (const hit of data.query?.search ?? []) console.log(`${hit.title} (${hit.size} bytes)`);
      if (!data.query?.search?.length) console.log("no pages match");
    } else if (command === "wikidata") {
      const found = await get("wikidata", { action: "wbsearchentities", search: subject, language: "en", limit: "3" }, refs);
      const ids = (found.search ?? []).map((hit) => hit.id);
      log(root, { site: "wikidata", search: subject, ids, for: who });
      if (!ids.length) console.log("no entries match");
      else {
        const data = await get("wikidata", { action: "wbgetentities", ids: ids.join("|"), props: "labels|descriptions|aliases", languages: "en" }, refs);
        for (const id of ids) {
          const entity = data.entities?.[id];
          console.log(JSON.stringify({ id, name: entity?.labels?.en?.value, description: entity?.descriptions?.en?.value, otherNames: (entity?.aliases?.en ?? []).map((alias) => alias.value) }));
        }
      }
    } else if (command === "check") {
      const bank = loadBank(root, resolve(subject));
      if (bank.problems.length || !bank.packs.length) throw new Error(bank.problems[0] ?? `no pack under ${subject}`);
      const pages = savedPages(refs);
      let total = 0;
      for (const pack of bank.packs) {
        const found = sharedRuns(packTexts(pack.data), pages);
        total += found.length;
        for (const { where, run, page: name } of found) console.log(`${pack.data.id}: ${where} shares “${run}” with ${name}`);
      }
      console.log(total ? `${total} place${total === 1 ? "" : "s"} share ${RUN_LENGTH} words in a row with a page that was read. Write them again in your own words.` : `no run of ${RUN_LENGTH} words is shared with the ${pages.length} saved page${pages.length === 1 ? "" : "s"}`);
      process.exit(total ? 1 : 0);
    } else throw new Error(`unknown command ${command}`);
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
