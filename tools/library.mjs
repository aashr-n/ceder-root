// The library (library/README.md): pinned pieces of outside sources, each under its own licence and with its own
// credit, kept apart from the CC0 bank. It checks the items against the source catalogue (sources/), fetches new
// ones, and builds what an app reads.
//
//   node tools/library.mjs validate                                      checks every item; exits 1 on an error
//   node tools/library.mjs pin wikipedia "<title>" --concept <ref>...    pins the plain text of an article's lead
//   node tools/library.mjs pin commons "File:<name>" --alt "<words>" --concept <ref>...
//                                                                        pins a Commons file as a PNG or JPEG at most 800 pixels wide
//   node tools/library.mjs build [--out <dir>]                           writes library-index.json and libraryasset-* (dist/library/ when not given)
//   --concept <subject>/<concept id>   a concept the piece supports; give it once for each
//   --slug <slug>                      the item's name, when the title's isn't wanted
//   --replace                          pins again over an item that's already there
//   --root <dir>                       the repository's folder (this tool's parent folder when not given)
//
// Nothing is allowed by default. An item may store text or a picture only when the catalogue's terms for it (its
// source's entry, or the part of it the item names) were checked, and the item's own licence is CC0, public domain,
// CC BY or CC BY-SA. Under a single licence, those terms must say apps may show it and be that licence. Where pieces
// each carry their own licence (a per-item source, or any picture on a wiki), the item must keep what its file page's
// metadata said, and this tool must be able to read that metadata and get the same licence and credit from it: today
// only for Wikimedia Commons. Any source the apps may use may have a link, which stores only a title and an address.
//
// Fetches go through tools/ref.mjs's one-at-a-time fetch, at least 2 seconds apart, and only to en.wikipedia.org,
// commons.wikimedia.org and upload.wikimedia.org. Pinning doesn't write to plan/sources.jsonl: that log is what agents
// read for the bank, and a pinned piece never goes into the bank.

import Ajv from "ajv";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { politeFetch, slug as slugOf } from "./ref.mjs";
import { renderSvg } from "./render.mjs";
import { bankRoot, loadBank } from "./validate.mjs";

export const FORMAT_VERSION = 1;
/** The longest a text piece may be, in characters. */
export const MAX_TEXT = 1000;
/** How wide a pinned picture is stored, at most. */
export const IMAGE_WIDTH = 800;
export const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
/** The largest original file pinning downloads. */
export const MAX_ORIGINAL_BYTES = 25 * 1024 * 1024;
/** The licence ID for a work in the public domain. SPDX has none, so this is a LicenseRef. */
export const PUBLIC_DOMAIN = "LicenseRef-public-domain";
export const INDEX_FILE = "library-index.json";
export const SOURCES_FILE = "sources-index.json";
/** The files a built library is made of, and so the only files the build removes from a folder it writes into. */
export const BUILT_FILE = /^(library-index\.json|libraryasset-[0-9a-f]{16}\.[a-z0-9]+)$/;
/** The only hosts pinning reaches. */
export const HOSTS = { wikipedia: "en.wikipedia.org", "wikimedia-commons": "commons.wikimedia.org", upload: "upload.wikimedia.org" };
const GAP_MS = 2000;
/** Sources whose pages have revisions, so an item from them pins one. */
const WIKI_HOST = /(^|\.)(wikipedia|wikibooks|wiktionary|wikimedia|wikidata|wikiversity|wikisource)\.org$/;

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const json = (value) => Buffer.from(JSON.stringify(value, null, 2) + "\n");
const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));
const hostOf = (url) => { try { return new URL(url).host; } catch { return null; } };

/** Whether a piece under this licence may be stored and shown: CC0, public domain, CC BY or CC BY-SA, any version or port. */
export const storable = (license) => license === "CC0-1.0" || license === PUBLIC_DOMAIN || /^CC-BY(-SA)?-(1\.0|2\.0|2\.5|3\.0|4\.0)(-[A-Z]{2,3})?$/.test(license);
/** Whether a licence asks for no credit. */
export const needsNoCredit = (license) => license === "CC0-1.0" || license === PUBLIC_DOMAIN;

/** The licence ID a Creative Commons address names, or null for any other address. */
export function licenseFromUrl(url) {
  const match = /^https?:\/\/creativecommons\.org\/(licenses\/(by|by-sa)\/(\d\.\d)(?:\/([a-z]{2,3}))?|publicdomain\/(zero|mark)\/1\.0)\/?(?:deed\.[a-z-]+)?$/i.exec(url ?? "");
  if (!match) return null;
  if (match[5]) return match[5].toLowerCase() === "zero" ? "CC0-1.0" : PUBLIC_DOMAIN;
  return `CC-${match[2].toUpperCase()}-${match[3]}${match[4] ? `-${match[4].toUpperCase()}` : ""}`;
}

