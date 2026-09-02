import { useEffect, useRef } from "react";

/** Hover 滚动文本：窄容器（侧栏标题 / 模型名）省略号截断的补救。
 *  常态与普通截断 span 完全一致；hover 且文本确实溢出时，整体左右
 *  往返滚动展示全文（两端各停半秒再折返），离开或卸载立即复位；
 *  未溢出的 hover 不产生任何动画。
 *  外层承接宿主 className（flex/ellipsis 布局原样保留），内层是
 *  被平移的文本。滚动期间容器切 text-overflow:clip 并加两侧渐隐
 *  遮罩——否则"..."会钉在裁剪边上与滚过的文字叠画。 */
export function HoverScrollText({ className, children }: { className?: string; children: string }) {
  const boxRef = useRef<HTMLSpanElement>(null);
  const animRef = useRef<Animation | null>(null);

  const stop = () => {
    animRef.current?.cancel();
    animRef.current = null;
    boxRef.current?.classList.remove("hs-scrolling");
  };

  const start = () => {
    const box = boxRef.current;
    if (!box) return;
    // scrollWidth 按整数取整，1px 内视为没溢出
    const dist = box.scrollWidth - box.clientWidth;
    if (dist <= 1) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    stop();
    box.classList.add("hs-scrolling");
    // 单程 40px/s（限 0.6~8s），随溢出量变速：长标题滚得久但始终可读
    const travel = Math.min(8, Math.max(0.6, dist / 40));
    const hold = 0.5;
    const total = 2 * (travel + hold);
    const at = (sec: number) => ({ offset: sec / total });
    animRef.current = (box.firstElementChild as HTMLElement).animate(
      [
        { transform: "translateX(0)" },
        { transform: "translateX(0)", ...at(hold) },
        { transform: `translateX(${-dist}px)`, ...at(hold + travel) },
        { transform: `translateX(${-dist}px)`, ...at(2 * hold + travel) },
        { transform: "translateX(0)" },
      ],
      { duration: total * 1000, iterations: Infinity },
    );
  };

  useEffect(() => stop, []);

  return (
    <span
      ref={boxRef}
      className={className ? `hs-box ${className}` : "hs-box"}
      onMouseEnter={start}
      onMouseLeave={stop}
    >
      <span className="hs-text">{children}</span>
    </span>
  );
}
