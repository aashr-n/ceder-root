// Renders an SVG to a PNG 1200 pixels wide, the way the build does, so a diagram can be looked at while it's drawn.
//
//   node tools/render.mjs assets/cell.svg /tmp/cell.png
//
// Text is always set in the DejaVu Sans that sits in tools/fonts/, whatever fonts the machine has, so the same SVG
// gives the same PNG everywhere and the app's copy of the bank can be checked against a fresh build in CI.

import { Resvg } from "@resvg/resvg-js";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const DIAGRAM_WIDTH = 1200;

const fonts = join(dirname(fileURLToPath(import.meta.url)), "fonts");
const FONT = {
  loadSystemFonts: false,
  fontFiles: [join(fonts, "DejaVuSans.ttf"), join(fonts, "DejaVuSans-Bold.ttf")],
  defaultFontFamily: "DejaVu Sans",
  sansSerifFamily: "DejaVu Sans",
  serifFamily: "DejaVu Sans",
  monospaceFamily: "DejaVu Sans",
};

/** An SVG's PNG bytes and size in pixels. */
export function renderSvg(svg, width = DIAGRAM_WIDTH) {
  const image = new Resvg(svg, { fitTo: { mode: "width", value: width }, font: FONT }).render();
  return { png: image.asPng(), width: image.width, height: image.height };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [source, target] = process.argv.slice(2);
  if (!source || !target) {
    console.error("usage: node tools/render.mjs <file.svg> <file.png>");
    process.exit(2);
  }
  const { png, width, height } = renderSvg(readFileSync(source, "utf8"));
  writeFileSync(target, png);
  console.log(`${target}: ${width} by ${height}`);
}
