// @ 引用与 / 命令菜单的行构造 hook：token 派生（官方 grammar / 行尾
// 判定）、候选装配与查询过滤，产出键盘导航与渲染共用的扁平行列表。
// 只管"当前该展示哪些行"；菜单渲染在 ComposerMenu，键盘导航在编排方。

import { useMemo } from "react";
import {
  ClipboardList, File as FileIcon, Folder, MessageSquare, Route, ShieldCheck, Shrink, TerminalSquare,
  type LucideIcon,
} from "lucide-react";
import { api } from "../../api";
import { useStore } from "../../store";
import { useT, type TFunc } from "../../i18n";
import { activeAtToken, formatMention, type ActiveAtToken } from "../../atGrammar";
import { useAtCandidates, type AtEntry } from "../../useAtCandidates";
import { SLASH_COMMANDS } from "../../commands";
import { sessionMentionCandidates, type SessionMentionCandidate } from "../../session/sessionMention";

export interface MenuRow {
  id: string;
  icon: LucideIcon;
  label: string;
  /** 次要说明（命令描述/参数提示/路径），随行展示。 */
  detail?: string;
  /** 当前引擎不可用（命令通道未开放）：禁用态呈现，点击明示原因。 */
  disabled?: boolean;
  section: string;
  run: () => void;
}

/** 旧式 parseToken 已由官方 activeAtToken grammar 取代（引号路径/空白触发）；
 *  斜杠触发保持整词行首/空白后判定，CJK 查询可过滤中文标签。
 *  /goal 特例：行首 "/goal [目标]" 整体保持斜杠上下文——菜单在输入目标时
 *  不消失，回车即客户端派发（goal.create）。 */
function parseSlashToken(text: string): { query: string; start: number } | null {
  const match = /(^|\s)\/([\w\u4e00-\u9fff-]*)$/.exec(text);
  if (match) return { query: match[2].toLowerCase(), start: match.index + match[1].length };
  const trimmed = text.replace(/^\s+/, "");
  if (/^\/goal(\s[\s\S]*)?$/.test(trimmed)) return { query: "goal", start: text.length - trimmed.length };
  return null;
}

// 命令菜单对齐 DSH 原生五命令（docs/DSH-WIRE.md §4，引擎无 commands.list，
// 目录静态内置）。rc.2 浏览器面只有 /goal 可客户端派发（goal.create RPC）；
// 其余命令执行走宿主 commands/execute 通道，rc.2 不可达（DSH-WIRE §6 三门
// 实证）——行以禁用态呈现、点击明示原因，通道开放后在各自的 run 换真派发。
const CMD_ICONS: Record<string, LucideIcon> = {
  compact: Shrink,
  plan: Route,
  permission: ShieldCheck,
  feedback: ClipboardList,
};

type SetText = React.Dispatch<React.SetStateAction<string>>;

function buildSlashRows(args: {
  t: TFunc["t"];
  tt: TFunc["tt"];
  text: string;
  slashTok: { query: string; start: number } | null;
  sessionId: string | null;
  setText: SetText;
}): MenuRow[] {
  const { t, tt, text, slashTok, sessionId, setText } = args;
  return SLASH_COMMANDS.map((cmd) => {
    if (cmd.name === "goal") {
      return {
        id: "cmd:goal",
        icon: TerminalSquare,
        label: "/goal",
        detail: `${tt("设定/查看长任务的 Goal", "Set or view the goal for a long-running task")} ${tt("（输入目标后回车）", "(enter an objective then Enter)")}`,
        section: t("命令"),
        run: () => {
          if (!slashTok) return;
          const typed = text.slice(slashTok.start).trim();
          const objective = typed.replace(/^\/goal\b/i, "").trim();
          if (sessionId && objective) {
            void api.goalCreate({ sessionId, objective }).catch(() => void 0); // goal 派发失败：吞掉不弹错，Goal 条未更新即是反馈
            setText("");
          } else {
            setText(text.slice(0, slashTok.start) + "/goal ");
          }
        },
      };
    }
    return {
      id: `cmd:${cmd.name}`,
      icon: CMD_ICONS[cmd.name] ?? TerminalSquare,
      label: `/${cmd.name}`,
      detail: [tt(cmd.zh, cmd.en), cmd.hint].filter(Boolean).join(" "),
      section: t("命令"),
      disabled: true,
      run: () =>
        alert(tt(
          `当前引擎版本不支持 /${cmd.name}，引擎升级开放命令通道后可用`,
          `/${cmd.name} is not available on this engine build yet`,
        )),
    };
  });
}

