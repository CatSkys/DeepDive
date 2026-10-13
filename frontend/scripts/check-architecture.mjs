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

const SOURCE_ROOTS = [join(ROOT, "frontend/src"), join(ROOT, "apps/macos/Sources")];
const SOURCE_EXTENSIONS = [".ts", ".tsx", ".swift"];

const isTest = (p) => /\.(test|spec)\.[tj]sx?$/.test(p) || p.includes("/__tests__/");

function walk(dir, out = [], extensions = SOURCE_EXTENSIONS) {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    const p = join(dir, entry.name);
    if (entry.isDirectory()) walk(p, out, extensions);
    else if (extensions.some((e) => p.endsWith(e))) out.push(p);
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

// ── 规则 2：流的竖向行奏只能有一个值 ─────────────────────────────────────────
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

// ── 规则 3/4：裸 hex 色值 + 全字面量的内联 style（Atd 借鉴提案 #1，2026-10-12 采纳）──
// 色值的家在 tokens.json 与 theme.css 语义层（"有 token 却手写数值即违规"，UI-SPEC §0）；
// 内联 style 只拦"值全是字面量"的静态块——运行期算出来的摆位（PITFALLS §1.7 的 portal
// 配方）与 CSS 变量注入（§1.9）必须内联，放行。指纹细节不含行号：挪动代码不失效，
// 改值/改属性集即失效。

const FRONTEND_SRC = join(ROOT, "frontend/src");
const HEX_RE = /#[0-9a-fA-F]{3,8}\b/g;
// 静态值 = 字符串/数字/布尔/null 字面量；标识符、模板串、三元、函数调用、计算属性名、
// spread 都按动态放行——方向宁宽勿窄，误杀比漏报更烦。
const STATIC_STYLE_VALUE = /^(?:"[^"]*"|'[^']*'|-?\d+(?:\.\d+)?|true|false|null)$/;

/** JS/TSX 注释剥离（字符串感知）：sq/dq/模板串内容原样保留，注释逐字符换空白。
 *  模板 ${} 表达式回到 code 语义（braceDepth 记表达式内对象字面量的嵌套）。 */
function stripJsComments(text) {
  const out = text.split("");
  const blank = (a, b) => {
    for (let j = a; j < b && j < text.length; j++) if (text[j] !== "\n") out[j] = " ";
  };
  let i = 0;
  let mode = "code"; // code | sq | dq | tpl
  let braceDepth = 0;
  let tplNest = 0;
  while (i < text.length) {
    const c = text[i];
    const d = text[i + 1];
    if (mode === "code") {
      if (c === "/" && d === "/") {
        const s = i;
        while (i < text.length && text[i] !== "\n") i++;
        blank(s, i);
        continue;
      }
      if (c === "/" && d === "*") {
        const s = i;
        i += 2;
        while (i < text.length && !(text[i] === "*" && text[i + 1] === "/")) i++;
        i = Math.min(i + 2, text.length);
        blank(s, i);
        continue;
      }
      if (c === "'") { mode = "sq"; i++; continue; }
      if (c === '"') { mode = "dq"; i++; continue; }
      if (c === "`") { mode = "tpl"; i++; continue; }
      if (c === "}" && tplNest > 0 && braceDepth === 0) { tplNest--; mode = "tpl"; i++; continue; }
      if (c === "{") braceDepth++;
      if (c === "}") braceDepth--;
      i++;
      continue;
    }
    if (mode === "tpl") {
      if (c === "\\") { i += 2; continue; }
      if (c === "$" && d === "{") { tplNest++; braceDepth = 0; mode = "code"; i += 2; continue; }
      if (c === "`") { mode = "code"; i++; continue; }
      i++;
      continue;
    }
    // sq | dq
    if (c === "\\") { i += 2; continue; }
    if ((mode === "sq" && c === "'") || (mode === "dq" && c === '"')) mode = "code";
    i++;
  }
  return out.join("");
}

/** 从 openIdx 的 `{` 起做字符串感知的括号匹配，返回括号内的对象体；失配返回 null。 */
function braceBody(text, openIdx) {
  let depth = 0;
  let mode = "code";
  for (let i = openIdx; i < text.length; i++) {
    const c = text[i];
    if (mode !== "code") {
      if (c === "\\") { i++; continue; }
      if ((mode === "sq" && c === "'") || (mode === "dq" && c === '"') || (mode === "tpl" && c === "`")) mode = "code";
      continue;
    }
    if (c === "'") { mode = "sq"; continue; }
    if (c === '"') { mode = "dq"; continue; }
    if (c === "`") { mode = "tpl"; continue; }
    if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) return text.slice(openIdx + 1, i);
    }
  }
  return null;
}

