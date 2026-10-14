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
// 约定（机检）：选择器里的 `.mini-panel` 必须写成 `.app.mini-panel`（3 类起步，稳定压过
// 主窗规则），或作为主窗作用域的排除 `.app:not(.mini-panel)` 出现。**位置不限**：
// `:where(html[data-hover-armed])` 这类零特异度包装可以留在外层——特异度来自
// `.app.mini-panel` 本身，与它排在第几个无关。

const MINI_PANEL_SEL = /\.mini-panel(?![\w-])/;

function checkMiniPanelScope(file, text) {
  const stripped = text.replace(/\/\*[\s\S]*?\*\//g, " ");
  const violations = [];
  for (const m of stripped.matchAll(/([^{}]+)\{/g)) {
    const selector = m[1].trim();
    if (!MINI_PANEL_SEL.test(selector)) continue;
    for (const one of splitTopLevel(selector)) {
      const masked = one.split(".app.mini-panel").join(" ").split(".app:not(.mini-panel)").join(" ");
      if (!MINI_PANEL_SEL.test(masked)) continue;
      violations.push({ rule: "mini-panel-cascade-scope", file: rel(file), detail: one });
    }
  }
  return violations;
}

// ── 主流程 ───────────────────────────────────────────────────────────────────

// ── 规则 7：表面层级表的三件事只能引 token（2026-10-13 全量收编）───────────────
// 浮层的圆角 / 模糊 / 层级此前各自手写：圆角 36 种取值、z-index 30 种取值、
// backdrop-filter 四套配方散在 9 个文件里——写歪了不报错、测试不红，页面上只表现
// 为"这一块和别处不一样"，正是本检查器存在的理由。三件事现在各有唯一事实源：
// radius 在 tokens.json，blur 与 z 在 theme.css 的 :root；取法在 UI-SPEC §1.4bis。
// 阈值：z-index < 100 的按"组件内部堆叠"放行（它们只在自己那个堆叠上下文里有意义）。
const SURFACE_RADIUS_RE = /border-radius\s*:\s*([^;}]+)/g;
const SURFACE_BLUR_RE = /(?:^|;)\s*(?:-webkit-)?backdrop-filter\s*:\s*([^;}]+)/g;
const SURFACE_Z_RE = /(?:^|;)\s*z-index\s*:\s*(\d+)/g;
// 放行：0 / inherit / 百分比 / calc() / var()——派生值与语义形状（圆、胶囊的第二种写法）
const RADIUS_OK_RE = /^(?:0|inherit|\d+(?:\.\d+)?%|calc\(|var\()/;

function checkSurfaceTiers(file, css) {
  const violations = [];
  const detail = (what) => `${what}（引 token，见 UI-SPEC §1.4bis 表面层级表）`;
  for (const m of css.matchAll(SURFACE_RADIUS_RE)) {
    const value = m[1].trim();
    if (RADIUS_OK_RE.test(value)) continue;
    violations.push({ rule: "surface-tier", file, detail: detail(`border-radius 手写数值 ${value}`) });
  }
  for (const m of css.matchAll(SURFACE_BLUR_RE)) {
    const value = m[1].trim();
    if (!/blur\(\s*\d/.test(value)) continue; // blur(none/calc/var) 不算配方
    violations.push({ rule: "surface-tier", file, detail: detail(`backdrop-filter 手写配方 ${value}`) });
  }
  for (const m of css.matchAll(SURFACE_Z_RE)) {
    if (Number(m[1]) < 100) continue;
    violations.push({ rule: "surface-tier", file, detail: detail(`z-index 手写层级 ${m[1]}`) });
  }
  return violations;
}


// ── 规则 8：材质层的宿主必须是栈上下文 ────────────────────────────────────────
// [data-liquid-glass-backdrop]（`components/GlassLayer.tsx`）用**负 z** 垫在宿主内容之后
// （照参考实现的 `chat-panel-glass`），所以内容层不需要任何定位或抬升。代价是宿主必须
// 自己是**栈上下文**（定位 + 显式 z-index）：少了这一条，负 z 会一路逃到宿主祖先的背景
// 底下——页面上表现为"这块浮面整片消失"。不报错、测试不红，只能机械检查。
// 判据：每个含 <GlassLayer /> 的 JSX 元素，解析它的 className，再在对应 CSS 里要求那条
// 规则（同名规则取并集）同时给出 position（非 static）与 z-index。
const PRIMITIVE_BASES = new Set(["box"]);
const GLASS_LAYER_TSX = "<GlassLayer";
// 两个原语（Popover / Modal）的宿主类只承担"盒"这一半：position 在类里，**层级那一半
// 由调用方传进来的类给**（.ctx-menu 的 --z-top、.ddMenu/.model-menu 的 --z-menu…）——
// 跨文件合并静态看不出来。它们的层级因此由各自那条"调用方类必须带 z-index"的约定守着，
// 这里按已知基类放行；下面 11 个**直接**挂材质层的面照查不误（宿主类都在同文件或它的
// module 里）。

/** `import alias from "./x.module.css"` → alias → 绝对路径。 */
function cssImportsOf(file, text) {
  const map = new Map();
  for (const m of text.matchAll(/import\s+(\w+)\s+from\s+"([^"]*\.css)"/g)) {
    map.set(m[1], resolve(dirname(file), m[2]));
  }
  return map;
}

/** 每个含 <GlassLayer /> 的 JSX 元素的 className 属性文本（取到标签末尾）。
 *  复杂表达式（三元、模板串）也照收——下面按 `alias.name` 与字符串字面量两种形态去认。 */
function glassHostClassAttrs(body) {
  const out = [];
  let i = body.indexOf(GLASS_LAYER_TSX);
  while (i !== -1) {
    // 往回找宿主标签的起点（i - 1：别把 <GlassLayer 自己的那个 < 当成宿主）
    const open = body.lastIndexOf("<", i - 1);
    const tag = open === -1 ? "" : body.slice(open, i);
    const m = tag.match(/className\s*=\s*([\s\S]*)$/);
    if (m) out.push(m[1]);
    i = body.indexOf(GLASS_LAYER_TSX, i + GLASS_LAYER_TSX.length);
  }
  return out;
}

/** 解析 className 属性文本 → [{ file, name }]。
 *  三种形态都要认：`"a b"` 字面量、`css.x` / `rowsCss.x` 模块类、模板串
 *  `` `composer${cond ? " wide" : ""}` ``——模板串里只算**静态段**（`${}` 里是条件，
 *  不是这个元素常带的类）。 */
function glassHostClasses(attr, modules) {
  const out = [];
  const push = (raw) => {
    if (/^[\w-]+$/.test(raw)) out.push({ file: null, name: raw, global: true });
  };
  for (const m of attr.matchAll(/(\w+)\.(\w+)/g)) {
    const target = modules.get(m[1]);
    if (target) out.push({ file: target, name: m[2] });
  }
  const ticks = [...attr.matchAll(/`([^`]*)`/g)];
  if (ticks.length > 0) {
    for (const m of ticks) {
      for (const raw of m[1].replace(/\$\{[^}]*\}/g, " ").split(/[\s`]+/)) push(raw);
    }
  } else {
    for (const m of attr.matchAll(/"([^"]*)"/g)) {
      for (const raw of m[1].split(/\s+/)) push(raw);
    }
  }
  return out;
}

