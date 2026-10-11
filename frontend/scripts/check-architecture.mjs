#!/usr/bin/env node
// DeepDive — 机械化的架构约束检查（`make test` 会跑；`--baseline:update` 刷新基线）。
//
// 为什么存在：`AGENTS.md` 的代码约定里有几条**只能靠自觉**——写错了不报错、测试不红、
// 只是行为静默变掉。最典型的一条已经出过事故：CSS Module 对不存在的键返回 `undefined`，
// `className={css.xxx}` 写错名字不会报错也不会让测试变红，那块样式凭空消失
// （2026-09-20「新建项目」弹窗"点了没反应"就是这么坏的，见 TODO §15）。这类约束靠人记
// 不可靠，靠测试又贴切不到——写成检查器最合适。
//
// 纪律（对齐仓库既有做法）：
//   · 只用 Node 内建，不引任何依赖；
//   · **只让新增违规失败**：既有违规按指纹存进基线，存量不阻塞，棘轮式收紧；
//   · 指纹 = sha256(规则 + 文件 + 细节) 前 16 位——挪动其它代码不会让基线失效，
//     违规值一变就失效（所以"改好一处"要顺手 `--baseline:update`）。
//
// 用法：
//   node frontend/scripts/check-architecture.mjs              # 检查，有新违规即失败
//   node frontend/scripts/check-architecture.mjs --report     # 只列，不失败（排查用）
//   node frontend/scripts/check-architecture.mjs --baseline:update

import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, dirname, resolve, relative } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "../..");
const BASELINE = join(HERE, "architecture-baseline.json");

/** 新文件行数上限（`AGENTS.md` 代码约定）。存量超限的靠基线放行，不再向上堆。 */
const MAX_FILE_LINES = 300;

const SOURCE_ROOTS = [join(ROOT, "frontend/src"), join(ROOT, "apps/macos/Sources")];
const SOURCE_EXTENSIONS = [".ts", ".tsx", ".swift"];

const isSource = (p) => SOURCE_EXTENSIONS.some((e) => p.endsWith(e));
const isTest = (p) => /\.(test|spec)\.[tj]sx?$/.test(p) || p.includes("/__tests__/");

function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    const p = join(dir, entry.name);
    if (entry.isDirectory()) walk(p, out);
    else if (isSource(p)) out.push(p);
  }
  return out;
}

const rel = (p) => relative(ROOT, p);
const fingerprint = (rule, file, detail) =>
  createHash("sha256").update(`${rule}\0${file}\0${detail}`).digest("hex").slice(0, 16);

// ── 规则 1：CSS Module 不存在的类名 ───────────────────────────────────────────
// `import css from "./X.module.css"` 之后 `css.foo` 必须真的是 X.module.css 里的
// `.foo`。写成别的模块/全局 theme.css 里的类名不会报错，只会静默 undefined。

/** 该 CSS 里出现过的类名（去注释、字符串与 url() 内容）。 */
function declaredClasses(cssText) {
  const stripped = cssText
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/url\([^)]*\)/g, " ")
    .replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/g, " ");
  const names = new Set();
  for (const m of stripped.matchAll(/\.(-?[A-Za-z_][A-Za-z0-9_-]*)/g)) names.add(m[1]);
  return names;
}

/** 文件里 `*.module.css` 的导入绑定名 → 解析后的 CSS 路径。 */
function moduleCssBindings(file, text) {
  const bindings = new Map();
  const importRe = /import\s+(?:(\w+)|\*\s+as\s+(\w+))\s+from\s+["']([^"']+\.module\.css)["']/g;
  for (const m of text.matchAll(importRe)) {
    const binding = m[1] ?? m[2];
    const target = resolve(dirname(file), m[3]);
    if (binding && existsSync(target)) bindings.set(binding, target);
  }
  return bindings;
}

function checkCssModuleClasses(file) {
  const text = readFileSync(file, "utf8");
  const violations = [];
  const declaredCache = new Map();
  for (const [binding, cssPath] of moduleCssBindings(file, text)) {
    if (!declaredCache.has(cssPath)) declaredCache.set(cssPath, declaredClasses(readFileSync(cssPath, "utf8")));
    const declared = declaredCache.get(cssPath);
    // 只认 `binding.ident` 形式的静态访问；`binding[key]` 是动态的，判不了。
    const accessRe = new RegExp(`\\b${binding}\\.([A-Za-z_$][A-Za-z0-9_$]*)`, "g");
    for (const m of text.matchAll(accessRe)) {
      if (declared.has(m[1])) continue;
      violations.push({
        rule: "css-module-unknown-class",
        file: rel(file),
        detail: `${binding}.${m[1]} (not in ${rel(cssPath)})`,
      });
    }
  }
  return violations;
}

// ── 规则 2：文件行数上限 ─────────────────────────────────────────────────────
// 只对新文件要求；存量超限进基线（`AGENTS.md`：存量大文件不强制重构，但新逻辑放新文件）。

function checkFileLines(file) {
  if (isTest(file)) return [];
  const lines = readFileSync(file, "utf8").split("\n").length;
  if (lines <= MAX_FILE_LINES) return [];
  return [{ rule: "file-lines", file: rel(file), detail: `${lines} lines > ${MAX_FILE_LINES}` }];
}

