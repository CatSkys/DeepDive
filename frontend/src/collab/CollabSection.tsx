// 会话协作（设置页分区）：三条路，今天都落在这里。
//
// · 会话联系人：把一条消息投进**别的会话**——走引擎 `session/prompt {requestId, sessionId,
//   mode, content}`。消息在目标会话里以**普通用户消息**落地并跑一轮：引擎没有"会话间消息源"
//   这一层（`MessageSourceMap` 只有 user/plugin/model/tool），所以这里不假装是 agent 身份
//   对话，卡片里如实写明落地形态。
// · 外部 agent 联系人：壳跑一次本机已装的 CLI（`claude -p "…"` 这类一次性调用），拿回输出。
//   不内置其运行时、不注册成引擎 provider（用户口径）。联系人存本机 localStorage。
// · 外部会话历史：随包插件 dsh-chat-import 已经在扫 `~/.claude/projects/**/*.jsonl` 等 17+
//   来源，归「导入」分区——同一份扫描面，不在这里重造第二份。

import { useMemo, useState } from "react";
import { Bot, FolderInput, MessageSquarePlus, Send, Trash2 } from "lucide-react";
import { api } from "../api";
import { Dropdown } from "../components/controls";
import { confirmDialog } from "../components/DialogHost";
import { runAgent } from "../host";
import { useT } from "../i18n";
import { sessionTitle } from "../session/sessionTitle";
import { useStore } from "../store";
import { uuid } from "../uuid";
import css from "../settings/SettingsRows.module.css";
import { AGENTS_KEY, agentArgv, parseAgentContacts, type AgentContact } from "./model";

function loadContacts(): AgentContact[] {
  try {
    return parseAgentContacts(localStorage.getItem(AGENTS_KEY));
  } catch {
    return []; // 存储不可用（受限环境）按没有联系人
  }
}

