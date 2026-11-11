import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { deflateSync } from "node:zlib";
import {
  MAX_TEXT, PUBLIC_DOMAIN, buildLibrary, checkLibrary, commonsItem, commonsLicense, fitPicture, imageSize, leadText, licenseFromUrl,
  licenseName, notPlain, storable, wikipediaItem, writeItem,
} from "./library.mjs";
import { fixtureRoot, realRoot, toolsDir } from "./fixtures/fixture.mjs";

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const run = (args) => spawnSync(process.execPath, [join(toolsDir, "library.mjs"), ...args], { encoding: "utf8", env: { ...process.env, HTTPS_PROXY: "", https_proxy: "" } });

/** A real, tiny PNG of the given size. */
function png(width, height) {
  const chunk = (type, data) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
    let crc = ~0;
    for (const byte of body) { crc ^= byte; for (let k = 0; k < 8; k++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1)); }
    const sum = Buffer.alloc(4);
    sum.writeUInt32BE(~crc >>> 0);
    return Buffer.concat([length, body, sum]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 0, 0, 0, 0], 8);
  const rows = Buffer.alloc((width + 1) * height);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", header), chunk("IDAT", deflateSync(rows)), chunk("IEND", Buffer.alloc(0))]);
}

const checked = { date: "2026-11-11", evidence: [{ url: "https://terms.example.org", quote: "The source's own terms." }] };
const ENTRIES = {
  wikipedia: {
    id: "wikipedia", name: "Wikipedia", url: "https://en.wikipedia.org", goodFor: "Leads.", license: "CC-BY-SA-4.0", apps: "show", bank: "read", attribution: "Title, link, licence.", checked, notes: "Fixture.",
    parts: [
      { id: "text", name: "Text", license: "CC-BY-SA-4.0", apps: "show", attribution: "Title, link, licence.", checked, notes: "Fixture." },
      { id: "media", name: "Pictures", license: "per-item", apps: "link", checked, notes: "Fixture." },
    ],
  },
  "wikimedia-commons": { id: "wikimedia-commons", name: "Commons", url: "https://commons.wikimedia.org", goodFor: "Pictures.", license: "per-item", apps: "link", bank: "none", checked, notes: "Fixture." },
  "per-file": { id: "per-file", name: "Per file", url: "https://per-file.example.org", goodFor: "Pictures.", license: "per-item", apps: "link", bank: "none", checked, notes: "Fixture." },
  pictures: { id: "pictures", name: "Pictures", url: "https://pictures.example.org", goodFor: "Pictures.", license: "CC-BY-4.0", apps: "show", bank: "none", attribution: "The author.", checked, notes: "Fixture." },
  banned: { id: "banned", name: "Banned", url: "https://banned.example.org", goodFor: "Nothing.", license: "CC-BY-NC-4.0", apps: "none", bank: "none", checked, notes: "Fixture." },
  unchecked: { id: "unchecked", name: "Unchecked", url: "https://unchecked.example.org", goodFor: "Text.", license: "CC-BY-4.0", apps: "show", bank: "none", attribution: "Credit.", checked: null, notes: "Fixture." },
  courses: { id: "courses", name: "Courses", url: "https://courses.example.org", goodFor: "Courses.", license: "CC-BY-NC-SA-4.0", apps: "link", bank: "none", checked, linking: { external: true, freeOnly: true }, notes: "Fixture." },
  mine: { id: "mine", name: "A student's files", goodFor: "Their own.", license: "per-item", apps: "private", bank: "none", checked: null, notes: "Fixture." },
};

const textItem = (change = {}) => ({
  id: "wikipedia/cell", source: "wikipedia", part: "text", kind: "text", title: "Cell (biology)", url: "https://en.wikipedia.org/wiki/Cell_(biology)",
  revision: 42, permalink: "https://en.wikipedia.org/w/index.php?title=Cell_(biology)&oldid=42", retrieved: "2026-11-11",
  license: "CC-BY-SA-4.0", licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0/",
  credit: { authors: "Wikipedia contributors", line: "“Cell (biology)” by Wikipedia contributors. Plain text of the lead section. Offered under CC BY-SA 4.0." },
  changes: "Plain text of the lead section", text: "The cell is the basic unit of life.", concepts: ["testing/cell"], ...change,
});

