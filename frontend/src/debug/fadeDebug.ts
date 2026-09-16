/** 渐变模糊调试面板（⌥⌘D 切、?debug=fade 挂载）：把会话顶部渐隐模糊带的参数做成
 *  滑杆，现场拖、实时生效。值落在 :root 的 CSS 变量上（theme.css 里那条带子全部
 *  改读变量），所以重挂载/切会话不丢；「复制 CSS」把当前值生成为一段 :root 覆盖
 *  块——贴回 theme.css 的默认值块即固化。
 *
 *  默认值不在本文件抄一份：从 :root 现读（theme.css 是唯一事实源），「恢复默认」
 *  = 摘掉面板写的行内覆盖再读一次。
 *
 *  只在自己调参时用，不是产品功能：入口仅快捷键与 URL 参数，不进任何导航。 */

/** 一根滑杆：绑哪个 CSS 变量、什么单位、什么范围、以及它到底改什么。 */
export interface FadeKnob {
  key: string;
  label: string;
  unit: "px" | "%";
  min: number;
  max: number;
  /** 这根旋钮的作用（面板上显示，免得再出现「拖了没反应」的黑箱旋钮）。 */
  hint: string;
}

export const FADE_KNOBS: FadeKnob[] = [
  { key: "--session-fade-top", label: "模糊带高", unit: "px", min: 0, max: 240, hint: "顶部雾带的高度" },
  { key: "--session-fade-blur", label: "模糊强度", unit: "px", min: 0, max: 24, hint: "带顶的模糊半径（随滚动衬满）" },
  { key: "--session-fade-solid", label: "满模糊至", unit: "%", min: 0, max: 100, hint: "带顶往下多少以内保持满模糊" },
  { key: "--session-fade-fade", label: "渐隐至", unit: "%", min: 0, max: 100, hint: "到带子的这个位置模糊归零" },
  { key: "--session-header-h", label: "内容让位", unit: "px", min: 0, max: 120, hint: "消息流顶部留白＝头部高度" },
];

const STORE_KEY = "deepdive.debug.fade";
const KEYS = FADE_KNOBS.map((k) => k.key);
const unitOf = (key: string) => FADE_KNOBS.find((k) => k.key === key)?.unit ?? "px";

export type FadeValues = Record<string, number>;

/** 读 :root 上的当前值（theme.css 的默认，或上一次拖动留下的行内覆盖）。 */
function readRootValues(): FadeValues {
  const computed = getComputedStyle(document.documentElement);
  const out: FadeValues = {};
  for (const { key } of FADE_KNOBS) out[key] = Math.round(parseFloat(computed.getPropertyValue(key)) || 0);
  return out;
}

/** 面板当前值：:root 的值 + 上次拖动存下的覆盖（只认在册的旋钮键）。
 *  旧版本存过别的键（三层时代）——忽略，不当成临时值带进来。 */
export function loadFadeValues(): FadeValues {
  const base = readRootValues();
  try {
    const saved = JSON.parse(localStorage.getItem(STORE_KEY) ?? "{}") as FadeValues;
    for (const key of KEYS) {
      if (Number.isFinite(saved[key])) base[key] = saved[key];
    }
  } catch { /* 存档损坏：用 :root 的值 */ }
  return base;
}

/** 把当前值写到 :root（页面立即生效；变量在根上，切会话/重挂不丢）。 */
export function applyFadeValues(v: FadeValues) {
  const root = document.documentElement.style;
  for (const [key, n] of Object.entries(v)) {
    root.setProperty(key, `${n}${unitOf(key)}`);
  }
}

/** 记下这次拖动（下次挂载/切会话接着用）。 */
export function saveFadeValues(v: FadeValues): void {
  localStorage.setItem(STORE_KEY, JSON.stringify(v));
}

/** 恢复默认：摘掉行内覆盖，回到 theme.css 的 :root 默认值。 */
export function resetFadeValues(): FadeValues {
  const root = document.documentElement.style;
  for (const key of KEYS) root.removeProperty(key);
  localStorage.removeItem(STORE_KEY);
  return readRootValues();
}

/** 生成可固化的 CSS（贴回 theme.css 的 :root 即永久生效）。 */
export function buildFadeCss(v: FadeValues): string {
  const lines = KEYS.map((key) => `  ${key}: ${v[key]}${unitOf(key)};`);
  return `:root {\n${lines.join("\n")}\n}`;
}

/** ⌥⌘D 开关判据：只认物理键码 `code`——macOS 在 Option 按下时会把 `key` 合成为
 *  Option 层字符（US 布局 ⌥D 是 "∂"），按 `key === "d"` 判定在真机上永不命中。 */
export function isFadeDebugShortcut(e: Pick<KeyboardEvent, "metaKey" | "altKey" | "code">): boolean {
  return e.metaKey && e.altKey && e.code === "KeyD";
}