/** 顶层逗号切分（字符串与括号深度感知）。 */
function splitTopLevel(body) {
  const parts = [];
  let start = 0;
  let depth = 0;
  let mode = "code";
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (mode !== "code") {
      if (c === "\\") { i++; continue; }
      if ((mode === "sq" && c === "'") || (mode === "dq" && c === '"') || (mode === "tpl" && c === "`")) mode = "code";
      continue;
    }
    if (c === "'") { mode = "sq"; continue; }
    if (c === '"') { mode = "dq"; continue; }
    if (c === "`") { mode = "tpl"; continue; }
    if (c === "(" || c === "[" || c === "{") depth++;
    else if (c === ")" || c === "]" || c === "}") depth--;
    else if (c === "," && depth === 0) { parts.push(body.slice(start, i)); start = i + 1; }
  }
  parts.push(body.slice(start));
  return parts.map((p) => p.trim()).filter(Boolean);
}

function checkBareHex(file, text, isCss) {
  const stripped = isCss
    ? text.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/url\([^)]*\)/gi, " ")
    : stripJsComments(text);
  const hits = new Set();
  for (const m of stripped.matchAll(HEX_RE)) hits.add(m[0]);
  return [...hits].map((hex) => ({ rule: "bare-hex-color", file: rel(file), detail: hex }));
}