/** 该 CSS 里所有匹配 `.name` 的规则体拼在一起（同名多条取并集）。 */
function ruleBodiesFor(cssText, name) {
  const re = new RegExp(`\\.${name.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, "\\$&")}(?![\\w-])`);
  let bodies = "";
  for (const m of cssText.replace(/\/\*[\s\S]*?\*\//g, " ").matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (re.test(m[1])) bodies += m[2] + ";";
  }
  return bodies;
}

/** 裸写 `data-liquid-glass-backdrop` 的元素 = GlassLayer 的第二份实现。 */
function checkGlassLayerDuplication(file, text) {
  if (file.endsWith("GlassLayer.tsx")) return [];
  // 注释里提到这个属性名是正常的（解释约束）；只有真当属性用才算重复实现。
  const code = text.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");
  return code.includes("data-liquid-glass-backdrop")
    ? [{ rule: "glass-host", file, detail: "材质层要经 components/GlassLayer.tsx，别再手写这个属性" }]
    : [];
}

function checkGlassHosts(file, text, globalCss) {
  const attrs = glassHostClassAttrs(text);
  if (attrs.length === 0) return [];
  const modules = cssImportsOf(file, text);
  const violations = [];
  for (const attr of attrs) {
    for (const { file: cssFile, name, global } of glassHostClasses(attr, modules)) {
      // 字面量类名可能是全局的也可能在某个 module 里：两个都查，命中即用。
      const cssText = global
        ? [...globalCss.values()].find((txt) => ruleBodiesFor(txt, name) !== "")
        : readFileSync(cssFile, "utf8");
      if (!cssText) continue;
      const body = ruleBodiesFor(cssText, name);
      if (body === "") continue;
      const where = global ? "全局 CSS" : rel(cssFile);
      const hasPosition = /position\s*:\s*(?!static)[a-z-]+/.test(body);
      const hasZ = /(?:^|;)\s*z-index\s*:/.test(body);
      if (!PRIMITIVE_BASES.has(name) && !(hasPosition && hasZ)) {
        violations.push({
          rule: "glass-host",
          file,
          detail: `材质层宿主缺 ${hasPosition ? "z-index" : "position"}（.${name} 在 ${where}）——负 z 会逃出宿主`,
        });
      }
      // 材质宿主不许描边（用户 2026-10-14 定稿）：材质层自己不再画环
      // （[data-liquid-glass-backdrop] 的装饰默认 none），宿主写一条 border 就会直接显形。
      // 面的范围一律由底色承担——`border: none`/`0` 是显式声明，不算。
      const strokes = strokesIn(body);
      if (strokes.length > 0) {
        violations.push({
          rule: "glass-host",
          file,
          detail: `材质层宿主不许描边（.${name} 的 border: ${strokes[0]} 在 ${where}）——面的范围由底色承担`,
        });
      }
    }
  }
  return violations;
}

// ── 规则 9：字号只走阶梯，字重不许出现 700 及以上 ──────────────────────────────
// 两类都不报错、测试不红，只是页面上静默走样（2026-10-14 字体对齐 Raycast 时收口）：
//   · 手写字号绕开 `--dsh-font-size-*` 之后，改基准不再带上它——阶梯的全部意义是"改一个字
//     改整梯"，而全仓曾有一处 `font-size: 11px` 就这么留在六档之外（UI-SPEC §1.2）；
//   · `font-weight: 700` 在中文上不是加粗而是**合成加粗**：PingFang SC 的真实字面最高只到
//     Semibold，700 只能由 WebKit 描边伪造，笔画发糊发闷（UI-SPEC §1.2 称之为"中文界面显
//     廉价的典型来源"）。700 在 2026-09-30 全仓收回过，2026-10-11 又漏进 3 处，所以机械拦。
// 口径：字重只认 400/500/600，语义是「**600 = 标题（lg 及以上档）与数字，500 = 其余一切强调**」；
// 字号只认 token（图形/图表内部件用 em 跟随容器几何，不算手写 px；TSX 里的内联 fontSize
// 是图表轴标签与 monogram 的几何推导，UI-SPEC §1.2 已登记豁免，本规则不查 TSX）。
const LITERAL_FONT_SIZE_RE = /(?:^|[;{])\s*font-size\s*:[^;{}]*\d(?:\.\d+)?px\b/;
const HEAVY_FONT_WEIGHT_RE = /(?:^|[;{])\s*(?:font-weight|font)\s*:[^;{}]*\b(?:700|800|900|bold|bolder)\b/;

function checkFontScale(file, text) {
  const css = text.replace(/\/\*[\s\S]*?\*\//g, " ");
  const violations = [];
  for (const [re, why] of [
    [LITERAL_FONT_SIZE_RE, "字号必须取 var(--dsh-font-size-*)"],
    [HEAVY_FONT_WEIGHT_RE, "字重上限是 600（700 及以上在中文上是合成加粗）"],
  ]) {
    for (const m of css.matchAll(new RegExp(re.source, "g"))) {
      violations.push({ rule: "font-scale", file, detail: `${m[0].replace(/^[;{]\s*/, "").trim()} —— ${why}` });
    }
  }
  return violations;
}

/** 规则体里**非** `none`/`0` 的 border 声明——"这条面描边了"的机械判据。 */
function strokesIn(body) {
  return [...body.matchAll(/(?:^|;)\s*border(?:-(?:top|right|bottom|left))?\s*:\s*([^;]+)/g)]
    .map((m) => m[1].trim())
    .filter((v) => !/^(?:none|0)\b/.test(v));
}

/** 从 `<` 的**下一个字符**开始取一个 JSX 开标签：跳过字符串与 `{}` 里的表达式，在深度 0
 *  遇到 `>` 收尾——`onClose={() => …}` 里的 `>`、引号里的 `>` 都不算标签结束。 */
function jsxTagAt(text, start) {
  let depth = 0;
  let quote = "";
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (quote) { if (c === quote) quote = ""; continue; }
    if (c === '"' || c === "'" || c === "`") { quote = c; continue; }
    if (c === "{" || c === "(" || c === "[") depth++;
    else if (c === "}" || c === ")" || c === "]") depth--;
    else if (depth === 0 && c === ">") return text.slice(start, i);
    else if (depth === 0 && c === "<") return null;
  }
  return null;
}

/** `<Popover>` / `<Modal>` 的**调用方类**也是材质宿主的一半：材质层挂在这两个原语内部，
 *  宿主类由调用方传进来（`className` / `cardClassName`）——上面按 `<GlassLayer />` 反查宿主
 *  类的那套跨文件看不见它们（原语那个 div 的 className 是拼出来的，调用方的类在别的文件里）。
 *  2026-10-14 正是这里漏过一次：并发分支新加的 `.update-card` 带着一条 `border` 与一个已被
 *  收敛掉的 `--shadow-pop-drop` 落进合并，人工扫描与检查器都没看见。
 *  判据：开标签上的 className / cardClassName 解析出的类名，其规则不许有非 none 的 border。 */
function checkPrimitiveCallerStrokes(file, text, globalCss) {
  const violations = [];
  const modules = cssImportsOf(file, text);
  for (const m of text.matchAll(/<(?:Popover|Modal)\b/g)) {
    const tag = jsxTagAt(text, m.index + 1);
    if (!tag) continue;
    const attr = tag.match(/\b(?:className|cardClassName)\s*=\s*(\{[^{}]*\}|"[^"]*"|`[^`]*`)/);
    if (!attr) continue;
    for (const { file: cssFile, name, global } of glassHostClasses(attr[1], modules)) {
      const cssText = global
        ? [...globalCss.values()].find((txt) => ruleBodiesFor(txt, name) !== "")
        : readFileSync(cssFile, "utf8");
      if (!cssText) continue;
      const strokes = strokesIn(ruleBodiesFor(cssText, name));
      if (strokes.length > 0) {
        violations.push({
          rule: "glass-host",
          file,
          detail: `材质层宿主不许描边（.${name} 的 border: ${strokes[0]} 在 ${global ? "全局 CSS" : rel(cssFile)}）——面的范围由底色承担`,
        });
      }
    }
  }
  return violations;
}

function collect() {
  const files = SOURCE_ROOTS.flatMap((dir) => walk(dir)).filter((f) => !isTest(f));
  // 全局（非 module）CSS 的文本按文件留着：字面量类名的宿主在那几个文件里查。
  const globalCss = new Map(walk(FRONTEND_SRC, [], [".css"])
    .filter((f) => !f.endsWith(".module.css"))
    .map((f) => [f, readFileSync(f, "utf8")]));
  const violations = [...checkFlowRhythm()];
  for (const file of files) {
    if (file.endsWith(".ts") || file.endsWith(".tsx")) violations.push(...checkCssModuleClasses(file));
  }
  // 规则 3~6、9 只看前端：Swift 壳的样式不归 tokens.json 管。
  for (const file of walk(FRONTEND_SRC, [], [".css"]).filter((f) => !isTest(f))) {
    const text = readFileSync(file, "utf8");
    violations.push(...checkBareHex(file, text, true));
    violations.push(...checkFontScale(file, text));
    violations.push(...checkNarrowMediaMiniPanel(file, text));
    violations.push(...checkMiniPanelScope(file, text));
    violations.push(...checkSurfaceTiers(file, text.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))));
  }
  for (const file of files) {
    if (file.startsWith(FRONTEND_SRC) && file.endsWith(".tsx")) {
      const text = readFileSync(file, "utf8");
      violations.push(...checkBareHex(file, text, false));
      violations.push(...checkInlineStaticStyle(file, text));
      violations.push(...checkGlassHosts(file, text, globalCss));
      violations.push(...checkPrimitiveCallerStrokes(file, text, globalCss));
      violations.push(...checkGlassLayerDuplication(file, text));
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
