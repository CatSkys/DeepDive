// @ 引用与 / 命令菜单的行构造 hook：token 派生（官方 grammar / 行尾
// 判定）、候选装配与查询过滤，产出键盘导航与渲染共用的扁平行列表。
// 只管"当前该展示哪些行"；菜单渲染在 ComposerMenu，键盘导航在编排方。

import { useMemo } from "react";
import { File as FileIcon, Folder, MessageSquare, type LucideIcon } from "lucide-react";
import { useStore } from "../../store";
import { useT, type TFunc } from "../../i18n";
import { activeAtToken, formatMention, type ActiveAtToken } from "../../atGrammar";
import { useFileCandidates, useSessionCandidates, type AtEntry, type SessionCandidate } from "../../useMentionCandidates";
import { builtinCommand, builtinIcon } from "./builtinCommands";
import type { CommandDescriptor } from "../../types";

export interface MenuRow {
  id: string;
  icon: LucideIcon;
  label: string;
  /** 次要说明（命令描述/参数提示/路径），随行展示。 */
  detail?: string;
  section: string;
  run: () => void;
}

/** 旧式 parseToken 已由官方 activeAtToken grammar 取代（引号路径/空白触发）；
 *  斜杠触发保持整词行首/空白后判定，CJK 查询可过滤中文标签。
 *  带参命令 claim 后（"/goal 输入目标…"）token 不再落在行尾，菜单自然收起。 */
function parseSlashToken(text: string): { query: string; start: number } | null {
  const match = /(^|\s)\/([\w\u4e00-\u9fff-]*)$/.exec(text);
  if (match) return { query: match[2].toLowerCase(), start: match.index + match[1].length };
  return null;
}

// 命令行语义对齐官方 ui-commands 的裁决表（0.1.2 commands 面）：
// - 带 input（hint）的命令 → claim：插入 "/name " 由用户补参，Enter 整行
//   经 commands/execute 直发（编排方 submit 裁决）；
// - 无 input 的命令 → 菜单点击即直发（官方 runDetached），成败明示；派发
//   归编排方（onRunCommand）——草稿页要先把会话建出来才有 agentId 可用。
/** 把纯文本坐标的 [from, to) 换成 insert：坐标是**纯文本**坐标（附件令牌不计入），
 *  换算成文档坐标、写进编辑器由编排方给的这个函数做。菜单里的插入都是"从 token 起点
 *  一直替换到文末"（菜单只在文末那种 token 上开）。
 */
type ReplacePlain = (from: number, to: number, insert: string) => void;

function buildSlashRows(args: {
  t: TFunc["t"];
  text: string;
  slashTok: { query: string; start: number } | null;
  replace: ReplacePlain;
  commands: CommandDescriptor[];
  onRunCommand: (name: string, start: number) => void;
}): MenuRow[] {
  const { t, text, slashTok, replace, commands, onRunCommand } = args;
  return commands.map((cmd) => {
    // 说明与图标：内建命令由本表补中文与图标（引擎给的是英文原文），插件命令
    // 回落引擎原文 + 通用终端图标。
    const meta = builtinCommand(cmd.name);
    const detail = [meta?.zh ?? cmd.description, cmd.input?.hint].filter(Boolean).join(" ");
    const icon = builtinIcon(cmd.name);
    if (cmd.input) {
      return {
        id: `cmd:${cmd.name}`,
        icon,
        label: `/${cmd.name}`,
        detail,
        section: t("命令"),
        run: () => {
          if (!slashTok) return;
          replace(slashTok.start, text.length, `/${cmd.name} `);
        },
      };
    }
    return {
      id: `cmd:${cmd.name}`,
      icon,
      label: `/${cmd.name}`,
      detail,
      section: t("命令"),
      run: () => {
        if (!slashTok) return;
        onRunCommand(cmd.name, slashTok.start);
      },
    };
  });
}

function buildAtRows(args: {
  t: TFunc["t"];
  atEntries: AtEntry[];
  atTok: ActiveAtToken | undefined;
  cursor: number;
  text: string;
  replace: ReplacePlain;
}): MenuRow[] {
  const { t, atEntries, atTok, cursor, text, replace } = args;
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
      replace(cursor - atTok.prefix.length, text.length, mention);
    },
  }));
}

// 会话引用（官方 @ 源的第二支：文件 + 会话合源）。插入规范 mention，
// 宿主 pre-step 据此注入被引用会话的只读快照；quoted（目录续层）不出
// 会话候选（0.1.2 原生化：会话内走引擎 cwd 亲和排序，mention 为引擎规范形）。
function buildSessionRows(args: {
  tt: TFunc["tt"];
  candidates: SessionCandidate[];
  atTok: ActiveAtToken | undefined;
  cursor: number;
  text: string;
  replace: ReplacePlain;
  sessionDateFmt: Intl.DateTimeFormat;
}): MenuRow[] {
  const { tt, candidates, atTok, cursor, text, replace, sessionDateFmt } = args;
  return candidates.map((c) => ({
    id: `ref-session:${c.sessionId}`,
    icon: MessageSquare,
    label: c.label,
    detail: sessionDateFmt.format(c.at ?? 0),
    section: tt("会话", "Sessions"),
    run: () => {
      if (!atTok) return;
      replace(cursor - atTok.prefix.length, text.length, c.mention);
    },
  }));
}

export function useComposerMenu(args: {
  text: string;
  cursor: number;
  dismissed: boolean;
  composing: boolean;
  sessionId: string | null;
  replace: ReplacePlain;
  commands: CommandDescriptor[];
  /** 无参命令的直发（草稿页需先建会话才拿得到 agentId，故归编排方）。 */
  onRunCommand: (name: string, start: number) => void;
}): { menu: "at" | "slash" | null; query: string; rows: MenuRow[] } {
  const { text, cursor, dismissed, composing, sessionId, replace, commands, onRunCommand } = args;
  const store = useStore();
  const { t, tt, lang } = useT();
  // @ 文件候选：会话内引擎索引；草稿页用工作空间根（无空间面时无候选）。
  const wsPath = store.workspaces.find((w) => w.workspaceId === store.activeWorkspaceId)?.path;

  // token 派生：@ 用官方 grammar（光标位置），/ 保持行尾判定。
  const atTok = dismissed || composing ? undefined : activeAtToken(text, cursor);
  const slashTok = dismissed || composing ? null : parseSlashToken(text);

  const atQuery = atTok && !atTok.quoted ? atTok.query : "";
  const atEntries = useFileCandidates({ query: atQuery, sessionId, wsPath });
  const sessionCands = useSessionCandidates({ sessionId, query: atQuery, sessions: store.sessions, lang });

  const slashRows = buildSlashRows({ t, text, slashTok, replace, commands, onRunCommand });
  const atRows = buildAtRows({ t, atEntries, atTok, cursor, text, replace });
  const sessionDateFmt = useMemo(
    () => new Intl.DateTimeFormat(lang === "zh" ? "zh-CN" : "en-US", {
      month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit",
    }),
    [lang],
  );
  const sessionRows = buildSessionRows({
    tt,
    candidates: atQuery ? sessionCands : [],
    atTok, cursor, text, replace, sessionDateFmt,
  });

  const menu: "at" | "slash" | null = atTok ? "at" : slashTok ? "slash" : null;
  const query = menu === "slash" ? slashTok?.query ?? "" : "";
  const allRows = menu === "at" ? [...atRows, ...sessionRows] : slashRows;
  const rows = query ? allRows.filter((r) => r.label.toLowerCase().includes(query)) : allRows;
  return { menu, query, rows };
}