function checkInlineStaticStyle(file, text) {
  const violations = [];
  const stripped = stripJsComments(text);
  for (const m of stripped.matchAll(/style=\{\{/g)) {
    const body = braceBody(stripped, m.index + 7); // +6 是 style= 后外层的 {，+7 是对象自己的 {
    if (body === null) continue;
    const parts = splitTopLevel(body);
    if (parts.length === 0) continue;
    const keys = [];
    let allStatic = true;
    for (const part of parts) {
      if (part.startsWith("...") || part.startsWith("[")) { allStatic = false; break; }
      const km = /^([A-Za-z_$][\w$]*)\s*:([\s\S]*)$/.exec(part);
      if (!km || !STATIC_STYLE_VALUE.test(km[2].trim())) { allStatic = false; break; }
      keys.push(km[1]);
    }
    if (allStatic) {
      violations.push({
        rule: "inline-static-style",
        file: rel(file),
        detail: `style={{ ${keys.sort().join(", ")} }} 全字面量`,
      });
    }
  }
  return violations;
}

// ── 规则 5：窄窗媒体规则不得误伤迷你面板页（2026-10-13 黑窗事故）────────────────
// 迷你面板窗天生只有 ~500pt 宽，**永远**落在窄窗断点里：`@media (max-width: …)` 里给
// 会话列/面板卡写的"窄屏呈现"（手机远程那一套）会被它照单全收。事故现场：手机断点的
// `.session-row:has(> .panel) > .session { visibility: hidden }` 把面板页整列停画——
// DOM 全在、布局正常、一个字不出，只剩窗底玻璃（用户报"发送后黑窗"；DOM 探针与
// 受控浏览器都查不出来，因为断点没在探针视口命中）。这类规则的归属必须显式排除
// `.mini-panel`：`.app:not(.mini-panel) …`；面板页自己的窄窗呈现写在 `.mini-panel` 块里。

/** 窄窗媒体块里的规则前奏（selector），按顶层 {} 逐对扫。 */
function narrowMediaRuleSelectors(body) {
  const out = [];
  let i = 0;
  while (i < body.length) {
    const open = body.indexOf("{", i);
    if (open === -1) break;
    const declarations = braceBody(body, open);
    if (declarations === null) break;
    const selector = body.slice(i, open).trim();
    if (selector) out.push(selector);
    i = open + declarations.length + 2;
  }
  return out;
}

/** 选择器是不是冲着主窗共享类去的（会话列 / 会话行 / 右侧面板卡）。 */
const SHARED_SURFACE_SELECTOR = /(^|[\s>+~,(])\.(?:session|session-row|panel)(?![\w-])/;

function checkNarrowMediaMiniPanel(file, text) {
  const stripped = text.replace(/\/\*[\s\S]*?\*\//g, " ");
  const violations = [];
  for (const m of stripped.matchAll(/@media[^{]*max-width[^{]*\{/gi)) {
    const body = braceBody(stripped, m.index + m[0].length - 1);
    if (body === null) continue;
    const query = m[0].replace(/\s*\{$/, "").trim();
    for (const selector of narrowMediaRuleSelectors(body)) {
      for (const one of splitTopLevel(selector)) {
        if (!SHARED_SURFACE_SELECTOR.test(one) || one.includes(".mini-panel")) continue;
        violations.push({ rule: "narrow-media-mini-panel", file: rel(file), detail: `${query} → ${one}` });
      }
    }
  }
  return violations;
}

// ── 规则 6：面板页规则必须显式赢得级联（2026-10-13 面板变主窗内容卡）──────────
// 面板页（#/mini）整页复用主窗样式表，只靠祖先类区分：面板的修正与主窗规则常常落在
// 同一批属性上（卡面/圆角/投影/内边距），而主窗规则多为 2 类选择器、写在文件后段——
// 面板若也用 2 类就会静默输掉。事故：`.mini-panel .session` 与
// `.session-row > .session` 同为 2 类、前者更靠前，覆盖被吃掉——会话列一从
// `visibility:hidden` 里放出来就带着主窗内容卡的深色底/卡圆角/卡投影（用户报
// "跳转到了内容面板上…深色底也一起弄过来了"）。
// 约定（机检）：选择器带 `.mini-panel` 的只许两种写法——
//   · 面板作用域 `.app.mini-panel …`（3 类起步，稳定压过主窗规则）；
//   · 主窗作用域 `.app:not(.mini-panel) …`（窄窗这类只服务主页面的规则显式排除面板页）。

const MINI_PANEL_SEL = /\.mini-panel(?![\w-])/;

function checkMiniPanelScope(file, text) {
  const stripped = text.replace(/\/\*[\s\S]*?\*\//g, " ");
  const violations = [];
  for (const m of stripped.matchAll(/([^{}]+)\{/g)) {
    const selector = m[1].trim();
    if (!MINI_PANEL_SEL.test(selector)) continue;
    for (const one of splitTopLevel(selector)) {
      if (!MINI_PANEL_SEL.test(one)) continue;
      if (one.startsWith(".app.mini-panel") || one.includes(".app:not(.mini-panel)")) continue;
      violations.push({ rule: "mini-panel-cascade-scope", file: rel(file), detail: one });
    }
  }
  return violations;
}

// ── 主流程 ───────────────────────────────────────────────────────────────────

function collect() {
  const files = SOURCE_ROOTS.flatMap((dir) => walk(dir)).filter((f) => !isTest(f));
  const violations = [...checkFlowRhythm()];
  for (const file of files) {
    if (file.endsWith(".ts") || file.endsWith(".tsx")) violations.push(...checkCssModuleClasses(file));
  }
  // 规则 3~6 只看前端：Swift 壳的样式不归 tokens.json 管。
  for (const file of walk(FRONTEND_SRC, [], [".css"]).filter((f) => !isTest(f))) {
    const text = readFileSync(file, "utf8");
    violations.push(...checkBareHex(file, text, true));
    violations.push(...checkNarrowMediaMiniPanel(file, text));
    violations.push(...checkMiniPanelScope(file, text));
  }
  for (const file of files) {
    if (file.startsWith(FRONTEND_SRC) && file.endsWith(".tsx")) {
      const text = readFileSync(file, "utf8");
      violations.push(...checkBareHex(file, text, false));
      violations.push(...checkInlineStaticStyle(file, text));
    }
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
