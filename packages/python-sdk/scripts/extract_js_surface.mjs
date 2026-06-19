// AST-based extraction of the @upstash/box public surface, using the TypeScript
// compiler API (stable — not brittle regex). Emits JSON to stdout:
//   { "exports": [...], "Box": [...methods/props], "EphemeralBox": [...] }
//
// Usage: node scripts/extract_js_surface.mjs [path/to/packages/sdk/src]

import { createRequire } from "node:module";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SDK_SRC =
  process.argv[2] || path.resolve(__dirname, "../../sdk/src");

// Load the TypeScript compiler from the JS SDK package.
const require = createRequire(path.join(SDK_SRC, "package.json"));
let ts;
try {
  ts = require("typescript");
} catch {
  ts = require(path.resolve(SDK_SRC, "../node_modules/typescript"));
}

function read(file) {
  return ts.createSourceFile(
    file,
    require("node:fs").readFileSync(file, "utf8"),
    ts.ScriptTarget.Latest,
    true,
  );
}

function isDeprecated(node) {
  const tags = ts.getJSDocTags ? ts.getJSDocTags(node) : [];
  return tags.some((t) => t.tagName && t.tagName.escapedText === "deprecated");
}

function collectExports(file) {
  const sf = read(file);
  const names = new Set();
  sf.forEachChild((node) => {
    if (ts.isExportDeclaration(node) && node.exportClause && ts.isNamedExports(node.exportClause)) {
      for (const el of node.exportClause.elements) {
        // Skip type-only exports — we compare runtime/public symbols.
        if (node.isTypeOnly || el.isTypeOnly) continue;
        names.add(el.name.escapedText);
      }
    }
  });
  return [...names];
}

function collectClassMembers(file, className) {
  const sf = read(file);
  const members = new Set();
  function visit(node) {
    if (ts.isClassDeclaration(node) && node.name && node.name.escapedText === className) {
      for (const m of node.members) {
        if (!m.name || !m.name.escapedText) continue;
        const name = m.name.escapedText;
        if (name.startsWith("_")) continue; // private convention
        if (isDeprecated(m)) continue; // deprecated surface not ported
        const mods = ts.getCombinedModifierFlags(m);
        if (mods & ts.ModifierFlags.Private) continue;
        if (
          ts.isMethodDeclaration(m) ||
          ts.isGetAccessorDeclaration(m) ||
          ts.isPropertyDeclaration(m)
        ) {
          members.add(name);
        }
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(sf);
  return [...members];
}

const out = {
  exports: collectExports(path.join(SDK_SRC, "index.ts")),
  Box: collectClassMembers(path.join(SDK_SRC, "client.ts"), "Box"),
  EphemeralBox: collectClassMembers(path.join(SDK_SRC, "client.ts"), "EphemeralBox"),
};

process.stdout.write(JSON.stringify(out, null, 2));