/** A Creative Commons address in its plain form: https, no deed page, ending in a slash. Any other address as it is. */
export function canonicalLicenseUrl(url) {
  if (!licenseFromUrl(url)) return url;
  return url.replace(/^http:/, "https:").replace(/deed\.[a-z-]+$/i, "").replace(/\/?$/, "/");
}

/** A licence as a credit line names it: "CC BY-SA 4.0". */
export function licenseName(license) {
  if (license === PUBLIC_DOMAIN) return "Public domain";
  if (license === "CC0-1.0") return "CC0 1.0";
  const match = /^CC-(BY(?:-SA)?)-(\d\.\d)(?:-([A-Z]+))?$/.exec(license);
  return match ? `CC ${match[1]} ${match[2]}${match[3] ? ` ${match[3]}` : ""}` : license;
}

/** A PNG's or JPEG's size in pixels and its kind, from its bytes; null for anything else. */
export function imageSize(bytes) {
  if (bytes.length >= 24 && bytes.readUInt32BE(0) === 0x89504e47 && bytes.readUInt32BE(4) === 0x0d0a1a0a && bytes.toString("latin1", 12, 16) === "IHDR") {
    return { type: "png", width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
  }
  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    for (let at = 2; at + 9 < bytes.length;) {
      if (bytes[at] !== 0xff) return null;
      const marker = bytes[at + 1];
      if (marker === 0xff) { at++; continue; }
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { at += 2; continue; }
      const length = bytes.readUInt16BE(at + 2);
      // Start-of-frame markers, leaving out DHT (c4), JPG (c8) and DAC (cc).
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) return { type: "jpg", height: bytes.readUInt16BE(at + 5), width: bytes.readUInt16BE(at + 7) };
      at += 2 + length;
    }
  }
  return null;
}