export function CollabSection() {
  const { t, tt, lang } = useT();
  const store = useStore();
  const [contacts, setContacts] = useState<AgentContact[]>(loadContacts);
  const [name, setName] = useState("");
  const [command, setCommand] = useState("");
  const [argsText, setArgsText] = useState("-p");
  const [targetId, setTargetId] = useState("");
  const [message, setMessage] = useState("");
  const [agentBusy, setAgentBusy] = useState(false);
  const [agentOut, setAgentOut] = useState<{ ok: boolean; text: string } | null>(null);
  const [sessionId, setSessionId] = useState("");
  const [sessionMessage, setSessionMessage] = useState("");
  const [sent, setSent] = useState<{ ok: boolean; text: string } | null>(null);

  const sessionOptions = useMemo(() => {
    return store.sessions
      .filter((s) => s.origin !== "subagent")
      .slice()
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .map((s) => ({
        v: s.sessionId,
        label: sessionTitle(s, lang),
        description: s.cwd ?? undefined,
      }));
  }, [store.sessions, lang]);

  /** 生效的投递目标：用户选过就用选的，否则就是列表第一项——必须与 Dropdown 显示的
   *  是同一个值：显示 A 却按 state 判空，会让"点了投递没反应"变成一个查不出来的静默失败。 */
  const sessionTarget = sessionId || (sessionOptions[0]?.v ?? "");

  const save = (next: AgentContact[]) => {
    setContacts(next);
    try {
      localStorage.setItem(AGENTS_KEY, JSON.stringify(next));
    } catch {
      /* 存储不可用：列表本次会话内仍然可用，不假装持久化成功 */
    }
  };

  const addContact = () => {
    const trimmedName = name.trim();
    const trimmedCommand = command.trim();
    if (!trimmedName || !trimmedCommand) return;
    save([
      ...contacts,
      {
        id: uuid(),
        name: trimmedName,
        command: trimmedCommand,
        args: argsText.split(/\s+/).filter((a) => a !== ""),
      },
    ]);
    setName("");
    setCommand("");
  };

  const removeContact = async (contact: AgentContact) => {
    const ok = await confirmDialog({
      message: tt("移除外部 agent 联系人「{name}」？", "Remove the external agent “{name}”?", { name: contact.name }),
      confirmLabel: t("移除"),
      cancelLabel: t("取消"),
    });
    if (ok) save(contacts.filter((c) => c.id !== contact.id));
  };

  const run = async (contactId: string) => {
    const contact = contacts.find((c) => c.id === contactId);
    if (!contact) return;
    const argv = agentArgv(contact, message);
    if (argv === null) return;
    setAgentBusy(true);
    setAgentOut(null);
    const result = await runAgent(contact.command, argv, 120);
    setAgentBusy(false);
    setAgentOut({
      ok: result.ok,
      text: result.ok ? result.output : `${result.error ?? t("执行失败")}\n${result.output}`,
    });
  };

  /** 会话间投递：消息在目标会话里是普通用户消息，并在那里跑一轮。 */
  const sendToSession = async () => {
    const text = sessionMessage.trim();
    if (!sessionTarget || !text) return;
    setSent(null);
    try {
      await api.prompt({
        requestId: uuid(),
        sessionId: sessionTarget,
        mode: "queue",
        content: [{ type: "text", text }],
      });
      setSent({ ok: true, text: t("已投递，去那个会话看进展。") });
      setSessionMessage("");
    } catch (err) {
      setSent({ ok: false, text: String((err as Error)?.message ?? err) });
    }
  };

  return (
    <div className={css.section}>
      <div className={css.sectionTitle}>{t("会话协作")}</div>
      <div className={css.sectionIntro}>
        {t("把消息投给别的会话，或把本机已装的命令行 agent 当联系人一次性调用。三条路的边界都写在各卡片里——引擎没有会话间消息通道，这里做的是客户端投递。")}
      </div>

      <div className={css.blockCard}>
        <div className={css.blockHead}>
          <div className={css.blockTitle}>{t("会话联系人")}</div>
          <div className={css.blockDesc}>
            {t("选一个会话，把消息投进去：它以普通用户消息落在那个会话里并触发一轮回复（引擎没有会话间消息源，所以不是 agent 身份对话）。消息排队投递，不影响你当前这个会话。")}
          </div>
        </div>
        <div className={css.blockRow}>
          <MessageSquarePlus size={13} />
          <Dropdown
            options={sessionOptions}
            value={sessionTarget}
            onChange={setSessionId}
          />
        </div>
        <div className={css.blockRow}>
          <textarea
            className={css.textField}
            style={{ minHeight: 64, height: "auto", padding: "8px 10px", flex: 1 }}
            placeholder={t("要投递的消息…")}
            value={sessionMessage}
            onChange={(e) => setSessionMessage(e.target.value)}
          />
          <button
            className={css.primaryButton}
            disabled={!sessionMessage.trim() || sessionOptions.length === 0}
            onClick={() => void sendToSession()}
          >
            <Send size={12} /> {t("投递")}
          </button>
        </div>
        {sent && (
          <div className={css.blockRow}>
            <span className={css.muted} style={sent.ok ? undefined : { color: "#e5484d" }}>{sent.text}</span>
          </div>
        )}
      </div>

      <div className={css.blockCard}>
        <div className={css.blockHead}>
          <div className={css.blockTitle}>{t("外部 agent 联系人")}</div>
          <div className={css.blockDesc}>
            {t("填一个本机已装的命令行 agent（绝对路径，或经 PATH 解析的裸命令名，如 claude），消息会作为最后一个参数传进去，跑完把输出贴回来。应用不内置它的运行时，也不把它注册成引擎 provider。")}
          </div>
        </div>

        {contacts.length === 0 && (
          <div className={css.blockRow}>
            <span className={css.muted}>{t("还没有联系人。")}</span>
          </div>
        )}
        {contacts.map((contact) => (
          <div key={contact.id} className={css.blockRow}>
            <Bot size={13} />
            <div style={{ minWidth: 0, flex: 1 }}>
              <div className={css.rowName}>{contact.name}</div>
              <div className={css.mono}>{[contact.command, ...contact.args].join(" ")}</div>
            </div>
            <div className={css.rowActions}>
              <button className={css.secondaryButton} disabled={agentBusy} onClick={() => void run(contact.id)}>
                <Send size={12} /> {t("运行")}
              </button>
              <button className={css.dangerButton} onClick={() => void removeContact(contact)}>
                <Trash2 size={12} /> {t("移除")}
              </button>
            </div>
          </div>
        ))}

        <div className={css.blockRow}>
          <input className={css.textField} style={{ width: 150 }} placeholder={t("名称")} value={name} onChange={(e) => setName(e.target.value)} />
          <input className={css.textField} style={{ flex: 1 }} placeholder={t("命令或绝对路径")} value={command} onChange={(e) => setCommand(e.target.value)} />
          <input className={css.textField} style={{ width: 120 }} placeholder={t("固定参数")} value={argsText} onChange={(e) => setArgsText(e.target.value)} />
          <button className={css.secondaryButton} disabled={!name.trim() || !command.trim()} onClick={addContact}>
            {t("添加")}
          </button>
        </div>

        <div className={css.blockRow}>
          <textarea
            className={css.textField}
            style={{ minHeight: 64, height: "auto", padding: "8px 10px", flex: 1 }}
            placeholder={t("给联系人说的话…")}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
          />
        </div>
        {contacts.length > 1 && (
          <div className={css.blockRow}>
            <span className={css.muted}>{t("运行哪一个：")}</span>
            <Dropdown
              options={contacts.map((c) => ({ v: c.id, label: c.name, description: c.command }))}
              value={targetId || contacts[0]!.id}
              onChange={setTargetId}
            />
          </div>
        )}
        {agentOut && (
          <div className={css.blockRow}>
            <pre className={css.mono} style={{ margin: 0, whiteSpace: "pre-wrap", wordBreak: "break-word", flex: 1 }}>
              {agentOut.text || t("（没有输出）")}
            </pre>
          </div>
        )}
      </div>

      <div className={css.blockCard}>
        <div className={css.blockHead}>
          <div className={css.blockTitle}>{t("外部会话历史")}</div>
          <div className={css.blockDesc}>
            {t("读别的 AI 应用的会话历史（Claude Code 的 ~/.claude/projects 等 17+ 来源）走「导入」分区——那份扫描面随包的 dsh-chat-import 插件已经提供，这里不另造一份。")}
          </div>
        </div>
        <div className={css.blockRow}>
          <FolderInput size={13} />
          <span className={css.muted}>{t("到「导入」分区查看与导入。")}</span>
        </div>
      </div>
    </div>
  );
}
