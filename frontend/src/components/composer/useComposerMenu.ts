// @ 引用与 / 命令菜单的行构造 hook：token 派生（官方 grammar / 行尾
// 判定）、候选装配与查询过滤，产出键盘导航与渲染共用的扁平行列表。
// 只管"当前该展示哪些行"；菜单渲染在 ComposerMenu，键盘导航在编排方。

import { useMemo } from "react";
import { alertDialog } from "../DialogHost";
import {
  ClipboardList, File as FileIcon, Folder, MessageSquare, Route, ShieldCheck, Shrink, TerminalSquare,
  type LucideIcon,
} from "lucide-react";
import { api } from "../../api";
import { useStore } from "../../store";
import { useT, type TFunc } from "../../i18n";
import { activeAtToken, formatMention, type ActiveAtToken } from "../../atGrammar";
import { useFileCandidates, useSessionCandidates, type AtEntry, type SessionCandidate } from "../../useMentionCandidates";
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
// - 无 input 的命令 → 菜单点击即直发（官方 runDetached），成败明示。
/** 内建命令中文描述（引擎 description 为英文原文；插件命令不在此列）。 */
const CMD_DESC_ZH: Record<string, string> = {
  compact: "压缩更早的会话历史",
  plan: "进入或退出计划模式",
  permission: "切换权限预设（沙箱模式 + 审批策略）",
  goal: "设定或查看长任务的 Goal",
  feedback: "记录本会话的反馈",
  export: "下载本会话日志（ZIP）",
  doctor: "只读健康检查（导入注册表/会话/技能）",
  "attach-workspaces": "把已导入会话重新挂到匹配的工作区",
  "import-reset": "清空导入扫描缓存",
  "mcp-status": "查看 MCP 配置扫描结果",
  import: "从外部聊天记录导入历史会话",
  "import-all": "批导入选定来源的全部历史会话",
  "resume-claude": "从 Claude Code 历史会话生成交接摘要",
  "resume-codex": "从 Codex 历史会话生成交接摘要",
  "settings-suggest": "解析 Claude/Codex 配置给出迁移建议",
};

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
  commands: CommandDescriptor[];
}): MenuRow[] {
  const { t, tt, text, slashTok, sessionId, setText, commands } = args;
  return commands.map((cmd) => {
    const icon = CMD_ICONS[cmd.name] ?? TerminalSquare;
    // 命令描述：内建命令给中文（引擎返回英文原文，0.1.5 的中文化在官方 UI 层）；
    // 插件命令保留引擎原文。
    const zhDesc = CMD_DESC_ZH[cmd.name];
    const detail = [zhDesc ?? cmd.description, cmd.input?.hint].filter(Boolean).join(" ");
    if (cmd.input) {
      return {
        id: `cmd:${cmd.name}`,
        icon,
        label: `/${cmd.name}`,
        detail,
        section: t("命令"),
        run: () => {
          if (!slashTok) return;
          setText(text.slice(0, slashTok.start) + `/${cmd.name} `);
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
        if (!slashTok || !sessionId) return;
        void api.commandExecute({ agentId: sessionId, line: `/${cmd.name}` })
          .then((res) => {
            if (res === undefined) {
              void alertDialog({ message: tt(`未知命令：/${cmd.name}`, `Unknown command: /${cmd.name}`) });
              return;
            }
            if (res.result.kind === "error") {
              void alertDialog({ message: res.result.text });
              return;
            }
            setText(text.slice(0, slashTok.start));
          })
          .catch(() => void alertDialog({ message: tt("命令发送失败", "Failed to send command") }));
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
// 会话候选（0.1.2 原生化：会话内走引擎 cwd 亲和排序，mention 为引擎规范形）。
function buildSessionRows(args: {
  tt: TFunc["tt"];
  candidates: SessionCandidate[];
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
    detail: sessionDateFmt.format(c.at ?? 0),
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
  commands: CommandDescriptor[];
}): { menu: "at" | "slash" | null; query: string; rows: MenuRow[] } {
  const { text, cursor, dismissed, composing, sessionId, setText, commands } = args;
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

  const slashRows = buildSlashRows({ t, tt, text, slashTok, sessionId, setText, commands });
  const atRows = buildAtRows({ t, atEntries, atTok, cursor, text, setText });
  const sessionDateFmt = useMemo(
    () => new Intl.DateTimeFormat(lang === "zh" ? "zh-CN" : "en-US", {
      month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit",
    }),
    [lang],
  );
  const sessionRows = buildSessionRows({
    tt,
    candidates: atQuery ? sessionCands : [],
    atTok, cursor, text, setText, sessionDateFmt,
  });

  const menu: "at" | "slash" | null = atTok ? "at" : slashTok ? "slash" : null;
  const query = menu === "slash" ? slashTok?.query ?? "" : "";
  const allRows = menu === "at" ? [...atRows, ...sessionRows] : slashRows;
  const rows = query ? allRows.filter((r) => r.label.toLowerCase().includes(query)) : allRows;
  return { menu, query, rows };
}
