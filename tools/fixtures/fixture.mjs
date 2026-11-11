// Gives each test its own copy of the fixture bank, with the real schemas, so tests can change it freely.

import { cpSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
export const toolsDir = dirname(here);
export const realRoot = dirname(toolsDir);

/** A new folder holding the fixture bank and the real schema/, for one test to use. */
export function fixtureRoot() {
  const root = mkdtempSync(join(tmpdir(), "bank-test-"));
  cpSync(join(here, "bank"), root, { recursive: true });
  cpSync(join(realRoot, "schema"), join(root, "schema"), { recursive: true });
  return root;
}

export const cellsFile = (root) => join(root, "subjects", "testing", "cells", "pack.json");
export const readPack = (root) => JSON.parse(readFileSync(cellsFile(root), "utf8"));

/** Changes the cells pack's pack.json through `change(data)`. */
export function editPack(root, change, file = cellsFile(root)) {
  const data = JSON.parse(readFileSync(file, "utf8"));
  change(data);
  writeFileSync(file, JSON.stringify(data, null, 2) + "\n");
}
