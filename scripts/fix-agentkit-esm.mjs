#!/usr/bin/env node
/**
 * Patch script for @goatnetwork/agentkit ESM bug.
 *
 * @goatnetwork/agentkit (as of 0.1.2) ships dist/ with extensionless
 * relative imports, which Node ESM rejects with ERR_MODULE_NOT_FOUND.
 * Upstream issue: https://github.com/GOATNetwork/agentkit/issues/2
 *
 * This script walks the installed agentkit dist/ and rewrites every
 * relative import to include the .js extension. It is idempotent —
 * already-extensioned imports are left alone.
 *
 * Runs automatically via the "postinstall" script in package.json.
 * If the agentkit package isn't installed (e.g. peer dep not chosen),
 * the script exits silently.
 */

import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

// Locate @goatnetwork/agentkit by walking node_modules trees upward.
// We can't use require.resolve because the package's "exports" field doesn't
// expose package.json, and the bug we're patching means import won't work either.
function findAgentkitDist() {
  const candidates = [];
  let dir = join(here, "..");
  while (dir && dir !== "/" && dir.length > 1) {
    candidates.push(join(dir, "node_modules", "@goatnetwork", "agentkit", "dist"));
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  candidates.push(join(process.cwd(), "node_modules", "@goatnetwork", "agentkit", "dist"));
  for (const c of candidates) {
    if (existsSync(c) && statSync(c).isDirectory()) return c;
  }
  return null;
}

const agentkitDist = findAgentkitDist();
if (!agentkitDist) {
  // not installed — silent exit
  process.exit(0);
}

const SENTINEL_PATH = join(agentkitDist, ".esm-patched");
try {
  if (statSync(SENTINEL_PATH).isFile()) {
    // already patched
    process.exit(0);
  }
} catch {
  // not patched yet
}

// Match: from './foo' or from './foo/bar' (no extension, no .js, no node: scheme).
// Skip: already .js, .json, .mjs, .cjs, .d.ts, .css, or node:/scoped/bare imports.
const importRe = /(\b(?:from|import|export)\s*(?:\(\s*)?["'])(\.\.?\/[^"']*?)(["'])/g;

const exts = new Set([".js", ".json", ".mjs", ".cjs", ".d.ts", ".css"]);

function hasExtension(spec) {
  // get final segment after last '/'
  const tail = spec.split("/").pop();
  const dot = tail.lastIndexOf(".");
  if (dot <= 0) return false;
  return exts.has(tail.slice(dot));
}

function patchSpec(spec, fromFile) {
  if (hasExtension(spec)) return spec;
  // Decide between adding .js directly or treating it as a directory → index.js
  // Resolve relative to fromFile's directory to check.
  const targetBase = join(dirname(fromFile), spec);
  try {
    const s = statSync(targetBase);
    if (s.isDirectory()) return spec + "/index.js";
  } catch {
    // not a directory
  }
  try {
    const sJs = statSync(targetBase + ".js");
    if (sJs.isFile()) return spec + ".js";
  } catch {
    // not a .js file
  }
  // fallback: assume .js
  return spec + ".js";
}

function walk(dir, list = []) {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    const s = statSync(p);
    if (s.isDirectory()) walk(p, list);
    else if (s.isFile() && (p.endsWith(".js") || p.endsWith(".d.ts")))
      list.push(p);
  }
  return list;
}

let patchedFiles = 0;
let patchedImports = 0;

for (const file of walk(agentkitDist)) {
  const src = readFileSync(file, "utf8");
  let touched = false;
  const out = src.replace(importRe, (_, prefix, spec, suffix) => {
    const newSpec = patchSpec(spec, file);
    if (newSpec !== spec) {
      touched = true;
      patchedImports++;
      return prefix + newSpec + suffix;
    }
    return prefix + spec + suffix;
  });
  if (touched) {
    writeFileSync(file, out);
    patchedFiles++;
  }
}

writeFileSync(SENTINEL_PATH, `patched ${new Date().toISOString()}: ${patchedFiles} files, ${patchedImports} imports\n`);
console.error(
  `@goatnetwork/agentkit ESM patch: rewrote ${patchedImports} imports across ${patchedFiles} files. ` +
    `Upstream issue: https://github.com/GOATNetwork/agentkit/issues/2`,
);