// ── 规则 3：流的竖向行奏只能有一个值 ─────────────────────────────────────────
// 用户两次报"行距没统一 / 贴的太近"：同一种"行与行"的关系曾经是 10/12/8/4 四份各写
// 各的，隔一层容器就换一档——改一处、另一处不跟，不报错、测试不红，页面上只表现为
// "看着不一致"。判据：这几个行容器里凡声明行距的地方都必须引 `--flow-gap`（值本身在
// theme.css 的 :root，唯一事实源）；行内的披露条等自占一行的元素**不再自己加下边距**
// （加了就与行奏叠成两份），所以不列在这张表里。
const FLOW_RHYTHM_RULES = [
  { selector: ".flow-inner", prop: "gap" },
  { selector: ".turn-group", prop: "gap" },
  { selector: ".msg-block.assistant", prop: "gap" },
];

// 单行行高同理（用户 2026-10-08："包括这个正文思考工具的这些行距，你要全部统一"）：
// 工具行/组头/思考头/披露条的**高度**与它们文字的 line-height 必须是 --flow-row 一个值。
// 曾经只有工具族是 24，思考头随字体行高落成 ~17px、披露条 20px 行高 + 上下垫（29px）。
const FLOW_ROW_RULES = [
  { selector: ".tool-row-main", prop: "height" },
  { selector: ".tool-title", prop: "line-height" },
  { selector: ".tool-summary", prop: "line-height" },
  { selector: ".tool-group-head", prop: "min-height" },
  { selector: ".tool-group-summary", prop: "line-height" },
  { selector: ".thinking-head", prop: "min-height" },
  { selector: ".thinking-active", prop: "line-height" },
  { selector: ".thinking-done", prop: "line-height" },
  { selector: ".turn-process-row", prop: "height" },
  { selector: ".turn-process-label", prop: "line-height" },
];

/** 这几条规则里凡声明该属性，值都必须是 var(--token)。 */
function checkFlowValues(file, rules, token, label) {
  // 注释按"保留换行"的方式抹掉：多行注释整段变空白后，选择器仍落在自己那一行的行首
  // （直接换成空格会把注释里的换行也吃掉，选择器就跑到上一行尾巴上，匹配不到）。
  const css = readFileSync(join(ROOT, file), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "));
  const violations = [];
  for (const { selector, prop } of rules) {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\-]/g, "\\$&");
    // 只看"该选择器独立成组"的规则体：`.sel[data-open] { … }` 这类追加态不参与
    const bodies = [...css.matchAll(new RegExp(`^\\s*${escaped}\\s*\\{([^}]*)\\}`, "gm"))]
      .map((m) => m[1]);
    const declared = bodies
      .map((body) => new RegExp(`(?:^|;)\\s*${prop}\\s*:([^;]+)`).exec(body))
      .filter(Boolean);
    if (declared.length === 0) {
      violations.push({ rule: "flow-rhythm", file, detail: `${selector} 没声明 ${prop}（${label}的接线断了？）` });
      continue;
    }
    for (const d of declared) {
      if (d[1].includes(`var(${token})`)) continue;
      violations.push({ rule: "flow-rhythm", file, detail: `${selector} 的 ${prop} 不是 var(${token})：${d[1].trim()}` });
    }
  }
  return violations;
}

function checkFlowRhythm() {
  const file = "frontend/src/theme.css";
  return [
    ...checkFlowValues(file, FLOW_RHYTHM_RULES, "--flow-gap", "行奏"),
    ...checkFlowValues(file, FLOW_ROW_RULES, "--flow-row", "行高"),
  ];
}

// ── 主流程 ───────────────────────────────────────────────────────────────────

function collect() {
  const files = SOURCE_ROOTS.flatMap((dir) => walk(dir)).filter((f) => !isTest(f));
  const violations = [...checkFlowRhythm()];
  for (const file of files) {
    if (file.endsWith(".ts") || file.endsWith(".tsx")) violations.push(...checkCssModuleClasses(file));
    violations.push(...checkFileLines(file));
  }
  return violations.sort((a, b) =>
    a.rule.localeCompare(b.rule) || a.file.localeCompare(b.file) || a.detail.localeCompare(b.detail),
  );
}

const args = new Set(process.argv.slice(2));
const violations = collect();
const withFingerprint = violations.map((v) => ({ ...v, id: fingerprint(v.rule, v.file, v.detail) }));

if (args.has("--baseline:update")) {
  const payload = { version: 1, note: "既有违规基线：只让新增违规失败。改好一处后重跑 --baseline:update。", violations: withFingerprint.map((v) => ({ id: v.id, rule: v.rule, file: v.file, detail: v.detail })) };
  writeFileSync(BASELINE, JSON.stringify(payload, null, 2) + "\n");
  console.log(`baseline updated: ${payload.violations.length} violation(s) grandfathered → ${rel(BASELINE)}`);
  process.exit(0);
}

const baseline = existsSync(BASELINE)
  ? new Set(JSON.parse(readFileSync(BASELINE, "utf8")).violations.map((v) => v.id))
  : new Set();
const fresh = withFingerprint.filter((v) => !baseline.has(v.id));
const grandfathered = withFingerprint.length - fresh.length;

if (violations.length === 0) {
  console.log("OK: architecture checks pass (0 violations)");
  process.exit(0);
}

for (const v of withFingerprint) {
  const mark = baseline.has(v.id) ? "baselined" : "NEW      ";
  console.log(`${mark}  ${v.rule}  ${v.file}  ${v.detail}`);
}
console.log(`\n${violations.length} violation(s): ${fresh.length} new, ${grandfathered} baselined`);

if (args.has("--report")) process.exit(0);
if (fresh.length === 0) {
  console.log("OK: no new architecture violations");
  process.exit(0);
}

console.log(`
新增违规必须修掉，别加进基线。若确实是这份改动引入的既有问题、要留待后续，就
带理由写进基线（--baseline:update）并在提交信息里说明——基线是棘轮，不是垃圾桶。`);
process.exit(1);
