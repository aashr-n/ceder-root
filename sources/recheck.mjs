// Re-fetches every evidence page that a checked entry cites, and reports each quote that is no longer on its page
// word for word. Run it by hand from the repository's root; CI doesn't, because it needs the network:
//
//   node sources/recheck.mjs [id ...]
//
// A page is compared as text: tags, scripts and styles removed, character references decoded, runs of white space
// made one space. A JSON answer (an API's) is compared as the text of all its string values, in order, joined by
// spaces. With `fromScript`, the quote may instead be in one of the scripts the page loads from its own host, as
// written there. Wikimedia sites are asked at most once every two seconds between them, any other host once every
// half second, and a 429 is waited out as its Retry-After asks. Behind an HTTPS proxy, run it with
// NODE_USE_ENV_PROXY=1 so Node's fetch uses the proxy.
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const USER_AGENT = "ceder-root-licence-check/0.1";
const GAP_MS = 2000;
const OTHER_GAP_MS = 500;

const NAMED = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ndash: "–", mdash: "—", lsquo: "‘", rsquo: "’", ldquo: "“", rdquo: "”", hellip: "…", copy: "©", reg: "®", trade: "™", sect: "§", middot: "·", bull: "•" };

/** Character references decoded. */
export const decode = (text) =>
  text.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi, (whole, name) => {
    if (name[0] === "#") {
      const code = name[1] === "x" || name[1] === "X" ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
    }
    return NAMED[name.toLowerCase()] ?? whole;
  });

/** An HTML page as the text a reader sees, on one line. */
export const htmlText = (html) =>
  decode(
    html
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/<(script|style|noscript)\b[\s\S]*?<\/\1>/gi, " ")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/\s+/g, " ")
    .trim();

const strings = (value, out = []) => {
  if (typeof value === "string") out.push(value);
  else if (Array.isArray(value)) for (const item of value) strings(item, out);
  else if (value && typeof value === "object") for (const item of Object.values(value)) strings(item, out);
  return out;
};

/** A fetched body as comparable text: an HTML page's text, or the text of every string in a JSON answer. */
export function pageText(body) {
  const trimmed = body.trimStart();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      return htmlText(strings(JSON.parse(body)).join("\n"));
    } catch { /* not JSON after all */ }
  }
  return htmlText(body);
}

/** A quote as it is compared: white space made one space. */
export const normalQuote = (quote) => quote.replace(/\s+/g, " ").trim();

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
const wikimedia = (url) => /(^|\.)(wikipedia|wikibooks|wiktionary|wikidata|wikimedia)\.org$/.test(new URL(url).hostname);

/** When each host (all of Wikimedia counting as one) may next be asked. */
const nextAllowed = new Map();
async function fetchBody(url) {
  const host = wikimedia(url) ? "wikimedia" : new URL(url).host;
  for (let attempt = 0; attempt < 5; attempt++) {
    const wait = (nextAllowed.get(host) ?? 0) - Date.now();
    if (wait > 0) await sleep(wait);
    nextAllowed.set(host, Date.now() + (host === "wikimedia" ? GAP_MS : OTHER_GAP_MS));
    const response = await fetch(url, { headers: { "user-agent": USER_AGENT } });
    if (response.ok) return await response.text();
    if (response.status !== 429 && response.status < 500) throw new Error(`answered ${response.status}`);
    const retryAfter = Math.min(Number(response.headers.get("retry-after")) || 5 * 3 ** attempt, 120);
    nextAllowed.set(host, Date.now() + retryAfter * 1000);
  }
  throw new Error("kept answering 429 or a server error");
}

/** The addresses of the scripts a page loads from its own host. */
export const ownScripts = (html, url) =>
  [...html.matchAll(/<script\b[^>]*\bsrc="([^"]+)"/gi)]
    .map((match) => new URL(decode(match[1]), url))
    .filter((script) => script.host === new URL(url).host)
    .map(String);

/** The texts a quote may be found in: the page's, and with `fromScript` also each of its own scripts, as written. */
async function textsOf(url, fromScript) {
  const body = await fetchBody(url);
  const texts = [pageText(body)];
  if (fromScript) for (const script of ownScripts(body, url)) texts.push((await fetchBody(script)).replace(/\s+/g, " "));
  return texts;
}

/** Every `{ url, quote }` an entry cites: its own evidence and each part's. */
export const evidenceOf = (entry) => [
  ...(entry.checked?.evidence ?? []),
  ...(entry.parts ?? []).flatMap((part) => part.checked?.evidence ?? []),
];

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const folder = join(dirname(fileURLToPath(import.meta.url)), "entries");
  const only = new Set(process.argv.slice(2));
  const entries = readdirSync(folder)
    .filter((file) => file.endsWith(".json"))
    .sort()
    .map((file) => JSON.parse(readFileSync(join(folder, file), "utf8")))
    .filter((entry) => only.size === 0 || only.has(entry.id));
  const pages = new Map();
  let quotes = 0;
  let missing = 0;
  let unreachable = 0;
  for (const entry of entries) {
    for (const { url, quote, fromScript = false } of evidenceOf(entry)) {
      quotes++;
      const key = `${fromScript} ${url}`;
      if (!pages.has(key)) {
        try {
          pages.set(key, { texts: await textsOf(url, fromScript) });
        } catch (error) {
          pages.set(key, { error: error.message });
        }
      }
      const page = pages.get(key);
      if (page.error) {
        unreachable++;
        console.log(`unreachable ${entry.id}: ${url} (${page.error})`);
      } else if (!page.texts.some((text) => text.includes(normalQuote(quote)))) {
        missing++;
        console.log(`missing     ${entry.id}: ${url}\n            "${quote}"`);
      }
    }
  }
  console.log(`${quotes} quote${quotes === 1 ? "" : "s"} on ${pages.size} page${pages.size === 1 ? "" : "s"}: ${missing} missing, ${unreachable} on pages that couldn't be fetched`);
  process.exit(missing || unreachable ? 1 : 0);
}
