// Bring engine/tsconfig.host.json in line with what this fork actually has.
//
// The rule this encodes, learned the hard way: the upstream file is CORRECT.
// Its `include` and `references` are maintained by upstream against the whole
// monorepo, and every attempt to regenerate them from the directory tree
// produced a build that upstream's own configuration does not — TS6306
// (referenced project is not composite) when references named a solution file
// instead of a package directory, TS6307 (file not listed in the project) when
// packages' own tests entered through `references`, and TS2307 on the repo's
// gate scripts, whose fixtures live in trees the fork does not carry.
//
// So this does the minimum: start from upstream verbatim and drop only the
// entries whose target is genuinely absent here. Anything else is a regression
// against a configuration that builds clean upstream.
//
// Usage:
//   gen-engine-host-include.mjs          # rewrite engine/tsconfig.host.json
//   gen-engine-host-include.mjs --check  # fail if stale (for make test)
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, relative, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const ENGINE = join(ROOT, "engine");
const CONFIG = join(ENGINE, "tsconfig.host.json");
const UPSTREAM = join(ROOT, "deepseek-harness/tsconfig.host.json");
const check = process.argv.includes("--check");

const raw = readFileSync(CONFIG, "utf8");
const upstream = readFileSync(UPSTREAM, "utf8");

const isDir = (p) => { try { return statSync(p).isDirectory(); } catch { return false; } };

/** Read a JSONC array of raw entry strings. */
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

/** Replace a JSONC array, preserving everything outside it. */
const writeArray = (text, key, entries, render) => {
  const at = text.indexOf(`"${key}"`);
  const open = text.indexOf("[", at);
  let depth = 0, close = -1;
  for (let i = open; i < text.length; i++) {
    if (text[i] === "[") depth++;
    else if (text[i] === "]") { depth--; if (depth === 0) { close = i; break; } }
  }
  const body = entries.map((e) => `    ${render(e)}`).join(",\n");
  return text.slice(0, open) + "[\n" + body + "\n  " + text.slice(close);
};

const droppedInclude = [];
const droppedRefs = [];

// ── include: drop entries whose path is absent here, plus the ones whose
// dependencies the fork does not install ──
// `website/**` is upstream's docs-site glob. The fork carries website/ only as
// a data source (docs.ts, imported by the doc gates) and deliberately does not
// install its vitepress dependency, so its build config cannot type-check.
// The other dropped entries here are plain absences: apps/web tests, apps/cli
// e2e specs, desktop scripts — trees this fork does not carry.
const FORCE_DROP_INCLUDE = /^(website|benchmarks|apps\/desktop)\//;

// The docs-site gate family, excluded whole. project-doc-site.ts validates the
// documentation site against website/build.ts; the fork carries only
// website/docs.ts (the catalog the other gates read) and does not install
// vitepress, so this gate cannot run here. run-gates.ts reaches it too, so the
// exclusion covers the importers as well.
const FORCE_DROP_SCRIPTS = new Set([
  "scripts/project-doc-site.ts",
  "scripts/project-doc-site.spec.ts",
  "scripts/verify-doc-site-fragments.ts",
  "scripts/verify-doc-site-fragments.spec.ts",
  "scripts/run-gates.ts",
  // The gate scheduler's own tests: they exercise run-gates.ts, which is
  // excluded above, and tsc reports TS6307 for an imported file a project no
  // longer lists.
  "scripts/run-gates.spec.ts",
  "scripts/tests/ci-master-platforms.spec.ts",
]);

const upstreamInclude = readArray(upstream, "include") ?? [];
const include = [];
for (const entry of upstreamInclude) {
  if (FORCE_DROP_INCLUDE.test(entry)) { droppedInclude.push(`${entry}  (deps not installed in this fork)`); continue; }
  if (/[?*]/.test(entry)) {
    // A glob: keep it only when it can still match something. apps/web and
    // desktop globs are kept — a glob naming nothing is inert, not an error.
    include.push(entry);
    continue;
  }
  if (FORCE_DROP_SCRIPTS.has(entry)) { droppedInclude.push(`${entry}  (docs-site gate; not part of the engine build)`); continue; }
  if (existsSync(join(ENGINE, entry))) include.push(entry);
  else droppedInclude.push(entry);
}

