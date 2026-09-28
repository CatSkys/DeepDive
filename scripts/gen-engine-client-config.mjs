// Bring engine/tsconfig.client.json in line with what this fork actually has.
//
// Same rule as gen-engine-host-include.mjs, for the client face: the upstream
// file is correct against the whole monorepo, so copy it verbatim and drop only
// entries whose target is genuinely absent (apps/web and its tests, the desktop
// apps). Rewriting more than that reproduces the failure modes documented in
// the host generator's header.
//
// Usage:
//   gen-engine-client-config.mjs          # rewrite engine/tsconfig.client.json
//   gen-engine-client-config.mjs --check  # fail if stale
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const ENGINE = join(ROOT, "engine");
const CONFIG = join(ENGINE, "tsconfig.client.json");
const UPSTREAM = join(ROOT, "deepseek-harness/tsconfig.client.json");
const check = process.argv.includes("--check");

const raw = readFileSync(CONFIG, "utf8");
const upstream = readFileSync(UPSTREAM, "utf8");

const readArray = (text, key) => {
  const at = text.indexOf(`"${key}"`);
  if (at === -1) return null;
  const open = text.indexOf("[", at);
  let depth = 0, close = -1;
  for (let i = open; i < text.length; i++) {
    if (text[i] === "[") depth++;
    else if (text[i] === "]") { depth--; if (depth === 0) { close = i; break; } }
  }
  if (close === -1) return null;
  return [...text.slice(open + 1, close).matchAll(/"([^"]+)"/g)].map((m) => m[1]);
};

const writeArray = (text, key, entries) => {
  const at = text.indexOf(`"${key}"`);
  const open = text.indexOf("[", at);
  let depth = 0, close = -1;
  for (let i = open; i < text.length; i++) {
    if (text[i] === "[") depth++;
    else if (text[i] === "]") { depth--; if (depth === 0) { close = i; break; } }
  }
  // References are objects ({ "path": … }), never bare strings — a bare string
  // is valid JSON but tsc ignores it, every project reference silently
  // disappears, and the build fails 1000 errors deep in unrelated files.
  const render = (e) => (e.startsWith("./") ? `{ "path": ${JSON.stringify(e)} }` : JSON.stringify(e));
  const body = entries.map((e) => `    ${render(e)}`).join(",\n");
  return text.slice(0, open) + "[\n" + body + "\n  " + text.slice(close);
};

const upstreamInclude = readArray(upstream, "include") ?? [];
const include = [];
const dropped = [];
for (const entry of upstreamInclude) {
  if (/[?*]/.test(entry)) { include.push(entry); continue; }
  if (existsSync(join(ENGINE, entry))) include.push(entry);
  else dropped.push(`include: ${entry}`);
}

// `references` is an array of objects; the entries arrive as bare paths.
const upstreamRefs = (upstream.match(/"path":\s*"([^"]+)"/g) ?? [])
  .map((m) => m.replace(/^"path":\s*"/, "").replace(/"$/, ""));
if (upstreamRefs.length === 0) {
  console.error("upstream tsconfig.client.json yielded no references — refusing to write");
  process.exit(1);
}

// The host aggregate references the vendored framework packages by directory;
// the client aggregate upstream does not. Without that reference, client-side
// imports of `@deepseek-ai/schemastery`/`cordis` resolve through the path alias
// to the vendored SOURCE, which is then type-checked under the base settings —
// and the vendor packages legitimately relax several of them in their own
// tsconfigs (exactOptionalPropertyTypes, noImplicitOverride, …), so the same
// sources that pass as a project fail as loose program members. Adding the same
// directory references the host config carries makes tsc resolve those imports
// to the projects' declaration outputs, exactly as the host build does.
// Type-checking only — no runtime effect.
const HOST_CONFIG = join(ROOT, "deepseek-harness/tsconfig.host.json");
const hostRefs = (readFileSync(HOST_CONFIG, "utf8").match(/"path":\s*"\.\/vendor\/[^"]+"/g) ?? [])
  .map((m) => m.replace(/^"path":\s*"/, "").replace(/"$/, ""));

const refs = [];
for (const entry of upstreamRefs) {
  const rel = entry.replace(/^\.\//, "");
  if (existsSync(join(ENGINE, rel)) || existsSync(join(ENGINE, rel, "tsconfig.json")) || existsSync(join(ENGINE, rel, "tsconfig.host.json"))) {
    refs.push(entry);
    continue;
  }
  dropped.push(`references: ${entry}`);
}
for (const entry of hostRefs) {
  if (!refs.includes(entry) && existsSync(join(ENGINE, entry.replace(/^\.\//, "")))) refs.push(entry);
}

if (dropped.length) {
  console.log(`dropped ${dropped.length} entries absent from the fork:`);
  for (const d of dropped.slice(0, 8)) console.log(`  - ${d}`);
  if (dropped.length > 8) console.log(`  … ${dropped.length - 8} more`);
}

let next = writeArray(raw, "include", include);
next = writeArray(next, "references", refs);

if (check) {
  if (next !== raw) { console.error("engine/tsconfig.client.json is stale — run scripts/gen-engine-client-config.mjs"); process.exit(1); }
  console.log(`OK: engine/tsconfig.client.json matches the fork (${include.length} include, ${refs.length} references)`);
} else {
  writeFileSync(CONFIG, next);
  console.log(`wrote engine/tsconfig.client.json: ${include.length} include, ${refs.length} references`);
}
