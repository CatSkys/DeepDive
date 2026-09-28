// Assemble the flat runtime closure for the built engine.
//
// pnpm's workspace links live in per-package node_modules; the shipped artifact
// needs ONE package root whose node_modules holds every transitive dependency
// — that is the shape scripts/prepare-dsh-runtime.sh's validate_runtime() reads
// and what EngineSupervisor spawns as `<runtime>/lib/bin.js`.
//
// Resolution walks real directories rather than re-deriving semver: from
// apps/cli, each package's node_modules is read (pnpm symlinks included) plus
// the workspace root's, copying whatever resolves. That reproduces what Node's
// resolver would find at runtime, so a missing entry here is a genuine build
// defect rather than an approximation of one.
//
// Copies, never symlinks: the .app bundle is deep-signed as a unit, and a
// symlink pointing outside the staged tree breaks signing.
//
// Usage: collect-engine-closure.mjs --engine <dir> --out <dir>
import { readFileSync, existsSync, mkdirSync, cpSync, realpathSync, readdirSync } from "node:fs";
import { join, relative, dirname } from "node:path";

const args = process.argv.slice(2);
const get = (flag) => { const i = args.indexOf(flag); return i === -1 ? null : args[i + 1]; };
const ENGINE = get("--engine");
const OUT = get("--out");
if (!ENGINE || !OUT) {
  console.error("usage: collect-engine-closure.mjs --engine <dir> --out <dir>");
  process.exit(1);
}

const ROOT_NM = join(ENGINE, "node_modules");
const copied = new Set();
const queued = new Set();

const readManifest = (dir) => {
  const mf = join(dir, "package.json");
  if (!existsSync(mf)) return null;
  try { return JSON.parse(readFileSync(mf, "utf8")); } catch { return null; }
};

const depNames = (m) => {
  const names = new Set();
  for (const field of ["dependencies", "optionalDependencies", "peerDependencies"]) {
    for (const n of Object.keys(m[field] ?? {})) names.add(n);
  }
  return names;
};