// ── references: keep upstream's shape, drop only what is absent ──
// Upstream mixes two forms and BOTH are load-bearing: a package with its own
// tsconfig.host.json is named by that file (the composite project), and one
// without is named by directory (tsc resolves the tsconfig inside). Rewriting
// either shape produces TS6306, so entries are copied verbatim.
// `references` is an array of OBJECTS ({ "path": … }), not strings — reading it
// with the string-array reader silently yields nothing, which is how a whole
// class of entries (every vendor/* reference among them) went missing and the
// vendor sources then fell into the program unconfigured and failed to
// type-check.
const upstreamRefs = (upstream.match(/"path":\s*"([^"]+)"/g) ?? [])
  .map((m) => m.replace(/^"path":\s*"/, "").replace(/"$/, ""));
if (upstreamRefs.length === 0) {
  console.error("upstream tsconfig.host.json yielded no references — refusing to write an empty list");
  process.exit(1);
}
const refs = [];
for (const entry of upstreamRefs) {
  const rel = entry.replace(/^\.\//, "");
  if (/[?*]/.test(rel)) { refs.push(entry); continue; }
  if (existsSync(join(ENGINE, rel))) { refs.push(entry); continue; }
  // A directory-style reference resolves a tsconfig inside it.
  if (existsSync(join(ENGINE, rel, "tsconfig.json")) || existsSync(join(ENGINE, rel, "tsconfig.host.json"))) {
    refs.push(entry);
    continue;
  }
  droppedRefs.push(entry);
}

if (droppedInclude.length) {
  console.log(`include: dropped ${droppedInclude.length} entries with no target in the fork`);
  for (const d of droppedInclude.slice(0, 6)) console.log(`  - ${d}`);
  if (droppedInclude.length > 6) console.log(`  … ${droppedInclude.length - 6} more`);
}
if (droppedRefs.length) {
  console.log(`references: dropped ${droppedRefs.length} entries with no target in the fork`);
  for (const d of droppedRefs.slice(0, 6)) console.log(`  - ${d}`);
  if (droppedRefs.length > 6) console.log(`  … ${droppedRefs.length - 6} more`);
}

// ── our own packages ──
// Upstream's list cannot know about packages this fork adds, and regenerating
// the whole list from the tree is exactly what the header warns against — so
// ours are appended explicitly, in the directory-reference form upstream uses
// for a package that carries its own tsconfig.json (which resolves that file,
// including its `include`). Add a package here when it joins engine/packages/
// under the deepdive/ group; forgetting to means it is never type-checked nor
// bundled, and the composition row then fails at boot with ERR_MODULE_NOT_FOUND.
const OUR_PACKAGE_DIRS = ["packages/deepdive/host"];
for (const dir of OUR_PACKAGE_DIRS) {
  const ref = `./${dir}`;
  if (!refs.includes(ref)) refs.push(ref);
}

let next = writeArray(raw, "include", include, (e) => JSON.stringify(e));
next = writeArray(next, "references", refs, (e) => `{ "path": ${JSON.stringify(e)} }`);

// `scripts/**/*.ts` is a glob, so excluding a file from `include` does not keep
// it out — the glob still matches it. The forced drops above therefore have to
// be repeated in `exclude` (which does win over include), or the whole exercise
// is undone by the glob.
const rawExclude = readArray(raw, "exclude") ?? [];
const forced = [...FORCE_DROP_SCRIPTS, "website/docs.ts"];
const exclude = [...new Set([...rawExclude, ...forced])].sort();
next = writeArray(next, "exclude", exclude, (e) => JSON.stringify(e));

if (check) {
  if (next !== raw) { console.error("engine/tsconfig.host.json is stale — run scripts/gen-engine-host-include.mjs"); process.exit(1); }
  console.log(`OK: engine/tsconfig.host.json matches the fork (${include.length} include, ${refs.length} references)`);
} else {
  writeFileSync(CONFIG, next);
  console.log(`wrote engine/tsconfig.host.json: ${include.length} include, ${refs.length} references`);
}
