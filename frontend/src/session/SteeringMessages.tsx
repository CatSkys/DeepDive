// 立即发送/插话中消息的流内呈现（用户定稿，行为对照 zcode）：steer 一发出就以
// 用户气泡落在流尾、标「排队中」——不进 QueueDock 的条（那条只摆排队中的项）。
// 引擎在下一个 step 边界领取消息后，真实用户消息进流、队列快照撤项，气泡随
// 之退场；与流内已有用户消息同文的（真实消息先到/本端重复排队同文）不重复画。
import { t } from "../i18n";
import { UserBubble } from "./MessageRow";
import { queueText } from "./format";
import type { SessionQueuedItem } from "../types";

export function SteeringMessages({ items, sendingTexts, flowUserTexts }: {
  /** 队列快照里 placement=steering 的项（已递给引擎、还没被领取）。 */
  items: SessionQueuedItem[];
  /** 本端刚发出、快照尚未观察到的消息（rpcId→文本；Composer 登记而来）。 */
  sendingTexts: ReadonlyMap<string, string>;
  /** 流内已有用户消息的文本集合——同文的不再画（去重）。 */
  flowUserTexts: ReadonlySet<string>;
}) {
  const pending: Array<{ key: string; text: string }> = [];
  const seen = new Set<string>();
  const push = (key: string, text: string) => {
    if (!text || flowUserTexts.has(text) || seen.has(text)) return;
    seen.add(text);
    pending.push({ key, text });
  };
  for (const item of items) push(item.id, queueText(item));
  for (const [rpcId, text] of sendingTexts) push(rpcId, text);
  if (pending.length === 0) return null;
  return (
    <>
      {pending.map(({ key, text }) => (
        <div className="msg-block user steering-bubble" key={key}>
          <UserBubble text={text} />
          <div className="steering-meta" aria-live="polite">{t("排队中")}</div>
        </div>
      ))}
    </>
  );
}
