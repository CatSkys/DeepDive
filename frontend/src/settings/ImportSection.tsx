import { useCallback, useEffect, useRef, useState } from "react";
import { Download, RefreshCw } from "lucide-react";
import { api, type ImportableSession } from "../api";
import { useT } from "../i18n";
import { useStore } from "../store";
import { Toggle } from "../components/controls";
import { ImportDialog } from "./ImportDialog";
import cssRows from "./SettingsRows.module.css";

// 导入设置页（渐进式版式）：开启自动同步 → 从其他 AI 应用导入（来源卡）→
// 导入历史。数据来自引擎插件 dsh-chat-import 的 /api-import/* 面板路由
// （插件随包安装进 harness home web profile，桥接同等中继）。扫描按来源
// 并行、逐个渐进渲染（全量单次扫描在大会话库上太慢，用户会当成卡死）。
// 点来源卡的「导入」先弹 ImportDialog 勾选确认，绝不直接导入。

interface SourceGroup {
  format: string;
  sessions: ImportableSession[];
  imported: number;
  latest: number | null;
}

interface HistoryEntry {
  time: number;
  source: string;
  imported: number;
  already: number;
  error?: string;
}

/** 来源 → 展示名（与插件 discovery 的 format 短名对齐；缺省原样展示）。 */
const SOURCE_NAMES: Record<string, string> = {
  zcode: "ZCode",
  claude: "Claude Code",
  codex: "Codex",
  chatgpt: "ChatGPT",
  cursor: "Cursor",
  gemini: "Gemini CLI",
  reasonix: "Reasonix",
  opencode: "opencode",
  mimocode: "MiMo Code",
  grokbuild: "Grok Build",
  openclaw: "OpenClaw",
  pi: "Pi Coding Agent",
  hermes: "Hermes",
  kimi: "Kimi CLI",
  qoder: "Qoder CLI",
  workbuddy: "WorkBuddy",
  dsh: "DSH",
};

/** 面板来源全集（插件 SOURCE_FORMAT 的客户端顺序：常用在前）。 */
const KNOWN_SOURCES = [
  "zcode", "claude", "codex", "chatgpt", "cursor", "opencode", "gemini",
  "dsh", "kimi", "qoder", "workbuddy", "pi", "reasonix", "mimocode",
  "grokbuild", "openclaw", "hermes",
];

function groupOf(format: string, sessions: ImportableSession[]): SourceGroup {
  let imported = 0;
  let latest: number | null = null;
  for (const s of sessions) {
    if (s.importStatus === "imported") imported += 1;
    const t0 = s.lastActiveAt ?? s.createdAt;
    if (t0 && (latest === null || t0 > latest)) latest = t0;
  }
  return { format, sessions, imported, latest };
}

