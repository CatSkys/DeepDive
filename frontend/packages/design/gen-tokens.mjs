#!/usr/bin/env node
// DeepDive design-token codegen.
// Single source of truth: frontend/packages/design/tokens.json
// Output:
//   frontend/packages/design/generated/tokens.css  (CSS custom properties)
// Any hand-written color/number outside this output is a spec violation.
// （曾有 Tokens.swift 生成腿，壳侧零消费，已砍——AUD-031。）

import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const tokensPath = resolve(root, "frontend/packages/design/tokens.json");
const tokens = JSON.parse(readFileSync(tokensPath, "utf8"));

const isColorPair = (v) =>
  v && typeof v === "object" && "light" in v && "dark" in v;

const cssId = (path) => "--dsh-" + path.join("-");

// Radius tokens must carry a unit: `border-radius: var(--dsh-radius-x)` with
// a bare number is invalid at computed-value time and silently becomes 0
// (square corners). CSS is the only consumer, so the unit lives here.
const emitStatic = (id, raw) => {
  const v = String(raw);
  const unit = id.startsWith("--dsh-radius-") && !/(px|%)$/.test(v) ? "px" : "";
  return `  ${id}: ${v}${unit};`;
};

// ---------- tokens.css ----------
const cssLight = [];
const cssDark = [];
const cssStatic = [];

function walk(obj, prefix = []) {
  for (const [key, value] of Object.entries(obj)) {
    const path = [...prefix, key];
    if (isColorPair(value)) {
      cssLight.push(`  ${cssId(path)}: ${value.light};`);
      cssDark.push(`  ${cssId(path)}: ${value.dark};`);
    } else if (value && typeof value === "object" && !("px" in value) && !("ms" in value)) {
      walk(value, path);
    } else if (value && typeof value === "object") {
      // scalar leaf (px / ms object) — emit raw
      cssStatic.push(emitStatic(cssId(path), value.px ?? value.ms));
    } else {
      cssStatic.push(emitStatic(cssId(path), value));
    }
  }
}
// 字号阶梯（ZCode 口径）：一个基准 + 每档偏移，整梯随基准移动。裸数字在
// font-size 上 invalid-at-computed-value-time、静默退回继承字号，所以基准与
// 显示级档位都要补 px；带 offset 的档位一律生成 calc()，使「改一个字改整梯」
// 成立（与 radius 那条同因：CSS 是唯一消费者，单位/算式只在这里写）。
function emitFontScale(font) {
  cssStatic.push(`  --dsh-ui-font-size: ${font.base.px}px;`);
  for (const [name, step] of Object.entries(font.size)) {
    const id = `--dsh-font-size-${name}`;
    if (step.px != null) {
      cssStatic.push(`  ${id}: ${step.px}px;`);
    } else if (step.offset === 0) {
      cssStatic.push(`  ${id}: var(--dsh-ui-font-size);`);
    } else {
      const sign = step.offset > 0 ? "+" : "-";
      cssStatic.push(`  ${id}: calc(var(--dsh-ui-font-size) ${sign} ${Math.abs(step.offset)}px);`);
    }
  }
}

