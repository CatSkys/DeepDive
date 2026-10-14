// 命令中心卡的**落点**：面板页算好卡片该占的矩形推给壳，壳把那张卡的透明 webview 与它
// 底下那块原生玻璃摆上去（QuickPanelController.placeCard）。
//
// 为什么几何在页面算：面板页知道面板的视口尺寸与胶囊位置（与 `composer-overlay` 同一条
// 分工——"rect 由 SPA 算，它知道面板网页那一格的几何"）。口径：面板正中、
// 宽 min(视口 − 72, 320)、高 min(视口 × 72%, 420)——两个上限都取**主窗命令面板的同值**
// （用户 2026-10-14："你这三个面板都可以跟他一样大"；320 是参考面板实测 314 的取整）。
// 圆角与时长按 CSS token 读（壳里不写第二份）——时长取 `--dur-med`：卡片入场是"原生弹性
// 缩放 + 两边一起淡入"，节奏要对齐。
//
// **这是卡片尺寸的唯一事实源**：卡片页的 CSS 只把 `.mini-cc` 铺满视口（那边不写尺寸），
// 壳按这里算出的矩形摆那块 webview 与它下面的原生玻璃。在 CSS 里改卡片宽高是无效的
// （2026-10-14 踩过：在 `theme.css` 把 380 改成 320，卡片纹丝不动）。
// 推送做差分，外加 300ms 安全网（无过渡的重排只有节拍兜得住，titlebar.ts 同款纪律）。
import { sendRects } from "../host";
import { hasRectChannel } from "../platform";

const PUSH_INTERVAL_MS = 300;
/** 卡片与面板边缘的横向留白总和（左右各一半）：窄面板里卡片贴边站的上限。 */
const SIDE_GUTTER = 72;
/** 宽上限 = 主窗命令面板的宽（320）。 */
const MAX_WIDTH = 320;
/** 高上限 = 主窗命令面板的高（420）：面板矮时仍由比例兜住，不硬撑。 */
const MAX_HEIGHT = 420;
/** 限高占面板高度的比例（面板很矮时的兜底）。 */
const MAX_HEIGHT_RATIO = 0.72;

export interface MiniCardFrame {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** 卡片该占的矩形（面板视口坐标，CSS px）。 */
export function cardFrame(): MiniCardFrame {
  const w = Math.min(window.innerWidth - SIDE_GUTTER, MAX_WIDTH);
  const h = Math.min(window.innerHeight * MAX_HEIGHT_RATIO, MAX_HEIGHT);
  return { x: (window.innerWidth - w) / 2, y: (window.innerHeight - h) / 2, w, h };
}

/** CSS 事实源里读一个像素值（圆角/时长都按 token 读，壳里不写第二份）。 */
function cssPx(name: string, fallback: number, root = document.documentElement): number {
  return parseFloat(getComputedStyle(root).getPropertyValue(name)) || fallback;
}

/**
 * 把"卡片开着/关着"连同它的几何推给壳。开着时按节拍重推（面板改尺寸、内容换脸都会移
 * 位置）；关掉时推一条 `frame: null`，壳把那张卡藏起来。
 */
export interface MiniCardHandle {
  /** 立刻推一次（换脸/切会话时不等节拍）。 */
  pushNow: () => void;
  /** 停表并收起卡片（壳把那张卡的 webview 与玻璃一起藏掉）。 */
  stop: () => void;
}

/**
 * 卡片开着期间把它的落点推给壳：按节拍重推（面板改尺寸、内容换脸都会移位置），
 * `getFace()` 返回 null 时推一条收起。返回 `pushNow`/`stop` 两个显式动作。
 */
export function pushCardFrame(
  getFace: () => { mode: string; sessionId: string | null; sessionPinned: boolean } | null,
): MiniCardHandle {
  if (!hasRectChannel()) return { pushNow: () => {}, stop: () => {} };
  let lastSig = "";
  const push = () => {
    const face = getFace();
    const payload = face === null
      ? { type: "mini-cc-frame", frame: null }
      : {
        type: "mini-cc-frame",
        frame: cardFrame(),
        mode: face.mode,
        sessionId: face.sessionId,
        // 会话置顶与否也随脸走：卡页那行标签要显示当前状态，而它是另一块 webview、
        // 另一份 store——让面板页把值报过来，卡页才看得见它（点了没反应那次的根因）。
        sessionPinned: face.sessionPinned,
        radius: cssPx("--dsh-radius-floating", 20),
        // 入场节奏与卡片那块原生玻璃的弹性缩放同一档（--dur-med）：网页只淡、原生淡+弹，
        // 两边分开算就会看出"一块东西分两次出现"。
        durationMs: cssPx("--dur-med", 200),
      };
    const sig = JSON.stringify(payload);
    if (sig === lastSig) return;
    lastSig = sig;
    sendRects(payload);
  };
  push();
  const iv = setInterval(push, PUSH_INTERVAL_MS);
  window.addEventListener("resize", push);
  return {
    pushNow: push,
    stop: () => {
      clearInterval(iv);
      window.removeEventListener("resize", push);
      sendRects({ type: "mini-cc-frame", frame: null });
    },
  };
}
