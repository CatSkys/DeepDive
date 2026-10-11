// `ui` 围栏块：流式容错解析 → 组件逐个渲染。与 mermaid/svg/widget 同族的富输出
// 围栏，降级纪律一致——闭合后解析不了/超限一律退回代码块显示原文，不吞内容。
// 未闭合且一项都没长出来时显示占位；已长出的项照常上屏（边生成边渲染）。
import { useMemo } from "react";
import { t } from "../../i18n";
import { RICH_FENCE_MAX_CHARS, UI_FENCE } from "../fences";
import { RichFallback } from "../RichFallback";
import { parseUiFence } from "./parse";
import { UiComponentView } from "./components";

export function UiBlock({ body, unclosed, onSend }: {
  body: string;
  unclosed: boolean;
  /** 动作回调：交互文本作为用户下一轮发出（mode 规则在 useSessionSend）。 */
  onSend?: (text: string) => void;
}) {
  const parsed = useMemo(() => parseUiFence(body, unclosed), [body, unclosed]);
  if (body.length > RICH_FENCE_MAX_CHARS) {
    return <RichFallback lines={body.split("\n")} lang={UI_FENCE} note={t("内容过大，已按源码显示")} />;
  }
  if (parsed.invalid) {
    return <RichFallback lines={body.split("\n")} lang={UI_FENCE} note={t("无法解析为组件，已按源码显示")} />;
  }
  return (
    <div className="md-ui">
      {parsed.items.map((item, i) => (
        <UiComponentView key={i} item={item} onSend={onSend} />
      ))}
      {parsed.pending && <p className="md-rich-pending">{t("正在生成组件…")}</p>}
    </div>
  );
}
