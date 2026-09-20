// 启动骨架屏（引擎启动期）：SPA 已加载、引擎尚未就绪时，用界面自身的形状占位，
// 整屏同步脉冲——此前的空侧栏 + 空 hero 看着像"数据没了/打不开"（用户反馈的歧义）。
// 管什么：形状、脉冲、以及结束时的整层淡出；不管什么：真实内容与交互。
//
// 它是**覆盖层**（绝对定位盖住 .boot-shell，见 theme.css 的 .boot-stage）：
// 启动期单显，引擎就绪后整层淡出、真实界面同时淡入——淡出跑完由 onTransitionEnd
// 通知调用方卸载（卸载时机不写第二份时长，CSS 是唯一事实源）。
// 容器复用 theme.css 的 .sidebar/.main：几何与真实布局同源（宽度/圆角/缝/侧栏
// 可调宽都对得上），不同步两份尺寸。
import { useT } from "../i18n";
import css from "./BootSkeleton.module.css";

/** 会话行的占位宽度（%）：错落才像真列表，等宽会读成表格。 */
const ROW_WIDTHS = [62, 44, 71, 37, 55];

export function BootSkeleton({ fading, onFadedOut }: {
  /** 引擎已就绪：整层开始淡出。 */
  fading: boolean;
  /** 淡出结束（CSS transition 跑完）——调用方据此卸载。 */
  onFadedOut: () => void;
}) {
  const { t } = useT();
  return (
    <div
      className={css.overlay}
      data-fading={fading ? "1" : "0"}
      onTransitionEnd={(e) => {
        if (fading && e.propertyName === "opacity") onFadedOut();
      }}
    >
      <aside className="sidebar" aria-hidden="true">
        <div className={css.sidebarInner}>
          {/* 首行 = 侧栏的「新会话」入口 */}
          <div className={css.row}>
            <span className={`${css.block} ${css.glyph}`} />
            <span className={`${css.block} ${css.line}`} style={{ width: "52%" }} />
          </div>
          {/* 分组标签（置顶 / 今天…） */}
          <span className={`${css.block} ${css.group}`} />
          {ROW_WIDTHS.map((w, i) => (
            <div className={css.row} key={i}>
              <span className={`${css.block} ${css.glyph}`} />
              <span className={`${css.block} ${css.line}`} style={{ width: `${w}%` }} />
            </div>
          ))}
        </div>
        {/* 侧栏脚（设置 / 数据目录两个入口） */}
        <div className={css.foot}>
          <span className={`${css.block} ${css.footBtn}`} />
          <span className={`${css.block} ${css.footBtn}`} />
        </div>
      </aside>
      <main className="main" role="status" aria-label={t("正在启动引擎…")}>
        <div className={css.hero}>
          <span className={`${css.block} ${css.heroTitle}`} />
          <span className={`${css.block} ${css.heroSub}`} />
          {/* composer 胶囊：外壳不脉冲（它是容器），里面的块跟全局同拍 */}
          <div className={css.composer}>
            <span className={`${css.block} ${css.plus}`} />
            <span className={`${css.block} ${css.line}`} style={{ width: "42%" }} />
            <span className={`${css.block} ${css.send}`} />
          </div>
        </div>
      </main>
    </div>
  );
}
