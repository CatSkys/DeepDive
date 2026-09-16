// mermaid 渲染：只有当正文真的出现 mermaid 围栏时才 import mermaid（米级依赖，独立
// 分块，与 pdf.js 同一策略）；结果按 (源码, 明暗) 记忆化——流式期间同一张图逐增量重渲，
// 命中缓存即零成本。配色从 CSS 语义变量现读并合成为不透明色：图示跟随应用明暗，不写死
// 调色板（mermaid 自带主题是蓝调，与本仓黑白设计语言冲突）。
import type { MermaidConfig } from "mermaid";
import { compositeOver, parseCssColor } from "./cssColor";
import { sanitizeSvg } from "./sanitizeSvg";

let loading: Promise<typeof import("mermaid")> | null = null;
function mermaidModule() {
  loading ??= import("mermaid");
  return loading;
}

const cache = new Map<string, Promise<string>>();
const CACHE_MAX = 60;
let seq = 0;

/**
 * 源码 → SVG 串。语法错误、mermaid 内部失败、配色变量缺失都抛错，由调用方退回
 * 代码块显示源码（不静默给一张空白图）。
 */
export function renderMermaid(code: string, dark: boolean): Promise<string> {
  const key = `${dark ? "dark" : "light"}\u0000${code}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const job = mermaidModule().then(async ({ default: mermaid }) => {
    mermaid.initialize(configure(dark));
    const { svg } = await mermaid.render(`dsh-md-${seq++}`, code);
    const clean = sanitizeSvg(svg);
    if (clean === null) throw new Error("mermaid returned no svg root");
    return clean;
  });
  if (cache.size >= CACHE_MAX) cache.clear();
  cache.set(key, job);
  // 失败不进缓存：换主题或重挂时应当重新渲染，不能把错误钉死
  job.catch(() => cache.delete(key));
  return job;
}

function configure(dark: boolean): MermaidConfig {
  return {
    startOnLoad: false,
    // securityLevel strict：标签里的 HTML 与脚本由 mermaid 自己消毒后再进 DOM
    securityLevel: "strict",
    // 解析失败不往 document.body 塞错误节点（默认会塞）
    suppressErrorRendering: true,
    theme: "base",
    themeVariables: themeVariables(dark),
    // 标签走 SVG <text>，不用 foreignObject 包 HTML。必须写**顶层**键：mermaid 的
    // getEffectiveHtmlLabels 读 `config.htmlLabels ?? config.flowchart?.htmlLabels ?? true`，
    // 而默认配置里顶层 htmlLabels 已是 true——写 flowchart.htmlLabels 会被它整条忽略
    // （mermaid 为此还发 deprecated 告警），于是标签仍是 foreignObject，被内联 SVG 的
    // 消毒剥掉后图上只剩框、一个字都没有。
    htmlLabels: false,
    fontFamily: getComputedStyle(document.body).fontFamily,
  };
}

type Rgb = [number, number, number];

function themeVariables(dark: boolean): Record<string, string> {
  const backdrop = requireColor(readVar("--panel-strong"), "--panel-strong").slice(0, 3) as Rgb;
  const fill = solid("--fill-strong", backdrop);
  const fillSoft = solid("--fill", backdrop);
  const line = solid("--line-heavy", backdrop);
  return {
    darkMode: String(dark),
    background: "transparent",
    primaryColor: fill,
    primaryTextColor: solid("--ink-bright", backdrop),
    primaryBorderColor: line,
    secondaryColor: fillSoft,
    secondaryTextColor: solid("--ink", backdrop),
    tertiaryColor: fillSoft,
    tertiaryTextColor: solid("--ink", backdrop),
    lineColor: line,
    textColor: solid("--ink-bright", backdrop),
    nodeBorder: line,
    nodeTextColor: solid("--ink-bright", backdrop),
    clusterBkg: fillSoft,
    clusterBorder: line,
    titleColor: solid("--ink-bright", backdrop),
    edgeLabelBackground: solid("--panel-strong", backdrop),
    fontSize: "13px",
  };
}

function readVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

/** 语义变量 → 不透明 hex（垫在面板底色上）。烘进产物的颜色进不去半透明值。 */
function solid(name: string, backdrop: Rgb): string {
  return compositeOver(requireColor(readVar(name), name), backdrop);
}

/** 变量缺失或值不是颜色 = 主题层真出事了：抛错退回代码块，不用灰图糊过去
 *  （PITFALLS §1.13 同源——未定义变量是静默失效，不是可以兜底的情况）。 */
function requireColor(value: string, name: string): [number, number, number, number] {
  const parsed = parseCssColor(value);
  if (parsed === null) throw new Error(`theme variable ${name} is not a color: "${value}"`);
  return parsed;
}

