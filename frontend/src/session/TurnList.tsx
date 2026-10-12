// 会话流的**轮渲染**（唯一一份）：按轮分组吐 .turn-group 节点，轮内过程折叠（"已工作 x"
// 披露条 + 收起过程项）与流末的运行中 loader 也在这里。会话页与悬浮对话卡共用它——两边各写
// 一套的结果是行为漂移（实测用户报"对话卡里没有已工作的折叠""对话卡里没有 loader"）。
//
// 只负责渲染：数据来自 useSessionEvents/renderModel，折叠开关由调用方持有（会话页那份要
// 跨重渲染保留，对话卡各自一份）。
import { Fragment, type MutableRefObject } from "react";
import type { RenderItem } from "./renderModel";
import type { TurnGroup } from "../turnGroups";
import { groupTools } from "./toolGroups";
import { Item } from "./Item";
import { ToolGroupRow } from "./ToolGroupRow";
import { TurnProcessBar } from "./TurnProcessBar";
import { computeTurnProcessCached } from "./turnProcess";
import { LoadingState } from "../components/LoadingState";
import { openDeepDiving } from "../game/store";

export function TurnList({ keyIdx, groups, running, runningSince, liveItem, processOpen, setProcessOpen, sessionId, wsPath, cwd, olderAnchorRef, onBranch, onPreviewFile, onSendPrompt, onWidgetError, onContinue }: {
  /** 首个成员的 key → 索引（翻页锚点落点用） */
  keyIdx: Map<string, number>;
  groups: TurnGroup[];
  running: boolean;
  /** 运行中计时器的起点（epoch ms）；缺则 loader 从挂载起算。 */
  runningSince?: number;
  liveItem: RenderItem | undefined;
  processOpen: ReadonlySet<number>;
  /** 折叠开关由调用方持有（会话页那份要跨重渲染保留；对话卡各自一份） */
  setProcessOpen: React.Dispatch<React.SetStateAction<ReadonlySet<number>>>;
  sessionId: string;
  wsPath?: string;
  cwd?: string;
  olderAnchorRef: MutableRefObject<HTMLElement | null>;
  onBranch?: (forkSeq: number) => void;
  onPreviewFile?: (path: string, line?: number) => void;
  /** `ui` 围栏动作按钮的落点（交互文本作为用户下一轮发出）。 */
  onSendPrompt?: (text: string) => void;
  /** widget 沙箱运行时错误回传（运行中自动告知模型）。 */
  onWidgetError?: (message: string) => boolean;
  onContinue?: () => void;
}) {
  const nodes: React.ReactNode[] = [];
  // DSH data-actions-reveal 的移植变体（用户定稿偏离官方）：官方是
  // 图标常驻、时间标签 hover；这里统一为按钮+Meta 全部 hover 才显现，
  // 作用域挂在轮容器 .turn-group 上——悬停轮内正文/工具/气泡即显现
  // 本轮的 user chrome 与 turn-tail meta。
  groups.forEach((g: TurnGroup, gi: number) => {
    // 直播轮（会话在跑 且 是最后一轮）挂 .live 作用域：工具行等
    // 流内元素挂载时播对焦动画；历史轮与已收尾的轮不播。
    const isLiveGroup = running && gi === groups.length - 1;
    // 轮内过程折叠：已闭合轮把最终回答之前的工具/中间消息收成披露条；
    // 默认收起，点击展开。正在跑的轮（无 turn-tail）不折。
    const proc = g.turn !== null ? computeTurnProcessCached(g.items) : null;
    const procOpen = proc !== null && g.turn !== null && processOpen.has(g.turn);
    const toggleProc = g.turn !== null
      ? (open: boolean) => {
          const turnNo = g.turn as number;
          setProcessOpen((prev) => {
            const next = new Set(prev);
            if (open) next.add(turnNo);
            else next.delete(turnNo);
            return next;
          });
        }
      : null;
    const barAt = proc ? (proc.processIndices[0] ?? proc.answerIndex) : -1;
    let procBarEmitted = false;
    nodes.push(
      <div key={`turn-${g.turn ?? "head"}-${gi}`} className={`turn-group${isLiveGroup ? " live" : ""}`} data-actions-reveal="hover" data-turn={g.turn ?? undefined}>
        {groupTools(g.items).map((unit) => {
          // 连续的同类工具折成一个组（查阅/终端/更改）；其余原样
          const members = unit.kind === "tool-group" ? unit.members : [unit.item];
          const indices = unit.kind === "tool-group" ? unit.indices : [unit.index];
          const key = unit.kind === "tool-group" ? unit.key : unit.item.key;
          const first = indices[0]!;
          const last = indices[indices.length - 1]!;
          // 过程折叠按"整组"判：成员全在过程窗内才算过程项（组内不会只藏一半）
          const isProcessMember = proc !== null
            && indices.every((k) => k < proc.answerIndex && proc.processIndices.includes(k));
          const hideItem = isProcessMember && !procOpen;
          // 披露条挂在过程窗起点（首个过程项；无外部过程时挂最终回答前），
          // 该起点项被收起时仍要吐出条子，否则折叠态无处点开。
          const barHere = proc !== null && toggleProc !== null
            && !procBarEmitted && first === barAt;
          if (barHere) procBarEmitted = true;
          const bar = barHere && proc && toggleProc ? (
            <TurnProcessBar
              info={proc}
              open={procOpen}
              onToggle={() => toggleProc(!procOpen)}
            />
          ) : null;
          // 披露条**自占一行**（不再拼进所在项那一行）：收起与展开两种状态下，它与下面
          // 那一行的距离就只剩 .turn-group 的行奏一份（--flow-gap）。曾把条塞进所在项的
          // 同一行里，于是展开态贴到 4px（用户报"贴的太近"）、收起态那条又叠上一份
          // 行距变成 20px（同一个关系两个值，用户报"行距不一致"）。
          const barRow = barHere && bar ? (
            <div key={`bar-${key}`} className="chat-anchor-row">{bar}</div>
          ) : null;
          if (hideItem) return barRow;
          // 锚点按首个成员的 key 查（组自身不在 keyIdx 里，直接用组 key 会丢掉落点）
          const idx = keyIdx.get(members[0]!.key) ?? -1;
          const isAnswer = proc !== null && last === proc.answerIndex;
          // 组内每一行与单行走同一条渲染（同一份 props，避免两处拷贝）
          const renderItem = (it: import("../session/renderModel").RenderItem) => (
            <Item
              item={it}
              itemV={it.v}
              running={running && it === liveItem}
              onBranch={onBranch}
              sessionId={sessionId}
              onPreviewFile={onPreviewFile}
              onSendPrompt={onSendPrompt}
              onWidgetError={onWidgetError}
              wsPath={wsPath}
              cwd={cwd}
              hideThinking={isAnswer && !procOpen && !!proc?.inlineReasoning}
              onContinue={onContinue}
            />
          );
          return (
            <Fragment key={key}>
              {barRow}
              <div
                className="chat-anchor-row"
                ref={idx === 0 ? ((el: HTMLDivElement | null) => { olderAnchorRef.current = el; }) : undefined}
              >
                {unit.kind === "tool-group" ? (
                  <ToolGroupRow groupKind={unit.groupKind} members={unit.members} cwd={cwd} running={running}>
                    {unit.members.map((m) => <div key={m.key}>{renderItem(m)}</div>)}
                  </ToolGroupRow>
                ) : renderItem(unit.item)}
              </div>
            </Fragment>
          );
        })}
      </div>,
    );
  });
  // loader 挂在流末（两处调用方的顺序都靠它：会话页它紧邻审批/提问卡之前，对话卡里它是
  // 滚动容器最后一行）——"正在干活但还没有新内容"这段窗口只有它能表达。整行即
  // DeepDiving 入口：等待的时间自己潜一段（.onClick 由 LoadingState 渲染成 button）。
  return (
    <>
      {nodes}
      {running && <LoadingState label="Deep diving..." since={runningSince} onClick={openDeepDiving} />}
    </>
  );
}