// ---------- 内容层彩字的对比度校正（照 Raycast 的 --x-contrast / --x-on-tint）----------
// Raycast 在运行时用 colorjs 给每个彩字派生可读变体（它的主题是运行时可换的数据）。
// 我们只有静态两套主题，所以同一件事放在生成期：不引运行时依赖，产物是可审阅的静态值。
// 数学用 WCAG 2.x 相对亮度——公开的两行公式，不是自造的色彩空间。
const parseColor = (s) => {
  const hex = /^#([0-9a-f]{6})$/i.exec(s.trim());
  if (hex) {
    const n = parseInt(hex[1], 16);
    return { rgb: [(n >> 16) & 255, (n >> 8) & 255, n & 255], a: 1 };
  }
  const fn = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/i.exec(s.trim());
  if (fn) return { rgb: [+fn[1], +fn[2], +fn[3]], a: fn[4] == null ? 1 : +fn[4] };
  throw new Error(`gen-tokens: 无法解析颜色 ${s}`);
};
const over = ({ rgb, a }, bg) => rgb.map((c, i) => a * c + (1 - a) * bg[i]);
const relLum = ([r, g, b]) => {
  const lin = (v) => ((v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
};
const ratio = (a, b) => {
  const [hi, lo] = [relLum(a), relLum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};
const toHex = (rgb) =>
  "#" + rgb.map((v) => Math.round(v).toString(16).padStart(2, "0").toUpperCase()).join("");
// 达标就原样返回；不达标就把颜色朝「离背景更远的那一端」插值，二分出最小改动量。
// 二分得到的浮点值再过一遍 8 位取整才算数——取整可能把比值压回门槛之下（实测 warn
// 在亮色下取整后落到 4.48），所以最后按取整后的结果复验、不够就继续往极端挪一格。
const ensureContrast = (fg, bg, target) => {
  if (ratio(fg, bg) >= target) return fg;
  const toward = relLum(bg) < 0.5 ? [255, 255, 255] : [0, 0, 0];
  const fit = (t) => fg.map((v, j) => Math.round(v + (toward[j] - v) * t));
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 24; i++) {
    const t = (lo + hi) / 2;
    if (ratio(fit(t), bg) >= target) hi = t;
    else lo = t;
  }
  const out = fit(hi);
  for (let step = 0; step < 255 && ratio(out, bg) < target; step++) {
    for (let j = 0; j < 3; j++) {
      out[j] = Math.min(255, Math.max(0, out[j] + Math.sign(toward[j] - out[j])));
    }
  }
  return out;
};

// 文字色阶：把「一个基色 + 统一停靠点」在生成期展开成具体 rgba。
// Raycast 用相对颜色语法在运行时合成（`rgb(from var(--fg) r g b / 60%)`），因为它的
// 主题是运行时可换的数据；我们只有静态两套，所以在这里解析掉——CSS 侧零运行时特性、
// 产物可直接读出每个档位的实际颜色，改主题仍然只动 color.ink.base 一个数。
function emitInk() {
  const { base, stop } = tokens.color.ink;
  const inverse = tokens.color.ink["inverse-base"];
  for (const [theme, bucket] of [["light", cssLight], ["dark", cssDark]]) {
    const rgba = (rgb, alpha) => `rgba(${rgb.join(",")},${String(alpha).replace(/^0\./, ".")})`;
    const rgb = parseColor(base[theme]).rgb;
    for (const [name, alpha] of Object.entries(stop)) {
      bucket.push(`  --dsh-ink-${name}: ${rgba(rgb, alpha)};`);
    }
    // 反色基只用到 80 这一档（--on-ink：反色面上的前景），故只发一档。
    bucket.push(`  --dsh-ink-inverse-80: ${rgba(parseColor(inverse[theme]).rgb, stop["80"])};`);
  }
}

function emitContrast() {
  const target = tokens.contrast.target;
  for (const theme of ["light", "dark"]) {
    const bucket = theme === "light" ? cssLight : cssDark;
    const card = parseColor(tokens.contrast.on[theme]).rgb;
    // signal：用法是「压面」（`color: var(--dsh-signal-x)` 直接落在卡面上）
    for (const [name, pair] of Object.entries(tokens.color.signal)) {
      const fg = parseColor(pair[theme]).rgb;
      bucket.push(`  --dsh-signal-${name}-contrast: ${toHex(ensureContrast(fg, card, target))};`);
    }
    // diff：ink 两种用法——压自己的染色底（.diff-line）与压卡面（.rv-add 这类没有底的）。
    // 这里只发射派生变体：原始 ink 是派生源、没有裸用它的地方（发了就是无消费者的死数据）。
    for (const kind of ["add", "del"]) {
      const { ink, tint } = tokens.color.diff[kind];
      const fg = parseColor(ink[theme]).rgb;
      const tinted = over(parseColor(tint[theme]), card);
      bucket.push(`  --dsh-diff-${kind}-tint: ${tint[theme]};`);
      bucket.push(`  --dsh-diff-${kind}-ink-contrast: ${toHex(ensureContrast(fg, card, target))};`);
      bucket.push(`  --dsh-diff-${kind}-ink-on-tint: ${toHex(ensureContrast(fg, tinted, target))};`);
    }
  }
}

// ink 与 diff 两组不进通用 walk：ink 展开成停靠点、diff 的 ink 只以派生变体被消费，
// 两者都由上面的专用发射器输出（通用 walk 会把它们按「一对 light/dark 色值」发出去，
// 那些裸值在 CSS 侧没有消费者）。
const { ink: _ink, diff: _diff, ...colorWalked } = tokens.color;
walk(colorWalked);
emitInk();
emitContrast();
walk({ radius: tokens.radius });
walk({ font: { ui: tokens.font.ui, mono: tokens.font.mono } });
emitFontScale(tokens.font);

let css = `/* Generated by gen-tokens.mjs — DO NOT EDIT. Source: tokens.json v${tokens.version} */\n:root {\n${cssLight.join("\n")}\n${cssStatic.join("\n")}\n}\n@media (prefers-color-scheme: dark) {\n:root {\n${cssDark.join("\n")}\n}\n}\n`;

const cssOut = resolve(root, "frontend/packages/design/generated/tokens.css");
mkdirSync(dirname(cssOut), { recursive: true });
writeFileSync(cssOut, css);

console.log(`gen-tokens: wrote tokens.css (${css.length}B)`);
