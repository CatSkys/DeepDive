// Materialize engine/ — DeepDive's own copy of the dsh kernel.
//
// Copies the WHOLE upstream package tree verbatim, plus the scaffolding a build
// needs (root manifests, tsconfigs, native/, scripts/, patches/, apps/cli).
//
// Why the whole tree and not just what our composition enables: a subset fork
// does not build. `agent-presets` looks like a removable product layer, but
// packages/api/{session-controller,settings-controller,remotes} import it at
// RUNTIME, and ~100 tsconfig project references point into the client tree
// (ui-slots, store, ui-primitives). Pruning the set means repairing dependency
// edges across the whole graph — real work, but a SEPARATE concern from owning
// the code, and the same thing composition-level pruning
// (scripts/prune-dsh-runtime.sh) already does for the shipped artifact.
//
// So: fork everything now, prune later, on the build's own terms.
//
// Copies are verbatim — no renaming. @deepseek-ai/* → @deepdive/* would touch
// every manifest and import for no behavioral gain; owning the code is the
// point, naming is cosmetic and reversible.
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync, rmSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = "/Users/hanbyking/Documents/DSHmini";
const HS = join(ROOT, "deepseek-harness");
const OUT = join(ROOT, "engine");

const SKIP_DIR = new Set(["node_modules", "lib", "dist", "target", ".turbo", ".git"]);

