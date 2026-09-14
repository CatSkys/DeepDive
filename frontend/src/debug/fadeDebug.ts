/** 渐变模糊调试面板（?debug=fade 时挂载）：把会话顶部渐隐模糊的全部参数
 *  做成滑杆，现场拖、实时生效。值落在 :root 的 CSS 变量上（theme.css 里全部
 *  改读变量），所以重挂载/切会话不丢；「复制 CSS」把当前值生成为一段 :root
 *  覆盖块——交给 agent 或直接替换 theme.css 里的默认值即固化。
 *
 *  只在自己调参时用，不是产品功能：入口仅 URL 参数，不进任何导航。 */

export const FADE_DEBUG_DEFAULTS = {
  "--session-fade-top": 88,
  "--flow-fade-len": 56,
  "--session-header-h": 59,
  "--fade-blur-1": 3,
  "--fade-m1a": 45,
  "--fade-m1b": 100,
  "--fade-blur-2": 6,
  "--fade-m2a": 25,
  "--fade-m2b": 80,
  "--fade-blur-3": 11,
  "--fade-m3a": 10,
  "--fade-m3b": 55,
} as const;

export type FadeDebugKey = keyof typeof FADE_DEBUG_DEFAULTS;
export type FadeDebugValues = Record<FadeDebugKey, number>;

const STORE_KEY = "deepdive.debug.fade";
const IS_PERCENT = (k: string) => /-m[123][ab]$/.test(k);
const unit = (k: string) => (IS_PERCENT(k) ? "%" : "px");

export function loadFadeValues(): FadeDebugValues {
  try {
    return { ...FADE_DEBUG_DEFAULTS, ...JSON.parse(localStorage.getItem(STORE_KEY) ?? "{}") };
  } catch {
    return { ...FADE_DEBUG_DEFAULTS };
  }
}

/** 把当前值写到 :root（页面立即生效；变量在根上，切会话/重挂不丢）。 */
export function applyFadeValues(v: FadeDebugValues) {
  const root = document.documentElement.style;
  for (const [k, n] of Object.entries(v)) {
    root.setProperty(k, `${n}${unit(k)}`);
  }
}

/** 生成可固化的 CSS（贴回 theme.css 的 :root 即永久生效）。 */
export function buildFadeCss(v: FadeDebugValues): string {
  const lines = Object.entries(v).map(([k, n]) => `  ${k}: ${n}${unit(k)};`);
  return `:root {\n${lines.join("\n")}\n}`;
}

export const SLIDERS: Array<{ key: FadeDebugKey; label: string; min: number; max: number }> = [
  { key: "--session-fade-top", label: "模糊带高", min: 40, max: 160 },
  { key: "--flow-fade-len", label: "渐隐段", min: 0, max: 120 },
  { key: "--session-header-h", label: "内容让位", min: 40, max: 100 },
  { key: "--fade-blur-1", label: "层1 模糊", min: 0, max: 16 },
  { key: "--fade-m1a", label: "层1 全显至", min: 0, max: 100 },
  { key: "--fade-m1b", label: "层1 渐隐至", min: 0, max: 100 },
  { key: "--fade-blur-2", label: "层2 模糊", min: 0, max: 20 },
  { key: "--fade-m2a", label: "层2 全显至", min: 0, max: 100 },
  { key: "--fade-m2b", label: "层2 渐隐至", min: 0, max: 100 },
  { key: "--fade-blur-3", label: "层3 模糊", min: 0, max: 28 },
  { key: "--fade-m3a", label: "层3 全显至", min: 0, max: 100 },
  { key: "--fade-m3b", label: "层3 渐隐至", min: 0, max: 100 },
];
