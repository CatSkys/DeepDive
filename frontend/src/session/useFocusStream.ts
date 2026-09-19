import { useEffect, useRef, useState } from "react";

// 流式对焦揭示：把直播缓冲区按受控节奏揭示成前缀 shown，替代"chunk 到多少
// 就整段闪现多少"的打字机观感。只管揭示节奏，不管渲染与动画（动画是
// .streaming 作用域里的 CSS 块级/行级对焦）。
//
// 粒度自适应（用户定稿策略，快档同时是流式期的渲染减负——揭示与动画按
// "行/句"计而不是按"字"计）：
// - 慢档（落后 ≤16 字，模型逐字涓流）：逐字揭示，跟随原文 cadence；
// - 快档（整行/整段 burst）：按整句/整行推进——每步推进到下一个句末标点
//   或换行（上限内），落后量按 剩余/5 指数收敛，几千字的 burst 也在半秒
//   内凝完，绝不拖尾；无标点的长行（代码等）按步长上限硬切。

const SLOW_CHARS = 16;
const MIN_STEP = 8;

/** 句末/行末边界：揭到这个字符为止（含）。 */
function isBoundary(c: string): boolean {
  return c === "\n" || "。！？；：!?;:.".includes(c);
}

export function useFocusStream(full: string, active: boolean): string {
  const [shownLen, setShownLen] = useState(() => (active ? 0 : full.length));
  const lenRef = useRef(full);
  lenRef.current = full;

  useEffect(() => {
    if (!active) {
      // 本项不再是直播尾（工具行接管/轮次结束）：立即补齐，绝不留半截
      setShownLen(lenRef.current.length);
      return;
    }
    let raf = 0;
    let stopped = false;
    const tick = () => {
      if (stopped) return;
      setShownLen((prev) => {
        const len = lenRef.current.length;
        const remaining = len - prev;
        if (remaining <= 0) return prev;
        if (remaining <= SLOW_CHARS) return prev + 1; // 慢档：逐字
        // 快档：目标步长内优先对齐整句/整行边界；边界刚好在步长之外一点
        // （≤16 字）时宁可贵一步补完整句，不留半句在下一步
        const cap = Math.min(prev + Math.max(MIN_STEP, Math.ceil(remaining / 5)), len);
        const slack = Math.min(cap + 16, len);
        for (let i = prev + 1; i <= slack; i++) {
          if (isBoundary(lenRef.current[i - 1] ?? "")) return i;
        }
        return cap;
      });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      stopped = true;
      cancelAnimationFrame(raf);
    };
  }, [active]);

  return active ? full.slice(0, shownLen) : full;
}
