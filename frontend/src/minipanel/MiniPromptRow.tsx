// 迷你面板首页的提示词胶囊行：一颗一个短标签，点一颗经 dd:composer-prefill 把整段
// 提示词预填进输入框（清单在 miniHomePrompts.ts）。
// 只管这一行的排布与溢出——**单行**，放不下时横向滚动，走仓库的标准件：滚动条隐藏 +
// 两端 24px 渐隐（useEdgeFade 给信号、theme.css 的 .fade-x 画遮罩）+ 滚轮就地消费
// （配方与底部空间切换条 .ws-switcher 同一条，那两个事实源都共用，别在别处再配一份）；
// 不管胶囊清单也不管整页布局（MiniDraft 的事）。

import { useEffect, useState } from "react";
import { DD_EVENTS, dispatchAppEvent } from "../events";
import { fadeAttrs, useEdgeFade } from "../useEdgeFade";
import { useT } from "../i18n";
import { MINI_HOME_PROMPTS } from "./miniHomePrompts";

export function MiniPromptRow() {
  const { tt } = useT();
  const fade = useEdgeFade("x");
  const [strip, setStrip] = useState<HTMLDivElement | null>(null);

  // 滚轮就地消费：有横向溢出时纵横滚轮都只滚这一行（同 .ws-switcher 那条）。
  // React onWheel 是 passive 监听、preventDefault 无效，必须原生挂。
  useEffect(() => {
    if (!strip) return;
    const el = strip;
    const onWheel = (e: WheelEvent) => {
      if (el.scrollWidth - el.clientWidth <= 0) return; // 无溢出：维持默认
      e.preventDefault();
      el.scrollLeft += Math.abs(e.deltaX) >= Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [strip]);

  return (
    <div
      className="mini-prompts fade-x"
      // 滚轮效果与渐隐测量各持一份引用，ref 回调里聚合到同一元素
      ref={(el) => { setStrip(el); fade.ref(el); }}
      {...fadeAttrs(fade.fade)}
    >
      {/* 内包一层 auto margin 居中：justify-content: center 在溢出时会把首端
          胶囊挤出可滚范围（flex 数据丢失），auto margin 溢出时归零 */}
      <div className="mini-prompts-row">
        {MINI_HOME_PROMPTS.map((p) => (
          <button
            type="button"
            key={p.label}
            className="mini-prompt"
            onClick={() => dispatchAppEvent(DD_EVENTS.composerPrefill, { text: tt(p.text, p.textEn) })}
          >
            {tt(p.label, p.labelEn)}
          </button>
        ))}
      </div>
    </div>
  );
}
