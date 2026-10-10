// 重试提示行（官方 ModelRetryItem 的移植，ui-chat/MessageItem.tsx）：一句话
// 状态 + 可展开的「重试延迟 / 失败原因」。不摆状态点、不露原始错误码——
// 失败原话收在展开体里；直播等待时文字微光脉冲（与运行中工具行同一手法）。
import { useEffect, useMemo, useState } from "react";
import { t, tt } from "../i18n";
import type { LlmRetryData } from "../types";

/** 官方 retrySeconds：向上取整到整秒、最低 1（倒计时归到 1 为止，不闪 0）。 */
function retrySeconds(ms: number): number {
  return Math.max(1, Math.ceil(ms / 1000));
}

/** 失败原因的说法（官方 failureMessage 口径）：AUTH 码翻人话，其余给原话；
 *  原话缺失退错误码，两者皆缺不给这段。 */
function failureMessage(d: LlmRetryData): string {
  if (d.failure?.code === "AUTH") return t("API 密钥无效");
  return d.failure?.message || d.failure?.code || "";
}

export function RetryRow({ data, active }: { data: LlmRetryData; active: boolean }) {
  const delayMs = data.delayMs;
  // 等待截止锚在本行首渲的本地时刻（官方同款：事件时间与 Date.now() 不同源，
  // 不能拿事件时间直接减）。同一等待的更新若换了 delayMs，随依赖重锚。
  const deadline = useMemo(() => Date.now() + (delayMs ?? 0), [delayMs]);
  const scheduled = delayMs !== undefined ? retrySeconds(delayMs) : undefined;
  const [left, setLeft] = useState(scheduled);
  useEffect(() => {
    if (!active || delayMs === undefined) return;
    const tick = (): number => {
      const next = retrySeconds(deadline - Date.now());
      setLeft((cur) => (cur === next ? cur : next));
      return next;
    };
    if (tick() <= 1) return;
    const timer = window.setInterval(() => {
      if (tick() <= 1) window.clearInterval(timer);
    }, 250);
    return () => window.clearInterval(timer);
  }, [active, deadline, delayMs]);
  const seconds = active ? left : scheduled;
  // 官方口径：normal 模式给上限，其余（always / 缺上限）都是 ∞
  const maximum = data.mode === "normal" && data.maxRetries !== undefined ? String(data.maxRetries) : "∞";
  const label = active ? t("正在重试模型请求") : t("等待重试模型请求");
  const head = tt("{label}（{retry}/{maximum}）", "{label} ({retry}/{maximum})", {
    label,
    retry: data.retry,
    maximum,
  });
  const why = failureMessage(data);
  return (
    <details className="retry-row" data-active={active || undefined}>
      <summary className="retry-summary">
        <span className="retry-text" role="status">
          {head}
          {seconds !== undefined ? ` · ${seconds}s` : ""}
        </span>
      </summary>
      {(delayMs !== undefined || why) && (
        <div className="retry-details">
          {delayMs !== undefined && (
            <div>
              <span className="retry-detail-label">{t("重试延迟")}</span>
              {Math.round(delayMs)}ms
            </div>
          )}
          {why && (
            <div>
              <span className="retry-detail-label">{t("失败原因")}</span>
              {why}
            </div>
          )}
        </div>
      )}
    </details>
  );
}
