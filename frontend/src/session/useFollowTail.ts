// 会话流滚动容器的**贴底跟随**（会话页与悬浮对话卡共用一份）：内容变高时把视图钉在
// 最新一条，用户上滑即交还控制权，滚回底部恢复。
//
// 只管"要不要跟着底部走"这一件事：容器其余滚动语义（滚到顶翻页、渐隐、底部留白）仍
// 由调用方自己的 onScroll 承担，这里给出判定与那一行吸附。
//
// 曾经只住在会话页里，悬浮对话卡没有它——用户报障"浏览器里的悬浮对话发完消息不自己
// 滚到底，得手动拉"。
import { useCallback, useEffect, useRef, useState } from "react";
import type { RefObject } from "react";

/** 离底小于这个距离就算还贴着（与会话页原来的内联 32px 同值）。 */
const FOLLOW_TOLERANCE_PX = 32;

export interface FollowTail {
  /** 当前是否跟着底部走（false = 用户上滑接管中）。 */
  follow: boolean;
  /** follow 的 ref 镜像：滚动的缓动/校正里要同步读，state 此刻还是旧值。 */
  followRef: React.MutableRefObject<boolean>;
  /** 挂到滚动容器的 onScroll：只判跟随，不接管容器其余滚动语义。 */
  onScroll: (el: HTMLDivElement) => void;
}

export function useFollowTail(scrollRef: RefObject<HTMLDivElement | null>, items: unknown): FollowTail {
  const [follow, setFollow] = useState(true);
  const followRef = useRef(true);
  followRef.current = follow;
  useEffect(() => {
    if (follow && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [items, follow, scrollRef]);
  const onScroll = useCallback((el: HTMLDivElement) => {
    setFollow(el.scrollTop + el.clientHeight >= el.scrollHeight - FOLLOW_TOLERANCE_PX);
  }, []);
  return { follow, followRef, onScroll };
}