function buildAtRows(args: {
  t: TFunc["t"];
  atEntries: AtEntry[];
  atTok: ActiveAtToken | undefined;
  cursor: number;
  text: string;
  setText: SetText;
}): MenuRow[] {
  const { t, atEntries, atTok, cursor, text, setText } = args;
  return atEntries.map((e) => ({
    id: e.path,
    icon: e.isDir ? Folder : FileIcon,
    label: e.name,
    detail: e.path,
    section: t("引用"),
    run: () => {
      if (!atTok) return;
      const mention = formatMention({ path: e.path, kind: e.isDir ? "directory" : "file" }, atTok.quoted);
      if (mention === undefined) return;
      setText(text.slice(0, cursor - atTok.prefix.length) + mention);
    },
  }));
}

// 会话引用（官方 @ 源的第二支：文件 + 会话合源）。插入规范 mention，
// 宿主 pre-step 据此注入被引用会话的只读快照；quoted（目录续层）不出
// 会话候选——与官方一致。
function buildSessionRows(args: {
  tt: TFunc["tt"];
  candidates: SessionMentionCandidate[];
  atTok: ActiveAtToken | undefined;
  cursor: number;
  text: string;
  setText: SetText;
  sessionDateFmt: Intl.DateTimeFormat;
}): MenuRow[] {
  const { tt, candidates, atTok, cursor, text, setText, sessionDateFmt } = args;
  return candidates.map((c) => ({
    id: `ref-session:${c.sessionId}`,
    icon: MessageSquare,
    label: c.label,
    detail: sessionDateFmt.format(c.updatedAt ?? 0),
    section: tt("会话", "Sessions"),
    run: () => {
      if (!atTok) return;
      setText(text.slice(0, cursor - atTok.prefix.length) + c.mention);
    },
  }));
}

export function useComposerMenu(args: {
  text: string;
  cursor: number;
  dismissed: boolean;
  composing: boolean;
  sessionId: string | null;
  setText: SetText;
}): { menu: "at" | "slash" | null; query: string; rows: MenuRow[] } {
  const { text, cursor, dismissed, composing, sessionId, setText } = args;
  const store = useStore();
  const { t, tt, lang } = useT();
  // @ 引用候选：工作空间根目录（无空间面时退化为不提供候选）
  const wsPath = store.workspaces.find((w) => w.workspaceId === store.activeWorkspaceId)?.path;

  // token 派生：@ 用官方 grammar（光标位置），/ 保持行尾判定。
  const atTok = dismissed || composing ? undefined : activeAtToken(text, cursor);
  const slashTok = dismissed || composing ? null : parseSlashToken(text);

  const atEntries = useAtCandidates(atTok && !atTok.quoted ? atTok.query : "", wsPath);

  const slashRows = buildSlashRows({ t, tt, text, slashTok, sessionId, setText });
  const atRows = buildAtRows({ t, atEntries, atTok, cursor, text, setText });
  const sessionDateFmt = useMemo(
    () => new Intl.DateTimeFormat(lang === "zh" ? "zh-CN" : "en-US", {
      month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit",
    }),
    [lang],
  );
  const sessionRows = buildSessionRows({
    tt,
    candidates: atTok && !atTok.quoted
      ? sessionMentionCandidates(store.sessions, sessionId, atTok.query, lang)
      : [],
    atTok, cursor, text, setText, sessionDateFmt,
  });

  const menu: "at" | "slash" | null = atTok ? "at" : slashTok ? "slash" : null;
  const query = menu === "slash" ? slashTok?.query ?? "" : "";
  const allRows = menu === "at" ? [...atRows, ...sessionRows] : slashRows;
  const rows = query ? allRows.filter((r) => r.label.toLowerCase().includes(query)) : allRows;
  return { menu, query, rows };
}
