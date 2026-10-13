// 卡内的滚动清单（历史行 / 选择页共用）：把"超限用渐隐表示"这条标准件接上——
// `useEdgeFade` 量溢出（滚到边就不渐隐）+ 末尾 `.fade-y` 画 mask（UI-SPEC §0/§2.1：
// 超限只许渐隐表达，禁裸滚动条与生硬裁切线）。卡里此前是直接 overflow:auto 硬裁，
// 用户 2026-10-13 报"上下滚动超限不符合要求"。
//
// listRef 是可选的——历史行要拿它做"光标行滚进视野"，选择页不需要。
import { useCallback, type ReactNode } from "react";
import { fadeAttrs, useEdgeFade } from "../useEdgeFade";

export function MiniCcList({
  children,
  listRef,
}: {
  children: ReactNode;
  /** 别的用途也要拿这个容器时传进来（历史行用它把光标行滚进视野）。 */
  listRef?: { current: HTMLDivElement | null };
}) {
  const { ref: fadeRef, fade } = useEdgeFade<HTMLDivElement>("y");
  // 两个 ref 聚合在一个回调里（useEdgeFade 的接线法）：fade.ref 是稳定的 setState，
  // 所以这个回调的 identity 也稳定，不会每渲染重挂一次。
  const setRef = useCallback((el: HTMLDivElement | null) => {
    if (listRef) listRef.current = el;
    fadeRef(el);
  }, [listRef, fadeRef]);
  return (
    <div className="mini-cc-list fade-y" ref={setRef} {...fadeAttrs(fade)}>
      {children}
    </div>
  );
}