/** Why a piece of text isn't plain, or null when it is. */
export function notPlain(text) {
  if (/[<>]/.test(text)) return "it holds < or >, so it may be markup";
  if (/\{\{|\}\}|\[\[|\]\]|''|\{\\/.test(text)) return "it holds wiki or TeX markup";
  if (/[\u0000-\u0009\u000b-\u001f\u007f]/.test(text)) return "it holds a control character";
  if (/\n{3,}|^\s|\s$/.test(text)) return "it has blank lines or spaces at its ends";
  return null;
}

/**
 * An article's lead, as Wikipedia's plain-text extract gives it, cut to at most `limit` characters: whole paragraphs
 * while they fit, or else the first paragraph's whole sentences. `{ text, changes }`, or null when not even the first
 * sentence fits. `changes` says what was done, as CC BY and CC BY-SA ask.
 */
export function leadText(extract, limit = MAX_TEXT) {
  const paragraphs = extract.replace(/\r/g, "").split(/\n+/)
    .map((paragraph) => paragraph.replace(/\(\s*[;,]?\s*\)/g, "").replace(/\(\s*[;,]\s*/g, "(").replace(/\s+([,.;:])/g, "$1").replace(/[ \t]+/g, " ").trim())
    .filter(Boolean);
  if (!paragraphs.length) return null;
  const kept = [];
  for (const paragraph of paragraphs) {
    if ([...kept, paragraph].join("\n\n").length > limit) break;
    kept.push(paragraph);
  }
  if (kept.length === paragraphs.length) return { text: kept.join("\n\n"), changes: "Plain text of the lead section" };
  if (kept.length) return { text: kept.join("\n\n"), changes: `Plain text of the lead section, shortened to its first ${kept.length === 1 ? "paragraph" : `${kept.length} paragraphs`}` };
  const sentences = paragraphs[0].split(/(?<=[a-z0-9)\]][.!?])\s+(?=[A-Z“"(])/);
  const first = [];
  for (const sentence of sentences) {
    if ([...first, sentence].join(" ").length > limit) break;
    first.push(sentence);
  }
  if (!first.length) return null;
  return { text: first.join(" "), changes: `Plain text of the lead section, shortened to its first ${first.length === 1 ? "sentence" : `${first.length} sentences`}` };
}

/** HTML from a file's metadata as plain text. */
export function htmlToText(html) {
  return String(html ?? "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;|&#160;/g, " ").replace(/&quot;|&#34;/g, "\"").replace(/&#0?39;|&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&")
    .replace(/\s+/g, " ").replace(/\s+([,.;:)])/g, "$1").replace(/\(\s+/g, "(").trim();
}

const wikiPage = (host, title) => `https://${host}/wiki/${encodeURIComponent(title.replace(/ /g, "_")).replace(/%2F/g, "/").replace(/%3A/g, ":")}`;
const permalinkOf = (host, title, revision) => `https://${host}/w/index.php?${new URLSearchParams({ title: title.replace(/ /g, "_"), oldid: String(revision) })}`;

/**
 * A text item from Wikipedia's answer to a query for an article's extract, revision and the site's licence (see
 * `pinWikipedia`). Throws when the answer doesn't establish what the item needs.
 */
export function wikipediaItem(data, { concepts, retrieved, slug }) {
  const page = data.query?.pages?.[0];
  if (!page || page.missing || page.invalid) throw new Error(`Wikipedia has no such article`);
  const license = licenseFromUrl(data.query?.rightsinfo?.url);
  if (!license) throw new Error(`Wikipedia didn't say which licence its text is under (rightsinfo: ${JSON.stringify(data.query?.rightsinfo ?? null)})`);
  if (!page.lastrevid) throw new Error(`Wikipedia didn't give the article's revision`);
  const lead = leadText(page.extract ?? "");
  if (!lead) throw new Error(`“${page.title}” has no lead text that fits in ${MAX_TEXT} characters`);
  const problem = notPlain(lead.text);
  if (problem) throw new Error(`“${page.title}”'s lead isn't plain text: ${problem}`);
  const host = HOSTS.wikipedia;
  return {
    id: `wikipedia/${slug ?? slugOf(page.title)}`,
    source: "wikipedia",
    part: "text",
    kind: "text",
    title: page.title,
    url: wikiPage(host, page.title),
    revision: page.lastrevid,
    permalink: permalinkOf(host, page.title, page.lastrevid),
    retrieved,
    license,
    licenseUrl: canonicalLicenseUrl(data.query.rightsinfo.url),
    credit: { authors: "Wikipedia contributors", line: `“${page.title}” by Wikipedia contributors. ${lead.changes}. Offered under ${licenseName(license)}.` },
    changes: lead.changes,
    text: lead.text,
    concepts,
  };
}

/**
 * A file's licence from its Commons metadata: `{ license, licenseUrl }`. Only what the metadata states: a Creative
 * Commons address, or a public-domain file with no address. Throws for anything else.
 */
export function commonsLicense(meta, descriptionUrl) {
  const value = (key) => htmlToText(meta?.[key]?.value);
  const url = value("LicenseUrl");
  if (url) {
    const license = licenseFromUrl(url);
    if (!license) throw new Error(`its licence address ${url} isn't one this library takes (${value("LicenseShortName") || "no name given"})`);
    return { license, licenseUrl: canonicalLicenseUrl(url) };
  }
  if (value("License").toLowerCase() === "pd" && value("Copyrighted").toLowerCase() === "false") return { license: PUBLIC_DOMAIN, licenseUrl: descriptionUrl };
  throw new Error(`its metadata gives no licence this library takes (${value("LicenseShortName") || value("License") || "none given"})`);
}

/**
 * A picture as the library stores it: `{ bytes, changes }`. An SVG is rendered to a PNG at most `width` pixels wide,
 * a PNG or JPEG that's wider is scaled down to a PNG that wide, and one that already fits is kept as it is. The
 * rendering uses the build's renderer (tools/render.mjs), so no other software is needed.
 */
export function fitPicture(original, mime, width = IMAGE_WIDTH) {
  if (mime === "image/svg+xml") {
    const svg = original.toString("utf8");
    const rendered = renderSvg(svg, width);
    return { bytes: rendered.png, changes: `Rendered from SVG as a PNG ${rendered.width} pixels wide` };
  }
  const size = imageSize(original);
  if (!size || !["image/png", "image/jpeg"].includes(mime)) throw new Error(`it's ${mime}; the library stores PNG and JPEG pictures, and renders SVG`);
  if (size.width <= width) return { bytes: original, changes: "Not changed" };
  const wrapped = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${size.width}" height="${size.height}"><image width="${size.width}" height="${size.height}" xlink:href="data:${mime};base64,${original.toString("base64")}"/></svg>`;
  const scaled = renderSvg(wrapped, width);
  return { bytes: scaled.png, changes: `Scaled down to ${scaled.width} pixels wide${size.type === "jpg" ? ", as a PNG" : ""}` };
}

/**
 * An image item from Commons' answer to a query for a file's details (see `pinCommons`), the picture as `fitPicture`
 * made it, and what `fitPicture` says it changed. Throws when the answer doesn't establish what the item needs.
 */
export function commonsItem(data, bytes, { concepts, retrieved, slug, alt, changes }) {
  const page = data.query?.pages?.[0];
  const info = page?.imageinfo?.[0];
  if (!page || page.missing || !info) throw new Error(`Commons has no such file`);
  const meta = info.extmetadata ?? {};
  const { license, licenseUrl } = commonsLicense(meta, info.descriptionurl);
  const authors = htmlToText(meta.Artist?.value);
  if (!authors && !needsNoCredit(license)) throw new Error(`its metadata names no author, and ${licenseName(license)} asks for credit`);
  const size = imageSize(bytes);
  if (!size) throw new Error(`the picture Commons sent isn't a PNG or a JPEG`);
  if (!page.lastrevid) throw new Error(`Commons didn't give the file page's revision`);
  const name = page.title.replace(/^File:/, "");
  const title = htmlToText(meta.ObjectName?.value) || name.replace(/\.[a-z0-9]+$/i, "");
  const given = htmlToText(meta.Attribution?.value);
  const changed = changes === "Not changed" ? "" : ` ${changes}.`;
  const line = `${given || `“${title}”${authors ? ` by ${authors}` : ""}`}, via Wikimedia Commons.${changed} ${licenseName(license)}.`;
  const host = HOSTS["wikimedia-commons"];
  const id = slug ?? slugOf(name.replace(/\.[a-z0-9]+$/i, ""));
  const item = {
    id: `wikimedia-commons/${id}`,
    source: "wikimedia-commons",
    kind: "image",
    title,
    url: info.descriptionurl ?? wikiPage(host, page.title),
    revision: page.lastrevid,
    permalink: permalinkOf(host, page.title, page.lastrevid),
    retrieved,
    license,
    licenseUrl: canonicalLicenseUrl(licenseUrl),
  };
  if (authors || given) item.credit = { authors: authors || given, line };
  Object.assign(item, { changes, file: `files/wikimedia-commons/${id}.${size.type}`, sha256: sha256(bytes), width: size.width, height: size.height, alt });
  const evidence = Object.fromEntries(COMMONS_EVIDENCE.filter((key) => meta[key]?.value !== undefined).map((key) => [key, String(meta[key].value)]));
  Object.assign(item, { evidence: { url: item.url, metadata: evidence }, concepts });
  return item;
}

/** The metadata fields a Commons item keeps as evidence of its file's licence and credit. */
export const COMMONS_EVIDENCE = ["LicenseShortName", "LicenseUrl", "License", "Copyrighted", "Artist", "Attribution", "Restrictions"];

/** What an item's `evidence` from a Commons file page gives, as `{ license, licenseUrl, authors, attribution, restrictions }`. */
export function commonsEvidence(metadata, url) {
  const meta = Object.fromEntries(Object.entries(metadata ?? {}).map(([key, value]) => [key, { value }]));
  return { ...commonsLicense(meta, url), authors: htmlToText(metadata?.Artist), attribution: htmlToText(metadata?.Attribution), restrictions: htmlToText(metadata?.Restrictions) };
}

/**
 * For each source licensed piece by piece that this tool can read a piece's own licence from: what's wrong with an
 * item's evidence, as sentences. Any other such source's pieces can only be links.
 */
export const FILE_LICENCE_READERS = {
  "wikimedia-commons": (item) => {
    const errors = [];
    if (item.evidence.url !== item.url) errors.push(`its evidence is from ${item.evidence.url}, not its own file page`);
    let read;
    try {
      read = commonsEvidence(item.evidence.metadata, item.url);
    } catch (error) {
      return [...errors, `its evidence doesn't give a licence the library may store: ${error.message}`];
    }
    if (read.license !== item.license || read.licenseUrl !== item.licenseUrl) errors.push(`its evidence gives ${read.license} at ${read.licenseUrl}, not ${item.license} at ${item.licenseUrl}`);
    if (read.restrictions) errors.push(`its file page notes restrictions (${read.restrictions}), such as a trademark or a person who can be recognised; that needs a person's review, so make it a link`);
    if (!needsNoCredit(read.license) && !read.authors && !read.attribution) errors.push(`its evidence names no author, and ${licenseName(read.license)} asks for credit`);
    if (item.credit && item.credit.authors !== (read.authors || read.attribution)) errors.push(`its credit's authors aren't the ones its evidence names, “${read.authors || read.attribution}”`);
    return errors;
  },
};

/** The source catalogue, by ID. */
export function loadCatalogue(root = bankRoot) {
  const catalogue = new Map();
  const dir = join(root, "sources", "entries");
  for (const file of existsSync(dir) ? readdirSync(dir).filter((name) => name.endsWith(".json")).sort() : []) {
    try {
      const entry = readJson(join(dir, file));
      catalogue.set(entry.id, entry);
    } catch { /* sources/validate.mjs reports it */ }
  }
  return catalogue;
}

/**
 * What an app may do with a piece, from the catalogue alone: "show" (stored text or a picture, shown in full with its
 * credit), "link" (only a link), or null when it may not be exported at all. Independent of the validator's checks, so
 * that nothing the catalogue forbids can reach an app's copy even if a check were ever loosened: a source or part
 * whose `apps` is none or private, or that isn't in the catalogue, is never exported, and stored content from a
 * link-only source goes only with the evidence of its own file's licence.
 */
export function appAccess(item, catalogue) {
  const entry = catalogue.get(item.source);
  if (!entry) return null;
  const terms = item.part ? (entry.parts ?? []).find((part) => part.id === item.part) : entry;
  if (!terms) return null;
  if (!["show", "link"].includes(entry.apps) || !["show", "link"].includes(terms.apps)) return null;
  if (item.kind === "link") return "link";
  if (terms.apps === "show") return "show";
  return item.evidence ? "show" : null;
}

/** Every concept in the bank, by ref. */
export function conceptRefs(root = bankRoot) {
  const refs = new Set();
  for (const pack of loadBank(root).packs) for (const concept of pack.data?.concepts ?? []) refs.add(`${pack.subjectFolder}/${concept.id}`);
  return refs;
}

/** The library's items as they are on disk: `{ items: [{ path, data }], problems }`. */
export function loadLibrary(root = bankRoot) {
  const items = [];
  const problems = [];
  const dir = join(root, "library", "items");
  const folders = existsSync(dir) ? readdirSync(dir).filter((name) => statSync(join(dir, name)).isDirectory()).sort() : [];
  for (const folder of folders) {
    for (const file of readdirSync(join(dir, folder)).sort()) {
      const path = join("library", "items", folder, file);
      if (!file.endsWith(".json")) { problems.push(`${path}: only items' .json files go in library/items/`); continue; }
      try {
        items.push({ path, folder, data: readJson(join(root, path)) });
      } catch (error) {
        problems.push(`${path}: ${error.message}`);
      }
    }
  }
  return { items, problems };
}

/**
 * Everything wrong with one item, as sentences. `bytes` stands in for the item's stored file, for an item that isn't
 * written yet.
 */
export function checkItem(item, { root = bankRoot, catalogue, concepts, bytes } = {}) {
  const errors = [];
  const entry = catalogue.get(item.source);
  if (!entry) return [`its source “${item.source}” isn't in sources/entries/`];
  // The terms that govern the piece: its source's, or, for a source checked part by part, the part it names.
  let terms = entry;
  if (item.part) {
    terms = (entry.parts ?? []).find((part) => part.id === item.part);
    if (!terms) return [`its source “${item.source}” has no part “${item.part}”`];
  } else if (entry.parts && item.kind !== "link") errors.push(`“${item.source}” is checked part by part (${entry.parts.map((part) => part.id).join(", ")}): name the one this piece is from in part`);
  const what = item.part ? `“${item.source}”'s part “${item.part}”` : `“${item.source}”`;
  if (entry.apps === "private" || terms.apps === "private") errors.push(`${what} is a student's own files, which never go in the library`);
  if (entry.apps === "none" || terms.apps === "none") errors.push(`the catalogue says apps may not use ${what} at all, not even with a link`);
  if (!item.id.startsWith(`${item.source}/`)) errors.push(`its id “${item.id}” doesn't start with its source, “${item.source}/”`);
  const sourceHost = hostOf(entry.url);
  if (sourceHost && hostOf(item.url) !== sourceHost) errors.push(`its url is on ${hostOf(item.url)}, but its source is ${sourceHost}`);
  const wiki = WIKI_HOST.test(sourceHost ?? hostOf(item.url) ?? "");

  if (item.kind !== "link") {
    // Stored content: allowed only where the catalogue says so, and only under a licence that lets Ceder show it.
    const stores = item.kind === "text" ? "text" : "a file";
    if (!terms.checked) errors.push(`it stores ${stores}, but nobody has checked ${what}'s licence (checked is null)`);
    if (!storable(item.license)) errors.push(`licence “${item.license}” isn't one the library may store: only CC0-1.0, ${PUBLIC_DOMAIN}, CC-BY-* and CC-BY-SA-*`);
    // A source licensed file by file, and any picture on a wiki, is under its own file's licence. Such a piece is
    // stored only when it records what its file page's metadata said, and that gives the licence and credit it claims.
    const ownLicence = terms.license === "per-item" || (wiki && item.kind === "image");
    if (ownLicence) {
      const reader = FILE_LICENCE_READERS[item.source];
      if (!reader) errors.push(`it stores ${stores} from ${what}, whose pieces each carry their own licence, and this tool can't read and check a piece's licence there: make it a link`);
      else if (!item.evidence) errors.push(`it stores ${stores} from ${what}, whose pieces each carry their own licence, so it needs the evidence its file page gave`);
      else errors.push(...reader(item));
    } else {
      if (terms.apps !== "show") errors.push(`it stores ${stores}, but the catalogue says apps may only ${terms.apps === "link" ? "link to" : "use"} ${what}: make it a link`);
      if (terms.license !== item.license) errors.push(`its licence, ${item.license}, isn't ${what}'s, ${terms.license}`);
      if (item.evidence) errors.push(`it has evidence, which only a piece under its own file's licence keeps`);
    }
    if (item.license?.startsWith("CC-") && licenseFromUrl(item.licenseUrl) !== item.license) errors.push(`its licenseUrl ${item.licenseUrl} isn't the address of ${item.license}`);
    if (!needsNoCredit(item.license)) {
      if (!item.credit) errors.push(`${item.license} asks for credit, so it needs a credit`);
      else {
        // CC BY and CC BY-SA ask that a copy name its licence and say whether it was changed.
        if (!item.credit.line.includes(licenseName(item.license))) errors.push(`its credit line doesn't name its licence, “${licenseName(item.license)}”`);
        if (item.changes !== "Not changed" && !item.credit.line.includes(item.changes)) errors.push(`its credit line doesn't say what was changed: “${item.changes}”`);
      }
    }
    if (wiki) {
      if (!item.revision || !item.permalink) errors.push(`it's from a wiki, so it needs the revision it was taken from and a permalink to it`);
      else if (hostOf(item.permalink) !== hostOf(item.url) || new URL(item.permalink).searchParams.get("oldid") !== String(item.revision)) errors.push(`its permalink isn't to revision ${item.revision} on ${hostOf(item.url)}`);
    }
  }
  if (item.kind === "text") {
    if (item.text.length > MAX_TEXT) errors.push(`its text is ${item.text.length} characters; at most ${MAX_TEXT}`);
    const problem = notPlain(item.text);
    if (problem) errors.push(`its text isn't plain: ${problem}`);
  }
  if (item.kind === "image") {
    if (!item.file.startsWith(`files/${item.source}/`)) errors.push(`its file isn't under library/files/${item.source}/`);
    const path = join(root, "library", item.file);
    const data = bytes ?? (existsSync(path) ? readFileSync(path) : null);
    if (!data) errors.push(`its file library/${item.file} is missing`);
    else {
      if (sha256(data) !== item.sha256) errors.push(`library/${item.file}'s SHA-256 isn't the item's sha256`);
      if (data.length > MAX_IMAGE_BYTES) errors.push(`library/${item.file} is over 2 MB`);
      const size = imageSize(data);
      if (!size || !item.file.endsWith(`.${size.type}`)) errors.push(`library/${item.file} isn't the PNG or JPEG its name says`);
      else if (size.width !== item.width || size.height !== item.height) errors.push(`library/${item.file} is ${size.width} by ${size.height}, not ${item.width} by ${item.height}`);
      else if (size.width > IMAGE_WIDTH) errors.push(`library/${item.file} is ${size.width} pixels wide; store it at most ${IMAGE_WIDTH}`);
    }
  }
  for (const ref of item.concepts) if (!concepts.has(ref)) errors.push(`concept “${ref}” isn't in the bank`);
  return errors;
}

const schemaOf = (root) => new Ajv({ allErrors: true }).compile(readJson(join(root, "library", "item.schema.json")));

/** Everything wrong with the library, as `{ items, errors }`: `items` are the loaded items' data. */
export function checkLibrary(root = bankRoot) {
  // A bank with no library has no pieces; there is nothing to check.
  if (!existsSync(join(root, "library"))) return { items: [], errors: [] };
  const check = schemaOf(root);
  const catalogue = loadCatalogue(root);
  const concepts = conceptRefs(root);
  const { items, problems } = loadLibrary(root);
  const errors = [...problems];
  const ids = new Set();
  const files = new Set();
  for (const { path, folder, data } of items) {
    const fail = (message) => errors.push(`${path}: ${message}`);
    if (!check(data)) {
      for (const problem of check.errors.slice(0, 12)) fail(`${problem.instancePath || "/"} ${problem.message}`);
      continue;
    }
    if (`${folder}/${path.split("/").pop().replace(/\.json$/, "")}` !== data.id) fail(`its id, “${data.id}”, isn't its folder and file name`);
    if (ids.has(data.id)) fail(`another item has the id “${data.id}”`);
    ids.add(data.id);
    if (data.file) files.add(data.file);
    for (const message of checkItem(data, { root, catalogue, concepts })) fail(message);
  }
  // A stored file no item names has no licence or credit on record, so it can't stay.
  const filesDir = join(root, "library", "files");
  const walk = (dir) => readdirSync(dir).sort().flatMap((name) => statSync(join(dir, name)).isDirectory() ? walk(join(dir, name)) : [join(dir, name)]);
  for (const file of existsSync(filesDir) ? walk(filesDir) : []) {
    const name = relative(join(root, "library"), file);
    if (!files.has(name)) errors.push(`library/${name}: no item names this file`);
  }
  return { items: items.map((entry) => entry.data), errors };
}

const pick = (object, keys) => {
  const picked = {};
  for (const key of keys) if (object[key] !== undefined) picked[key] = object[key];
  return picked;
};

/**
 * The built library in memory: `{ files, items, errors, revision }`. `files` maps each file name to its bytes, and is
 * empty when there are errors. `library-index.json` holds every item, with its text and credit inline, and for each
 * concept ref the items that support it; each picture is a `libraryasset-<hash>.<ext>`.
 */
export function buildLibrary({ root = bankRoot } = {}) {
  const { items, errors } = checkLibrary(root);
  const catalogue = loadCatalogue(root);
  const result = { files: new Map(), items: 0, errors, revision: null };
  if (errors.length) return result;
  const assets = new Map();
  const built = [];
  const byConcept = new Map();
  for (const item of [...items].sort((a, b) => a.id.localeCompare(b.id))) {
    const apps = appAccess(item, catalogue);
    if (!apps) {
      errors.push(`${item.id}: the catalogue doesn't let an app use this piece, so it can't be built`);
      continue;
    }
    const entry = pick(item, ["id", "source"]);
    entry.sourceName = catalogue.get(item.source).name;
    entry.apps = apps;
    Object.assign(entry, pick(item, ["kind", "title", "url", "revision", "permalink", "retrieved", "license", "licenseUrl", "credit", "changes", "text"]));
    // Conditions the source's terms put on a link, so an app can obey them without reading the catalogue's notes.
    const linking = catalogue.get(item.source)?.linking;
    if (item.kind === "link" && linking) entry.linking = pick(linking, ["external", "freeOnly"]);
    if (item.kind === "image") {
      const bytes = readFileSync(join(root, "library", item.file));
      const name = `libraryasset-${sha256(bytes).slice(0, 16)}.${item.file.split(".").pop()}`;
      assets.set(name, bytes);
      entry.image = { file: name, width: item.width, height: item.height, alt: item.alt };
    }
    entry.concepts = [...item.concepts];
    built.push(entry);
    for (const ref of item.concepts) byConcept.set(ref, [...(byConcept.get(ref) ?? []), item.id]);
  }
  if (errors.length) return result;
  const concepts = Object.fromEntries([...byConcept.keys()].sort().map((ref) => [ref, byConcept.get(ref)]));
  const assetNames = [...assets.keys()].sort();
  const revision = sha256(JSON.stringify({ concepts, items: built, assets: assetNames })).slice(0, 16);
  result.revision = revision;
  result.items = built.length;
  result.files.set(INDEX_FILE, json({ formatVersion: FORMAT_VERSION, revision, concepts, items: built }));
  for (const name of assetNames) result.files.set(name, assets.get(name));
  return result;
}

/**
 * The source catalogue as an app reads it, `sources-index.json`: `{ files, sources, errors, revision }`. Only sources an
 * app may show or link to (`apps` show or link) are listed, by id, each with what the app needs to credit it and to
 * offer it for a subject. `subjects` is the bank's subject ids the source is tagged for, empty for a general source.
 */
export function buildSourcesIndex({ root = bankRoot } = {}) {
  const catalogue = loadCatalogue(root);
  const subjects = new Set(existsSync(join(root, "subjects")) ? readdirSync(join(root, "subjects"), { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name) : []);
  const result = { files: new Map(), sources: 0, errors: [], revision: null };
  const sources = [];
  for (const entry of [...catalogue.values()].sort((a, b) => a.id.localeCompare(b.id))) {
    if (!["show", "link"].includes(entry.apps)) continue;
    for (const subject of entry.subjects ?? []) if (!subjects.has(subject)) result.errors.push(`${entry.id}: subjects names “${subject}”, which isn't a subject in the bank`);
    const built = pick(entry, ["id", "name", "url", "license", "licenseUrl", "attribution", "apps"]);
    built.subjects = [...(entry.subjects ?? [])].sort();
    if (entry.linking) built.linking = pick(entry.linking, ["external", "freeOnly"]);
    sources.push(built);
  }
  if (result.errors.length) return result;
  const revision = sha256(JSON.stringify(sources)).slice(0, 16);
  result.revision = revision;
  result.sources = sources.length;
  result.files.set(SOURCES_FILE, json({ formatVersion: FORMAT_VERSION, revision, sources }));
  return result;
}

/** Replaces the built library's files in `dir` with `files`, leaving every other file there alone. */
export function writeBuilt(files, dir) {
  mkdirSync(dir, { recursive: true });
  for (const name of readdirSync(dir)) if (BUILT_FILE.test(name)) rmSync(join(dir, name));
  for (const [name, bytes] of files) writeFileSync(join(dir, name), bytes);
}

/** Writes a new item, and its file, after checking it the way `validate` will. */
export function writeItem(root, item, bytes, { replace = false } = {}) {
  const check = schemaOf(root);
  const errors = check(item) ? [] : check.errors.map((problem) => `${problem.instancePath || "/"} ${problem.message}`);
  if (!errors.length) errors.push(...checkItem(item, { root, catalogue: loadCatalogue(root), concepts: conceptRefs(root), bytes }));
  const path = join(root, "library", "items", `${item.id}.json`);
  if (existsSync(path) && !replace) errors.push(`library/items/${item.id}.json is already there; give --replace to pin it again`);
  if (errors.length) throw new Error(`not pinned, ${item.id}:\n  ${errors.join("\n  ")}`);
  if (replace && existsSync(path)) {
    const old = readJson(path);
    if (old.file && old.file !== item.file) rmSync(join(root, "library", old.file), { force: true });
  }
  if (bytes) {
    mkdirSync(dirname(join(root, "library", item.file)), { recursive: true });
    writeFileSync(join(root, "library", item.file), bytes);
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(item, null, 2) + "\n");
  return path;
}

const api = async (host, params, refs) => {
  const url = `https://${host}/w/api.php?${new URLSearchParams({ ...params, format: "json", formatversion: "2" })}`;
  return await (await politeFetch(url, refs, { accept: "application/json", gapMs: GAP_MS })).json();
};

async function pinWikipedia(title, options) {
  const data = await api(HOSTS.wikipedia, {
    action: "query", titles: title, redirects: "1", prop: "extracts|info", exintro: "1", explaintext: "1", meta: "siteinfo", siprop: "rightsinfo",
  }, options.refs);
  return { item: wikipediaItem(data, options), bytes: null };
}

async function pinCommons(title, options) {
  if (!options.alt) throw new Error(`a picture needs --alt "<what it shows>"`);
  const name = title.startsWith("File:") ? title : `File:${title}`;
  const data = await api(HOSTS["wikimedia-commons"], {
    action: "query", titles: name, redirects: "1", prop: "imageinfo|info", iiprop: "url|size|mime|extmetadata",
    iiextmetadatafilter: [...COMMONS_EVIDENCE, "ObjectName"].join("|"),
  }, options.refs);
  const info = data.query?.pages?.[0]?.imageinfo?.[0];
  if (!info) throw new Error(`Commons has no file called “${name}”`);
  // The original file, from upload.wikimedia.org: Commons' own thumbnails are on a host this tool doesn't reach.
  if (hostOf(info.url) !== HOSTS.upload) throw new Error(`Commons gave the file at ${hostOf(info.url)}, which this tool doesn't reach`);
  if (info.size > MAX_ORIGINAL_BYTES) throw new Error(`the original is ${Math.round(info.size / 1048576)} MB; this tool downloads at most ${MAX_ORIGINAL_BYTES / 1048576} MB`);
  // Check the licence before fetching the picture, so nothing is downloaded that can't be kept.
  commonsLicense(info.extmetadata, info.descriptionurl);
  const original = (await politeFetch(info.url, options.refs, { accept: info.mime, gapMs: GAP_MS })).bytes;
  const { bytes, changes } = fitPicture(original, info.mime);
  return { item: commonsItem(data, bytes, { ...options, changes }), bytes };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  // Node's fetch only goes through a proxy when it is told to, so run again with that set where a proxy is.
  if ((process.env.HTTPS_PROXY || process.env.https_proxy) && !process.env.NODE_USE_ENV_PROXY) {
    const again = spawnSync(process.execPath, process.argv.slice(1), { stdio: "inherit", env: { ...process.env, NODE_USE_ENV_PROXY: "1", NODE_NO_WARNINGS: "1" } });
    process.exit(again.status ?? 1);
  }
  const USAGE = "usage: node tools/library.mjs validate | pin (wikipedia | commons) \"<title>\" --concept <ref>... [--alt \"<words>\"] [--slug <slug>] [--replace] | build [--out <dir>]   [--root <dir>]";
  const args = process.argv.slice(2);
  let root = bankRoot;
  let out = null;
  const options = { concepts: [], replace: false };
  const rest = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--root") root = resolve(args[++i]);
    else if (args[i] === "--out") out = resolve(args[++i]);
    else if (args[i] === "--concept") options.concepts.push(args[++i]);
    else if (args[i] === "--alt") options.alt = args[++i];
    else if (args[i] === "--slug") options.slug = args[++i];
    else if (args[i] === "--replace") options.replace = true;
    else rest.push(args[i]);
  }
  const [command, site, title] = rest;
  try {
    if (command === "validate" && rest.length === 1) {
      const { items, errors } = checkLibrary(root);
      for (const error of errors) console.log(`error: ${error}`);
      console.log(`${items.length} item${items.length === 1 ? "" : "s"}: ${errors.length} error${errors.length === 1 ? "" : "s"}`);
      process.exit(errors.length ? 1 : 0);
    } else if (command === "build" && rest.length === 1) {
      const result = buildLibrary({ root });
      if (result.errors.length) {
        for (const error of result.errors) console.log(`error: ${error}`);
        console.log(`not built: ${result.errors.length} error${result.errors.length === 1 ? "" : "s"}`);
        process.exit(1);
      }
      out ??= join(root, "dist", "library");
      writeBuilt(result.files, out);
      console.log(`wrote ${result.files.size} file${result.files.size === 1 ? "" : "s"} to ${out}: ${result.items} item${result.items === 1 ? "" : "s"}, revision ${result.revision}`);
    } else if (command === "pin" && rest.length === 3 && (site === "wikipedia" || site === "commons")) {
      if (!options.concepts.length) throw new Error("give at least one --concept <subject>/<concept id>");
      const refs = join(root, ".work", "refs");
      mkdirSync(refs, { recursive: true });
      const pinned = await (site === "wikipedia" ? pinWikipedia : pinCommons)(title, { ...options, refs, retrieved: new Date().toISOString().slice(0, 10) });
      const path = writeItem(root, pinned.item, pinned.bytes, options);
      console.log(`pinned ${relative(root, path)}: ${pinned.item.license}, revision ${pinned.item.revision}, ${pinned.item.changes.toLowerCase()}`);
    } else throw new Error(USAGE);
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