/** A fixture bank with a catalogue, the real item schema, one text item, one picture and one link. */
function libraryRoot() {
  const root = fixtureRoot();
  mkdirSync(join(root, "sources", "entries"), { recursive: true });
  for (const entry of Object.values(ENTRIES)) writeFileSync(join(root, "sources", "entries", `${entry.id}.json`), JSON.stringify(entry));
  mkdirSync(join(root, "library"), { recursive: true });
  cpSync(join(realRoot, "library", "item.schema.json"), join(root, "library", "item.schema.json"));
  put(root, textItem());
  const picture = png(40, 30);
  mkdirSync(join(root, "library", "files", "pictures"), { recursive: true });
  writeFileSync(join(root, "library", "files", "pictures", "cell.png"), picture);
  put(root, {
    id: "pictures/cell", source: "pictures", kind: "image", title: "A cell", url: "https://pictures.example.org/cell", retrieved: "2026-11-11",
    license: "CC-BY-4.0", licenseUrl: "https://creativecommons.org/licenses/by/4.0/", credit: { authors: "A. Painter", line: "“A cell” by A. Painter, CC BY 4.0" },
    changes: "Not changed", file: "files/pictures/cell.png", sha256: sha256(picture), width: 40, height: 30, alt: "A round cell with a dark nucleus.",
    concepts: ["testing/cell", "testing/organelle"],
  });
  put(root, { id: "courses/cells", source: "courses", kind: "link", title: "Cells", url: "https://courses.example.org/cells", retrieved: "2026-11-11", concepts: ["testing/cell"] });
  return root;
}

function put(root, item) {
  const [source, name] = item.id.split("/");
  mkdirSync(join(root, "library", "items", source), { recursive: true });
  writeFileSync(join(root, "library", "items", source, `${name}.json`), JSON.stringify(item, null, 2));
}
const errorsWith = (root, item) => { put(root, item); return checkLibrary(root).errors; };

test("the fixture library is valid", () => {
  const { items, errors } = checkLibrary(libraryRoot());
  assert.deepEqual(errors, []);
  assert.equal(items.length, 3);
});

test("only CC0, public domain, CC BY and CC BY-SA may be stored", () => {
  for (const license of ["CC0-1.0", PUBLIC_DOMAIN, "CC-BY-4.0", "CC-BY-SA-4.0", "CC-BY-SA-3.0", "CC-BY-2.5", "CC-BY-SA-3.0-DE"]) assert.ok(storable(license), license);
  for (const license of ["CC-BY-NC-4.0", "CC-BY-NC-SA-4.0", "CC-BY-ND-4.0", "CC-BY-NC-ND-4.0", "unknown", "per-item", "GFDL-1.3", "MIT", ""]) assert.ok(!storable(license), license);
});

test("licences are read from Creative Commons addresses only", () => {
  assert.equal(licenseFromUrl("https://creativecommons.org/licenses/by-sa/4.0/"), "CC-BY-SA-4.0");
  assert.equal(licenseFromUrl("https://creativecommons.org/licenses/by-sa/4.0/deed.en"), "CC-BY-SA-4.0");
  assert.equal(licenseFromUrl("http://creativecommons.org/licenses/by/3.0/de"), "CC-BY-3.0-DE");
  assert.equal(licenseFromUrl("https://creativecommons.org/publicdomain/zero/1.0/"), "CC0-1.0");
  assert.equal(licenseFromUrl("https://creativecommons.org/publicdomain/mark/1.0/"), PUBLIC_DOMAIN);
  assert.equal(licenseFromUrl("https://creativecommons.org/licenses/by-nc-sa/4.0/"), null);
  assert.equal(licenseFromUrl("https://www.gnu.org/copyleft/fdl.html"), null);
  assert.equal(licenseName("CC-BY-SA-4.0"), "CC BY-SA 4.0");
  assert.equal(licenseName("CC-BY-3.0-DE"), "CC BY 3.0 DE");
});

