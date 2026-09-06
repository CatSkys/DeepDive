// 首启欢迎页：引擎连上且 credentials.describe 正向确证「没有任何已配置
// 密钥」时整窗接管（读失败 ≠ 未配置，引擎瞬断绝不出现）。双栏磨砂卡：
// 左栏品牌与「开始使用」，右栏黑白液态金属纯视觉。「开始使用」收起引导并
// 直达设置页「模型」分节；× 只是当次会话收起，重启后仍未配置会再次出现。
// 监听住在 App（始终挂载），门内派发即可，无挂载时序问题。
import { useEffect, useState, type ReactNode } from "react";
import { ArrowRight, X } from "lucide-react";
import { useStore } from "../store";
import { useT } from "../i18n";
import { DD_EVENTS, dispatchAppEvent } from "../events";
import { useModelCatalog } from "./useModelCatalog";
import css from "./FirstRunGate.module.css";
// 品牌鲸鱼：design/logo 定稿导出物（黑底反白）的副本
import logoUrl from "../assets/deepdive-logo-256.png";

export function FirstRunGate({ children }: { children: ReactNode }) {
  const store = useStore();
  const { t } = useT();
  const cat = useModelCatalog();
  const { reload } = cat;
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (store.engineUp) void reload();
  }, [store.engineUp, reload]);

  if (dismissed || !(cat.configuredKnown && !cat.anyConfigured)) return <>{children}</>;

  const begin = (section: string) => {
    setDismissed(true);
    dispatchAppEvent(DD_EVENTS.openSettings, { section });
  };

  return (
    <div className="app">
      <div className={css.overlay}>
        <div className={css.card}>
          <button className={css.close} onClick={() => setDismissed(true)} aria-label={t("稍后再说")}>
            <X size={15} />
          </button>
          <div className={css.left}>
            <span className={css.badge}>{t("首次启动设置")}</span>
            <img className={css.logo} src={logoUrl} alt="" width={56} height={56} />
            <div className={css.title}>{t("欢迎使用 DeepDive")}</div>
            <div className={css.spacer} />
            <button className={css.primaryRow} onClick={() => begin("models")}>
              {t("开始使用")}
              <ArrowRight size={15} />
            </button>
            <button className={css.secondaryRow} onClick={() => begin("import")}>
              {t("导入会话")}
              <ArrowRight size={15} />
            </button>
            <div className={css.caption}>
              {t("可立即导入其他 Agent 的聊天，或开始时配置模型；也可以先跳过。")}
            </div>
          </div>
          <div className={css.right}>
            <LiquidMetal />
          </div>
        </div>
      </div>
    </div>
  );
}

/** 黑白液态金属：确定性 SVG（feTurbulence 位移银色光带），无外部资产、
 *  无随机种子。id 前缀 lm- 避免与页面其他 SVG 撞车。流动感两层：SMIL 让
 *  噪声场 baseFrequency 与位移 scale 缓慢演化（滤镜每拍重算，区域小可接受）；
 *  光带包一层 g 做 CSS transform 漂移（合成阶段，不重算滤镜）。 */
function LiquidMetal() {
  return (
    <svg className={css.metal} viewBox="0 0 380 500" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <defs>
        <linearGradient id="lm-base" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#2a2b30" />
          <stop offset="0.5" stopColor="#0a0a0c" />
          <stop offset="1" stopColor="#202127" />
        </linearGradient>
        <radialGradient id="lm-sheen" cx="0.32" cy="0.22" r="0.85">
          <stop offset="0" stopColor="#f7f8fa" stopOpacity="0.85" />
          <stop offset="0.45" stopColor="#9a9da6" stopOpacity="0.28" />
          <stop offset="1" stopColor="#000000" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="lm-band" x1="0" y1="0" x2="1" y2="0.2">
          <stop offset="0" stopColor="#ffffff" stopOpacity="0" />
          <stop offset="0.5" stopColor="#f2f4f8" stopOpacity="0.95" />
          <stop offset="1" stopColor="#ffffff" stopOpacity="0" />
        </linearGradient>
        <linearGradient id="lm-ridge" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#ffffff" stopOpacity="0" />
          <stop offset="0.45" stopColor="#ffffff" stopOpacity="0.9" />
          <stop offset="0.55" stopColor="#c9ccd4" stopOpacity="0.7" />
          <stop offset="1" stopColor="#ffffff" stopOpacity="0" />
        </linearGradient>
        <filter id="lm-flow" x="-40%" y="-40%" width="180%" height="180%">
          <feTurbulence type="fractalNoise" baseFrequency="0.006 0.028" numOctaves="4" seed="9" result="noise">
            <animate attributeName="baseFrequency" dur="22s" values="0.006 0.028;0.0072 0.023;0.006 0.028" repeatCount="indefinite" />
          </feTurbulence>
          <feDisplacementMap in="SourceGraphic" in2="noise" scale="140" xChannelSelector="R" yChannelSelector="G">
            <animate attributeName="scale" dur="15s" values="140;172;140" repeatCount="indefinite" />
          </feDisplacementMap>
        </filter>
        <filter id="lm-soft">
          <feGaussianBlur stdDeviation="7" />
        </filter>
        <filter id="lm-ridge">
          <feGaussianBlur stdDeviation="2.2" />
        </filter>
      </defs>
      <rect width="380" height="500" fill="url(#lm-base)" />
      <g filter="url(#lm-flow)">
        <g className={css.driftSheen}>
          <ellipse cx="120" cy="130" rx="220" ry="150" fill="url(#lm-sheen)" transform="rotate(-24 120 130)" />
        </g>
        <g className={css.driftBand1}>
          <ellipse cx="300" cy="290" rx="185" ry="40" fill="url(#lm-band)" opacity="0.6" transform="rotate(14 300 290)" filter="url(#lm-soft)" />
        </g>
        <g className={css.driftBand2}>
          <ellipse cx="80" cy="400" rx="210" ry="46" fill="url(#lm-band)" opacity="0.38" transform="rotate(-26 80 400)" filter="url(#lm-soft)" />
        </g>
        <g className={css.driftStreak}>
          <ellipse cx="290" cy="80" rx="140" ry="26" fill="#e6e9ee" opacity="0.22" transform="rotate(20 290 80)" filter="url(#lm-soft)" />
        </g>
        <g className={css.driftRidge1}>
          <path d="M -40 336 C 90 292, 250 372, 430 300" stroke="url(#lm-ridge)" strokeWidth="10" fill="none" filter="url(#lm-ridge)" />
        </g>
        <g className={css.driftRidge2}>
          <path d="M -40 208 C 110 168, 240 236, 430 176" stroke="url(#lm-ridge)" strokeWidth="6" fill="none" opacity="0.5" filter="url(#lm-ridge)" />
        </g>
      </g>
    </svg>
  );
}