export function ImportSection() {
  const { t, tt } = useT();
  const store = useStore();
  const [groups, setGroups] = useState<SourceGroup[]>([]);
  const [scanPending, setScanPending] = useState<number | null>(null); // null = 未在扫描
  const [scanError, setScanError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<SourceGroup | null>(null);
  const [syncOn, setSyncOn] = useState<boolean | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>([]);

  // 逐来源并行扫描、逐个渐进渲染；单来源失败静默跳过（该 Agent 未安装属正常态）。
  // 世代守卫：导入完成后立即 rescan，与上一轮尚未收尾的扫描并发——迟到的
  // 来源回调若不加闸会与新一轮结果叠加，来源行整组重复（实测）。只有最新
  // 世代能写 state。
  const scanGen = useRef(0);
  const scan = useCallback(async () => {
    const gen = ++scanGen.current;
    setGroups([]);
    setScanError(null);
    setScanPending(KNOWN_SOURCES.length);
    await Promise.all(KNOWN_SOURCES.map(async (source) => {
      try {
        const r = await api.importSessions({ source });
        if (gen === scanGen.current && r.sessions.length > 0) {
          const g = groupOf(source, r.sessions);
          setGroups((prev) => [...prev, g].sort((a, b) => b.sessions.length - a.sessions.length));
        }
      } catch { /* 该来源不可用：跳过 */ }
      if (gen === scanGen.current) {
        setScanPending((p) => (p === null ? null : p - 1));
      }
    }));
    if (gen === scanGen.current) {
      setScanPending(null); // 全部来源已出结果：切回常态文案并露出「重新扫描」
    }
  }, []);

  useEffect(() => {
    if (store.engineUp) {
      void scan();
      api.importSyncStatus().then((r) => setSyncOn(r.config.watch.enabled && r.config.inbound.enabled)).catch(() => setSyncOn(null));
    }
  }, [store.engineUp, scan]);

  const toggleSync = (on: boolean) => {
    setSyncOn(on);
    api.importSyncSet(on).catch(() => setSyncOn(null));
  };

  const afterImport = async (g: SourceGroup, summary: { imported: number; already: number; error?: string }) => {
    setHistory((h) => [
      { time: Date.now(), source: SOURCE_NAMES[g.format] ?? g.format, ...summary },
      ...h,
    ].slice(0, 5));
    await store.refresh();
    await scan();
  };

  const dateFmt = (ms: number | null) =>
    ms === null
      ? ""
      : new Intl.DateTimeFormat(undefined, { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(ms);

  return (
    <div className={cssRows.section}>
      {/* 块一：自动同步 */}
      <div className={cssRows.blockCard}>
        <div className={cssRows.blockHead}>
          <div className={cssRows.blockTitle}>{t("开启自动同步")}</div>
          <div className={cssRows.blockDesc}>{t("自动同步已导入来源中的新增和更新内容")}</div>
        </div>
        <div className={cssRows.blockRow}>
          <div className={cssRows.rowIdentity}>
            <div className={cssRows.rowName}>{t("保持导入同步")}</div>
          </div>
          <div className={cssRows.rowActions}>
            <Toggle on={syncOn === true} onChange={toggleSync} />
          </div>
        </div>
      </div>

      {/* 块二：从其他 AI 应用导入 */}
      <div className={cssRows.blockCard}>
        <div className={cssRows.blockHead}>
          <div className={cssRows.blockTitle}>{t("从其他 AI 应用导入")}</div>
          <div className={cssRows.blockDesc}>
            {t("将其他 AI 应用的聊天会话导入 DeepDive，导入后可继续追问。")}
          </div>
          <div className={cssRows.blockScanRow}>
            {scanPending !== null
              ? tt("正在扫描各 Agent 的会话库…（已发现 {n} 个来源，剩 {m} 个待扫）", "Scanning agent libraries… ({n} sources found, {m} to go)", { n: groups.length, m: scanPending })
              : groups.length > 0
                ? t("检测到本机其他 Agent 的聊天记录")
                : t("暂未检测到可导入的会话——本机还没有其他 Agent 的聊天记录。")}
            {scanPending === null && (
              <button className={cssRows.secondaryButton} onClick={() => void scan()}>
                <RefreshCw size={13} />
                {t("重新扫描")}
              </button>
            )}
          </div>
          {scanError && <div className={cssRows.modelError} style={{ padding: "0 14px 8px" }}>{scanError}</div>}
          {!store.engineUp && <div className={cssRows.blockDesc}>{t("引擎未连接——导入不可用。")}</div>}
        </div>
        {groups.map((g) => {
          const n = g.sessions.length;
          const name = SOURCE_NAMES[g.format] ?? g.format;
          return (
            <div key={g.format} className={cssRows.blockRow}>
              <div className={cssRows.rowIdentity}>
                <div className={cssRows.rowName}>{name}</div>
                <div className={cssRows.rowCaption}>
                  {tt("{n} 个会话", "{n} chats", { n })}
                  {g.imported > 0 && tt("（已导入 {m} 个）", " ({m} imported)", { m: g.imported })}
                  {g.latest !== null && ` · ${tt("最近", "last")} ${dateFmt(g.latest)}`}
                </div>
              </div>
              <div className={cssRows.rowActions}>
                <button className={cssRows.primaryButton} onClick={() => setDialog(g)}>
                  <Download size={13} />
                  {t("导入")}
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* 块三：导入历史（有记录才出现） */}
      {history.length > 0 && (
        <div className={cssRows.blockCard}>
          <div className={cssRows.blockHead}>
            <div className={cssRows.blockTitle}>{t("导入历史")}</div>
          </div>
          {history.map((h) => (
            <div key={h.time} className={cssRows.blockRow}>
              <div className={cssRows.rowIdentity}>
                <div className={cssRows.rowName}>{tt("{source} 会话", "{source} chats", { source: h.source })}</div>
                <div className={cssRows.rowCaption}>
                  {h.error
                    ? tt("导入失败：{m}", "Import failed: {m}", { m: h.error })
                    : `${dateFmt(h.time)} · ${h.imported > 0
                      ? tt("已导入 {n} 个会话（已存在 {m} 个）", "imported {n} chats ({m} already imported)", { n: h.imported, m: h.already })
                      : tt("全部已导入过，无新增。", "everything was already imported — nothing new.")}`}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {dialog && (
        <ImportDialog
          sourceName={SOURCE_NAMES[dialog.format] ?? dialog.format}
          format={dialog.format}
          sessions={dialog.sessions}
          onClose={() => setDialog(null)}
          onDone={(summary) => {
            setDialog(null);
            void afterImport(dialog, summary);
          }}
        />
      )}
    </div>
  );
}