test("text may be stored only from a source the apps may show, whose licence was checked, under its source's licence", () => {
  const root = libraryRoot();
  put(root, textItem());
  assert.match(errorsWith(root, textItem({ id: "unchecked/cell", source: "unchecked", part: undefined, url: "https://unchecked.example.org/cell", permalink: undefined, revision: undefined, license: "CC-BY-4.0", licenseUrl: "https://creativecommons.org/licenses/by/4.0/" })).join("\n"), /nobody has checked “unchecked”/);
  rmSync(join(root, "library", "items", "unchecked"), { recursive: true });
  const fromCourses = errorsWith(root, textItem({ id: "courses/cell", source: "courses", part: undefined, url: "https://courses.example.org/cell", revision: undefined, permalink: undefined, license: "CC-BY-NC-SA-4.0", licenseUrl: "https://creativecommons.org/licenses/by-nc-sa/4.0/" })).join("\n");
  assert.match(fromCourses, /apps may only link to “courses”: make it a link/);
  assert.match(fromCourses, /isn't one the library may store/);
  rmSync(join(root, "library", "items", "courses", "cell.json"));
  assert.match(errorsWith(root, textItem({ license: "CC-BY-4.0", licenseUrl: "https://creativecommons.org/licenses/by/4.0/" })).join("\n"), /isn't “wikipedia”'s part “text”'s, CC-BY-SA-4.0/);
  assert.match(errorsWith(root, textItem({ licenseUrl: "https://creativecommons.org/licenses/by/4.0/" })).join("\n"), /isn't the address of CC-BY-SA-4.0/);
});

test("a source checked part by part is governed by the part an item names", () => {
  const root = libraryRoot();
  assert.match(errorsWith(root, textItem({ part: undefined })).join("\n"), /checked part by part \(text, media\): name the one/);
  assert.match(errorsWith(root, textItem({ part: "maps" })).join("\n"), /has no part “maps”/);
  put(root, textItem());
  // A picture in an article is under its own file's licence, and only Commons' files can be read and checked.
  const picture = png(40, 30);
  mkdirSync(join(root, "library", "files", "wikipedia"), { recursive: true });
  writeFileSync(join(root, "library", "files", "wikipedia", "cell.png"), picture);
  const image = { id: "wikipedia/cell-picture", source: "wikipedia", part: "media", kind: "image", title: "Cell", url: "https://en.wikipedia.org/wiki/File:Cell.png", revision: 1, permalink: "https://en.wikipedia.org/w/index.php?title=File:Cell.png&oldid=1", retrieved: "2026-11-11", license: "CC-BY-SA-4.0", licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0/", credit: { authors: "Someone", line: "Someone, CC BY-SA 4.0" }, changes: "Not changed", file: "files/wikipedia/cell.png", sha256: sha256(picture), width: 40, height: 30, alt: "A cell.", concepts: ["testing/cell"] };
  assert.match(errorsWith(root, image).join("\n"), /can't read and check a piece's licence there: make it a link/);
  assert.match(errorsWith(root, { ...image, part: "text" }).join("\n"), /can't read and check a piece's licence there/);
});

test("a source the apps may not use at all may not even have a link", () => {
  const root = libraryRoot();
  assert.match(errorsWith(root, { id: "banned/page", source: "banned", kind: "link", title: "Page", url: "https://banned.example.org/page", retrieved: "2026-11-11", concepts: ["testing/cell"] }).join("\n"), /may not use “banned” at all, not even with a link/);
});

const commonsMeta = { LicenseShortName: "CC BY-SA 3.0", LicenseUrl: "https://creativecommons.org/licenses/by-sa/3.0", License: "cc-by-sa-3.0", Artist: "<a href=\"//commons.wikimedia.org/wiki/User:Someone\">Someone</a>" };
function commonsRoot() {
  const root = libraryRoot();
  const picture = png(40, 30);
  mkdirSync(join(root, "library", "files", "wikimedia-commons"), { recursive: true });
  writeFileSync(join(root, "library", "files", "wikimedia-commons", "cell.png"), picture);
  const url = "https://commons.wikimedia.org/wiki/File:Cell.svg";
  const item = {
    id: "wikimedia-commons/cell", source: "wikimedia-commons", kind: "image", title: "Cell", url, revision: 5, permalink: "https://commons.wikimedia.org/w/index.php?title=File%3ACell.svg&oldid=5", retrieved: "2026-11-11",
    license: "CC-BY-SA-3.0", licenseUrl: "https://creativecommons.org/licenses/by-sa/3.0/", credit: { authors: "Someone", line: "“Cell” by Someone, via Wikimedia Commons. Rendered from SVG as a PNG 40 pixels wide. CC BY-SA 3.0." },
    changes: "Rendered from SVG as a PNG 40 pixels wide", file: "files/wikimedia-commons/cell.png", sha256: sha256(picture), width: 40, height: 30, alt: "A cell.",
    evidence: { url, metadata: { ...commonsMeta } }, concepts: ["testing/cell"],
  };
  put(root, item);
  return { root, item };
}

test("a Commons file is stored only with its file page's evidence, which must give the licence and credit it claims", () => {
  const { root, item } = commonsRoot();
  assert.deepEqual(checkLibrary(root).errors, []);
  assert.match(errorsWith(root, { ...item, evidence: undefined }).join("\n"), /needs the evidence its file page gave/);
  assert.match(errorsWith(root, { ...item, evidence: { url: item.url, metadata: { ...commonsMeta, LicenseUrl: "https://creativecommons.org/licenses/by-nc/3.0" } } }).join("\n"), /doesn't give a licence the library may store/);
  assert.match(errorsWith(root, { ...item, license: "CC-BY-4.0", licenseUrl: "https://creativecommons.org/licenses/by/4.0/", credit: { ...item.credit, line: item.credit.line.replace("CC BY-SA 3.0", "CC BY 4.0") } }).join("\n"), /evidence gives CC-BY-SA-3\.0/);
  assert.match(errorsWith(root, { ...item, evidence: { url: item.url, metadata: { ...commonsMeta, Restrictions: "personality" } } }).join("\n"), /notes restrictions \(personality\)/);
  assert.match(errorsWith(root, { ...item, credit: { authors: "Someone else", line: item.credit.line } }).join("\n"), /aren't the ones its evidence names, “Someone”/);
  assert.match(errorsWith(root, { ...item, evidence: { url: "https://commons.wikimedia.org/wiki/File:Other.svg", metadata: commonsMeta } }).join("\n"), /not its own file page/);
  // Another source licensed file by file has no reader, so its files can only be links.
  rmSync(join(root, "library", "items", "wikimedia-commons"), { recursive: true });
  mkdirSync(join(root, "library", "files", "per-file"), { recursive: true });
  cpSync(join(root, "library", "files", "wikimedia-commons", "cell.png"), join(root, "library", "files", "per-file", "cell.png"));
  rmSync(join(root, "library", "files", "wikimedia-commons"), { recursive: true });
  assert.match(errorsWith(root, { ...item, id: "per-file/cell", source: "per-file", url: "https://per-file.example.org/cell", revision: undefined, permalink: undefined, file: "files/per-file/cell.png" }).join("\n"), /can't read and check/);
});

test("a credit line names the licence and says what was changed", () => {
  const root = libraryRoot();
  assert.match(errorsWith(root, textItem({ credit: { authors: "Wikipedia contributors", line: "“Cell (biology)” by Wikipedia contributors. Plain text of the lead section." } })).join("\n"), /doesn't name its licence, “CC BY-SA 4\.0”/);
  assert.match(errorsWith(root, textItem({ credit: { authors: "Wikipedia contributors", line: "“Cell (biology)” by Wikipedia contributors, CC BY-SA 4.0" } })).join("\n"), /doesn't say what was changed/);
});

test("a source dropped from the catalogue can't have even a link", () => {
  const root = libraryRoot();
  rmSync(join(root, "sources", "entries", "courses.json"));
  assert.match(checkLibrary(root).errors.join("\n"), /courses\/cells\.json: its source “courses” isn't in sources\/entries\//);
});

test("anything else an item stores, or a source that isn't in the catalogue, is an error", () => {
  const root = libraryRoot();
  assert.match(errorsWith(root, textItem({ credit: undefined })).join("\n"), /asks for credit/);
  assert.match(errorsWith(root, textItem({ revision: undefined, permalink: undefined })).join("\n"), /it's from a wiki/);
  assert.match(errorsWith(root, textItem({ permalink: "https://en.wikipedia.org/w/index.php?title=Cell&oldid=41" })).join("\n"), /permalink isn't to revision 42/);
  assert.match(errorsWith(root, textItem({ text: "x".repeat(MAX_TEXT + 1) })).join("\n"), /at most 1000/);
  assert.match(errorsWith(root, textItem({ text: "The '''cell''' is [[life]]." })).join("\n"), /isn't plain/);
  assert.match(errorsWith(root, textItem({ concepts: ["testing/nothing"] })).join("\n"), /concept “testing\/nothing” isn't in the bank/);
  assert.match(errorsWith(root, textItem({ url: "https://elsewhere.example.org/cell" })).join("\n"), /its url is on elsewhere\.example\.org/);
  put(root, textItem());
  put(root, { id: "nowhere/cell", source: "nowhere", kind: "link", title: "Cells", url: "https://nowhere.example.org", retrieved: "2026-11-11", concepts: ["testing/cell"] });
  assert.match(checkLibrary(root).errors.join("\n"), /source “nowhere” isn't in sources\/entries/);
});

test("a link stores only a title and an address, and a student's own files never go in", () => {
  const root = libraryRoot();
  const link = { id: "courses/cells", source: "courses", kind: "link", title: "Cells", url: "https://courses.example.org/cells", retrieved: "2026-11-11", concepts: ["testing/cell"] };
  assert.match(errorsWith(root, { ...link, text: "Copied." }).join("\n"), /must NOT be valid/);
  assert.match(errorsWith(root, { ...link, license: "CC-BY-NC-SA-4.0" }).join("\n"), /must NOT be valid/);
  put(root, link);
  put(root, { ...link, id: "mine/notes", source: "mine", url: "https://files.example.org/notes" });
  assert.match(checkLibrary(root).errors.join("\n"), /a student's own files/);
});

test("a picture's file must match its hash and size, and a stray file is an error", () => {
  const root = libraryRoot();
  const file = join(root, "library", "files", "pictures", "cell.png");
  writeFileSync(file, png(41, 30));
  const errors = checkLibrary(root).errors.join("\n");
  assert.match(errors, /SHA-256 isn't the item's sha256/);
  assert.match(errors, /is 41 by 30, not 40 by 30/);
  rmSync(file);
  assert.match(checkLibrary(root).errors.join("\n"), /library\/files\/pictures\/cell\.png is missing/);
  writeFileSync(file, png(40, 30));
  writeFileSync(join(root, "library", "files", "pictures", "stray.png"), png(2, 2));
  assert.deepEqual(checkLibrary(root).errors, ["library/files/pictures/stray.png: no item names this file"]);
});

test("an item's id must be its folder and file name", () => {
  const root = libraryRoot();
  writeFileSync(join(root, "library", "items", "wikipedia", "other.json"), JSON.stringify(textItem({ id: "wikipedia/cell" })));
  const errors = checkLibrary(root).errors.join("\n");
  assert.match(errors, /other\.json: its id, “wikipedia\/cell”, isn't its folder and file name/);
  assert.match(errors, /another item has the id “wikipedia\/cell”/);
});

test("imageSize reads PNG and JPEG headers, and nothing else", () => {
  assert.deepEqual(imageSize(png(800, 600)), { type: "png", width: 800, height: 600 });
  // SOI, an APP0 segment, then a baseline start-of-frame for 300 by 200.
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0xc8, 0x01, 0x2c, 0x03, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  assert.deepEqual(imageSize(jpeg), { type: "jpg", width: 300, height: 200 });
  assert.equal(imageSize(Buffer.from("GIF89a........................")), null);
});

test("leadText keeps whole paragraphs, or else whole sentences, and says what it did", () => {
  assert.deepEqual(leadText("One.\nTwo."), { text: "One.\n\nTwo.", changes: "Plain text of the lead section" });
  const long = "A".repeat(600) + ".";
  assert.deepEqual(leadText(`First paragraph.\n${long}\n${long}`), { text: `First paragraph.\n\n${long}`, changes: "Plain text of the lead section, shortened to its first 2 paragraphs" });
  const sentences = `Cells are small. ${"Word ".repeat(150)}end. ${"More ".repeat(150)}end.`;
  const cut = leadText(sentences);
  assert.equal(cut.changes, "Plain text of the lead section, shortened to its first 2 sentences");
  assert.ok(cut.text.length <= MAX_TEXT && cut.text.startsWith("Cells are small. Word"));
  assert.equal(leadText("x".repeat(MAX_TEXT + 1)), null);
  assert.equal(leadText("Water ( ) is wet , mostly.").text, "Water is wet, mostly.");
  assert.equal(leadText("A prokaryote (; from Greek) is a cell.").text, "A prokaryote (from Greek) is a cell.");
  assert.equal(notPlain("Plain.\n\nText."), null);
});

const wikipediaAnswer = (extract) => ({
  query: {
    pages: [{ pageid: 1, title: "Cell (biology)", lastrevid: 1234, extract }],
    rightsinfo: { url: "https://creativecommons.org/licenses/by-sa/4.0/deed.en", text: "Creative Commons Attribution-Share Alike 4.0" },
  },
});

test("a Wikipedia item takes its licence and revision from the answer, or isn't made", () => {
  const item = wikipediaItem(wikipediaAnswer("The cell is the basic unit of life.\nCells were first seen in 1665."), { concepts: ["testing/cell"], retrieved: "2026-11-11" });
  assert.deepEqual(item, {
    id: "wikipedia/cell-biology", source: "wikipedia", part: "text", kind: "text", title: "Cell (biology)", url: "https://en.wikipedia.org/wiki/Cell_(biology)",
    revision: 1234, permalink: "https://en.wikipedia.org/w/index.php?title=Cell_%28biology%29&oldid=1234", retrieved: "2026-11-11",
    license: "CC-BY-SA-4.0", licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0/",
    credit: { authors: "Wikipedia contributors", line: "“Cell (biology)” by Wikipedia contributors. Plain text of the lead section. Offered under CC BY-SA 4.0." },
    changes: "Plain text of the lead section", text: "The cell is the basic unit of life.\n\nCells were first seen in 1665.", concepts: ["testing/cell"],
  });
  const noLicence = wikipediaAnswer("Text.");
  delete noLicence.query.rightsinfo;
  assert.throws(() => wikipediaItem(noLicence, { concepts: [], retrieved: "2026-11-11" }), /didn't say which licence/);
  assert.throws(() => wikipediaItem({ query: { pages: [{ title: "Nope", missing: true }] } }, { concepts: [] }), /no such article/);
});

const commonsAnswer = (meta) => ({
  query: {
    pages: [{
      title: "File:Animal cell.svg", lastrevid: 777,
      imageinfo: [{ width: 2000, height: 1500, descriptionurl: "https://commons.wikimedia.org/wiki/File:Animal_cell.svg", thumburl: "https://upload.wikimedia.org/x.png", extmetadata: meta }],
    }],
  },
});
const value = (text) => ({ value: text });

test("a Commons file's licence and author come from its metadata, or it isn't pinned", () => {
  const meta = { LicenseUrl: value("https://creativecommons.org/licenses/by-sa/3.0"), LicenseShortName: value("CC BY-SA 3.0"), Artist: value("<a href=\"//commons.wikimedia.org/wiki/User:Someone\">Someone</a>"), ObjectName: value("Animal cell") };
  const picture = png(800, 600);
  const item = commonsItem(commonsAnswer(meta), picture, { concepts: ["testing/cell"], retrieved: "2026-11-11", alt: "An animal cell.", changes: "Rendered from SVG as a PNG 800 pixels wide" });
  assert.equal(item.id, "wikimedia-commons/animal-cell");
  assert.equal(item.license, "CC-BY-SA-3.0");
  assert.deepEqual(item.credit, { authors: "Someone", line: "“Animal cell” by Someone, via Wikimedia Commons. Rendered from SVG as a PNG 800 pixels wide. CC BY-SA 3.0." });
  assert.equal(item.licenseUrl, "https://creativecommons.org/licenses/by-sa/3.0/");
  assert.deepEqual(item.evidence, { url: "https://commons.wikimedia.org/wiki/File:Animal_cell.svg", metadata: { LicenseShortName: "CC BY-SA 3.0", LicenseUrl: "https://creativecommons.org/licenses/by-sa/3.0", Artist: meta.Artist.value } });
  assert.equal(item.changes, "Rendered from SVG as a PNG 800 pixels wide");
  assert.deepEqual([item.file, item.sha256, item.width, item.height], ["files/wikimedia-commons/animal-cell.png", sha256(picture), 800, 600]);
  assert.equal(item.permalink, "https://commons.wikimedia.org/w/index.php?title=File%3AAnimal_cell.svg&oldid=777");

  assert.throws(() => commonsLicense({ LicenseUrl: value("https://creativecommons.org/licenses/by-nc/2.0"), LicenseShortName: value("CC BY-NC 2.0") }), /isn't one this library takes/);
  assert.throws(() => commonsLicense({ LicenseShortName: value("GFDL") }), /no licence this library takes/);
  assert.deepEqual(commonsLicense({ License: value("pd"), Copyrighted: value("False") }, "https://commons.wikimedia.org/wiki/File:X.png"), { license: PUBLIC_DOMAIN, licenseUrl: "https://commons.wikimedia.org/wiki/File:X.png" });
  assert.throws(() => commonsItem(commonsAnswer({ LicenseUrl: meta.LicenseUrl }), picture, { concepts: [], alt: "x" }), /names no author/);
});

test("fitPicture renders an SVG, scales down a wide picture, and keeps one that fits", () => {
  const svg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 90"><rect width="120" height="90" fill="#123456"/></svg>`);
  const rendered = fitPicture(svg, "image/svg+xml");
  assert.deepEqual(imageSize(rendered.bytes), { type: "png", width: 800, height: 600 });
  assert.equal(rendered.changes, "Rendered from SVG as a PNG 800 pixels wide");
  const small = png(300, 200);
  assert.deepEqual(fitPicture(small, "image/png"), { bytes: small, changes: "Not changed" });
  const wide = fitPicture(png(1600, 1000), "image/png");
  assert.deepEqual(imageSize(wide.bytes), { type: "png", width: 800, height: 500 });
  assert.equal(wide.changes, "Scaled down to 800 pixels wide");
  assert.throws(() => fitPicture(Buffer.from("GIF89a"), "image/gif"), /stores PNG and JPEG/);
});

test("pinning refuses what validate would refuse, and writes nothing", () => {
  const root = libraryRoot();
  const picture = png(30, 20);
  const item = { id: "courses/picture", source: "courses", kind: "image", title: "A picture", url: "https://courses.example.org/p", retrieved: "2026-11-11", license: "CC-BY-4.0", licenseUrl: "https://creativecommons.org/licenses/by/4.0/", credit: { authors: "X", line: "X" }, changes: "Not changed", file: "files/courses/picture.png", sha256: sha256(picture), width: 30, height: 20, alt: "A picture.", concepts: ["testing/cell"] };
  assert.throws(() => writeItem(root, item, picture), /not pinned, courses\/picture:\n.*make it a link/);
  assert.deepEqual(readdirSync(join(root, "library", "files")), ["pictures"]);
  assert.throws(() => writeItem(root, textItem(), null), /already there; give --replace/);
  writeItem(root, textItem({ text: "Changed." }), null, { replace: true });
  assert.deepEqual(checkLibrary(root).errors, []);
});

test("the build lists items by concept, with text and credit inline and pictures named by their hash", () => {
  const root = libraryRoot();
  const result = buildLibrary({ root });
  assert.deepEqual(result.errors, []);
  const names = [...result.files.keys()];
  const asset = names.find((name) => name.startsWith("libraryasset-"));
  assert.deepEqual(names, ["library-index.json", asset]);
  assert.equal(asset, `libraryasset-${sha256(result.files.get(asset)).slice(0, 16)}.png`);
  const index = JSON.parse(result.files.get("library-index.json"));
  assert.deepEqual(Object.keys(index), ["formatVersion", "revision", "concepts", "items"]);
  assert.deepEqual(index.concepts, { "testing/cell": ["courses/cells", "pictures/cell", "wikipedia/cell"], "testing/organelle": ["pictures/cell"] });
  const [link, picture, text] = index.items;
  assert.deepEqual(link, { id: "courses/cells", source: "courses", kind: "link", title: "Cells", url: "https://courses.example.org/cells", retrieved: "2026-11-11", linking: { external: true, freeOnly: true } });
  // Only a link carries its source's linking conditions.
  assert.ok(!("linking" in text) && !("linking" in picture));
  assert.deepEqual(picture.image, { file: asset, width: 40, height: 30, alt: "A round cell with a dark nucleus." });
  assert.ok(!("sha256" in picture) && !("concepts" in picture));
  assert.equal(text.text, "The cell is the basic unit of life.");
  assert.equal(text.credit.line, "“Cell (biology)” by Wikipedia contributors. Plain text of the lead section. Offered under CC BY-SA 4.0.");
  assert.ok(!("evidence" in text) && !("part" in text));
  // The same source gives the same bytes.
  const again = buildLibrary({ root });
  for (const [name, bytes] of result.files) assert.ok(again.files.get(name).equals(bytes), name);
});

test("the command line validates, builds into a folder, and builds nothing when there are errors", () => {
  const root = libraryRoot();
  const out = mkdtempSync(join(tmpdir(), "library-out-"));
  writeFileSync(join(out, "keep.txt"), "not ours");
  writeFileSync(join(out, "libraryasset-0000000000000000.png"), "old");
  assert.equal(run(["validate", "--root", root]).status, 0);
  const built = run(["build", "--root", root, "--out", out]);
  assert.equal(built.status, 0, built.stdout + built.stderr);
  assert.match(built.stdout, /wrote 2 files .*: 3 items/);
  assert.equal(readdirSync(out).filter((name) => name !== "keep.txt").length, 2);
  assert.equal(readFileSync(join(out, "keep.txt"), "utf8"), "not ours");
  put(root, textItem({ concepts: ["testing/nothing"] }));
  assert.equal(run(["validate", "--root", root]).status, 1);
  const failed = run(["build", "--root", root, "--out", out]);
  assert.equal(failed.status, 1);
  assert.match(failed.stdout, /not built: 1 error/);
});

test("the repository's own library is valid", () => {
  assert.deepEqual(checkLibrary(realRoot).errors, []);
});
