// Regenerates src/version.ts from package.json so the version reported by
// telemetry can never drift from the published version. Runs from ci:version
// (Version Packages PRs), the canary/publish workflows after version bumps,
// and prepublishOnly as a safety net for manual publishes.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const { version } = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const content = `// Generated from package.json by scripts/gen-version.mjs — do not edit.\nexport const VERSION = "${version}";\n`;
writeFileSync(join(root, "src", "version.ts"), content);