/** Node resolution for `name` from `fromDir`: walk up to the workspace root. */
const resolveFrom = (name, fromDir) => {
  let dir = fromDir;
  for (;;) {
    const candidate = join(dir, "node_modules", name);
    if (existsSync(join(candidate, "package.json"))) {
      try { return realpathSync(candidate); } catch { return candidate; }
    }
    if (dir === ENGINE) return null;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
};

const copyPackage = (srcReal) => {
  if (copied.has(srcReal)) return;
  copied.add(srcReal);
  const manifest = readManifest(srcReal);
  const name = manifest?.name;
  if (!name) return;
  // npm/pnpm skip optional platform packages whose os/cpu don't match the
  // install host; copying them would ship source dirs no runtime can load.
  if (manifest.os?.length && !manifest.os.includes(process.platform)) return;
  if (manifest.cpu?.length && !manifest.cpu.includes(process.arch)) return;
  // A workspace source dir standing in for a published native package ships
  // without its binary. Platform packages (os/cpu declared) must carry bin/ —
  // the npm tarball always does (2026-09-28: node-addon-system-darwin-arm64
  // copied without bin/ because build:native-system hadn't run; the engine's
  // flock lease then failed silently and sent prompts never reached the
  // session). Fail here, not at runtime.
  if (manifest.files?.includes("bin/") && !existsSync(join(srcReal, "bin"))) {
    throw new Error(
      `closure: native package ${name} has no bin/ at ${srcReal} — ` +
      `its build step did not run (see scripts/build-engine.sh)`,
    );
  }
  const dest = join(OUT, "node_modules", name);
  // When OUT lives inside the workspace (a --out under engine/, or the app
  // bundle staged next to it), a package already copied there resolves to
  // itself and cpSync refuses src === dest. Skipping is correct: the copy is
  // already where it needs to be.
  let destReal;
  try { destReal = realpathSync(dest); } catch { destReal = dest; }
  if (destReal === srcReal || dest === srcReal) return;
  mkdirSync(dirname(dest), { recursive: true });
  cpSync(srcReal, dest, {
    recursive: true,
    dereference: true,
    filter: (s) => {
      const rel = relative(srcReal, s);
      if (!rel) return true;
      // Never carry a nested closure: it would duplicate what the flat tree
      // already holds, and pnpm's `.pnpm` store is build-machine state.
      return rel.split("/")[0] !== "node_modules";
    },
  });
  queued.add(srcReal);
};

// ── seeds ──
// apps/cli is the spawn entry, but it is NOT the whole runtime: the engine
// loads plugins DYNAMICALLY from the profile composition, so packages the
// composition names (dsh-api-remotes, dsh-subagent, dsh-agent-presets, …) are
// absent from apps/cli's static dependency graph and a static walk alone ships
// a closure that boots and then dies on ERR_MODULE_NOT_FOUND at the first
// composed row.
//
// The composition is the authority on what the runtime loads, so the closure is
// seeded from both: apps/cli for the static graph, and every @deepseek-ai
// package this repo actually composes (engine/profile's expected snapshot).
// Their own dependencies then follow through the normal walk.
const SEED_ROOTS = [join(ENGINE, "apps/cli")];

// Read the composition snapshot and resolve each enabled row's package to its
// workspace directory. Rows naming a module this fork does not carry are
// skipped — they are `disabled` in the composition anyway.
const profileExpected = join(ENGINE, "profile/composition.expected.txt");
if (existsSync(profileExpected)) {
  const byName = new Map();
  const scan = (dir, depth) => {
    if (depth > 3) return;
    let entries;
    try { entries = readdirSync(dir); } catch { return; }
    for (const e of entries) {
      if (e.startsWith(".")) continue;
      const p = join(dir, e);
      const mf = join(p, "package.json");
      if (existsSync(mf)) {
        try { byName.set(JSON.parse(readFileSync(mf, "utf8")).name, p); } catch { /* ignore */ }
      } else {
        scan(p, depth + 1);
      }
    }
  };
  for (const base of ["packages", "vendor"]) scan(join(ENGINE, base), 0);

  const text = readFileSync(profileExpected, "utf8");
  for (const m of text.matchAll(/^  name: '([^']+)'$/gm)) {
    const dir = byName.get(m[1]);
    if (dir) SEED_ROOTS.push(dir);
  }
  console.log(`seeds: apps/cli + ${SEED_ROOTS.length - 1} composed packages`);
}

for (const s of SEED_ROOTS) queued.add(s);
let visited = 0;
while (queued.size) {
  const dir = [...queued][0];
  queued.delete(dir);
  if (++visited > 5000) { console.error("closure walk did not terminate"); process.exit(1); }
  const m = readManifest(dir);
  if (!m) continue;
  for (const name of depNames(m)) {
    const target = resolveFrom(name, dir);
    if (target) copyPackage(target);
  }
}

console.log(`closure: ${copied.size} packages, ${visited} dirs visited`);
if (copied.size === 0) { console.error("empty closure — did the build run?"); process.exit(1); }

// The gate every consumer already runs: the entry, the packages
// validate_runtime() names explicitly, and the LLM adapter's model catalog.
for (const must of [
  "@deepseek-ai/dsh-app-boot", "@deepseek-ai/dsh-web-app",
  "@deepseek-ai/dsh-subagent", "@deepseek-ai/dsh-session",
  "@deepseek-ai/dsh-http-proxy",
]) {
  if (!existsSync(join(OUT, "node_modules", must, "package.json"))) {
    console.error(`closure is missing ${must}`);
    process.exit(1);
  }
}
if (!existsSync(join(OUT, "lib/bin.js"))) { console.error("closure is missing lib/bin.js"); process.exit(1); }