/** Copy a tree, dropping build output and install state. */
const copyTree = (rel) => {
  const src = join(HS, rel), dst = join(OUT, rel);
  rmSync(dst, { recursive: true, force: true });
  mkdirSync(dst, { recursive: true });
  cpSync(src, dst, {
    recursive: true,
    filter: (s) => {
      const relToSrc = s.slice(src.length).replace(/^\//, "");
      if (!relToSrc) return true;
      // apps/cli/lib is the build OUTPUT of apps/cli/src — copying it would
      // ship a stale engine. The build regenerates it.
      return !SKIP_DIR.has(relToSrc.split("/")[0]);
    },
  });
};

// ── packages + vendor + native ──
// Each group holds packages directly (vendor/*), two-level groups
// (packages/<group>/<pkg>), or BOTH plus root-level files that belong to the
// group rather than to any package — packages/client/tsdown.client.ts is one,
// and per-package tsdown configs import it by path. Copying only the package
// subdirectories silently drops it and the bundle step fails on a missing
// module, so copy the group root too whenever it holds loose files.
for (const group of ["packages", "vendor", "native"]) {
  const base = join(HS, group);
  if (!existsSync(base)) continue;
  for (const entry of readdirSync(base)) {
    if (SKIP_DIR.has(entry)) continue;
    const p = join(base, entry);
    if (!statSync(p).isDirectory()) continue;
    if (existsSync(join(p, "package.json"))) { copyTree(`${group}/${entry}`); continue; }
    // A group dir: take its loose files, then its package children.
    for (const loose of readdirSync(p)) {
      if (SKIP_DIR.has(loose)) continue;
      const lp = join(p, loose);
      if (statSync(lp).isFile()) {
        mkdirSync(join(OUT, group, entry), { recursive: true });
        cpSync(lp, join(OUT, group, entry, loose));
      } else if (statSync(lp).isDirectory()) {
        copyTree(`${group}/${entry}/${loose}`);
      }
    }
  }
}
console.log("copied packages/, vendor/, native/");

// ── apps: only cli, the one that IS @deepseek-ai/dsh (bin: lib/bin.js) ──
for (const app of readdirSync(join(HS, "apps"))) {
  if (app !== "cli") { console.log(`  skip apps/${app} (not the engine entry)`); continue; }
  copyTree(`apps/${app}`);
}
console.log("copied apps/cli/");

// ── build scaffolding ──
// The root-level config files, not just the tsconfig family: tsdown.config.ts
// is what loads the typert generator plugin, and without it the bundle step
// fails with "No input files" instead of producing anything.
//
// website/docs.ts is the docs catalog the doc-gate scripts import; snapshots/
// are the session fixtures their specs replay. Neither reaches the runtime
// closure (nothing in apps/cli references them), but tsconfig.host includes
// scripts/**/*.ts and those specs fail to type-check without them.
//
// website/ is copied as that ONE file, not the docs site: its build config
// needs vitepress, which this fork does not install, and a workspace member
// with no installable dependency breaks `pnpm install` outright.
for (const d of ["scripts", "patches", "snapshots"]) copyTree(d);
mkdirSync(join(OUT, "website"), { recursive: true });
cpSync(join(HS, "website/docs.ts"), join(OUT, "website/docs.ts"));
for (const f of [
  "pnpm-lock.yaml", "pnpm-workspace.yaml", "tsdown.config.ts",
  "tsconfig.json", "tsconfig.host.json", "tsconfig.client.json",
  "tsconfig.base.json", "tsconfig.base.client.json", "LICENSE",
  // The decorator pre-transform the fork's own vitest.config.ts reuses: the
  // upstream vitest harness does not come across, but source specs with
  // `@Remote` methods cannot be loaded without it.
  "vitest.shared.ts",
]) {
  if (existsSync(join(HS, f))) cpSync(join(HS, f), join(OUT, f));
}
console.log("copied build scaffolding");

// Root manifest: upstream's dependency sets verbatim (the build needs them),
// narrowed workspaces, and only the scripts this fork can actually run.
const manifest = JSON.parse(readFileSync(join(HS, "package.json"), "utf8"));
manifest.name = "@deepdive/engine-root";
manifest.description = "DeepDive's own engine: a fork of the dsh kernel (MIT), extended with DeepDive's own plugins.";
manifest.workspaces = ["vendor/*", "packages/*/*", "native/system", "native/system/packages/*", "apps/*"];
manifest.scripts = {
  "build": "bash ../scripts/build-engine.sh",
  "build:native-system": "tsx native/system/scripts/build.ts --host-addon-only",
  "build:lib": "pnpm run build:lib:host",
  "build:lib:host": "node --max-old-space-size=4096 ./node_modules/typescript/bin/tsc -b tsconfig.host.json && tsdown --env.DSH_BUILD_FACE host",
  "gen:host-include": "node ../scripts/gen-engine-host-include.mjs",
};
writeFileSync(join(OUT, "package.json"), JSON.stringify(manifest, null, 2) + "\n");
console.log("wrote package.json (DeepDive root, narrowed workspaces)");

// pnpm-workspace.yaml: same narrowing — pnpm errors on a glob matching nothing.
const wsFile = join(OUT, "pnpm-workspace.yaml");
let ws = readFileSync(wsFile, "utf8");
ws = ws.replace(/^packages:\n(?:  - .*\n)+/m,
  "packages:\n  - vendor/*\n  - packages/*/*\n  - native/system\n  - native/system/packages/*\n  - apps/*\n");
writeFileSync(wsFile, ws);
console.log("narrowed pnpm-workspace.yaml");

// Upstream's aggregate `include` list, extracted as the baseline that
// gen-engine-host-include.mjs filters against. The host program's real
// boundary is each package's own tsconfig.host.json `files`; the aggregate
// list only carries what has no host project of its own, so regenerating it
// from the directory tree instead would pull every package's browser half
// into the host program and break the /remote imports.
{
  const raw = readFileSync(join(HS, "tsconfig.host.json"), "utf8");
  const at = raw.indexOf('"include"');
  const open = raw.indexOf("[", at);
  let depth = 0, close = -1;
  for (let i = open; i < raw.length; i++) {
    if (raw[i] === "[") depth++;
    else if (raw[i] === "]") { depth--; if (depth === 0) { close = i; break; } }
  }
  const entries = [...raw.slice(open + 1, close).matchAll(/"([^"]+)"/g)].map((m) => m[1]);
  writeFileSync(join(OUT, ".upstream-host-include.json"), JSON.stringify(entries, null, 2) + "\n");
  console.log(`extracted upstream include baseline: ${entries.length} entries`);
}

console.log("done");
