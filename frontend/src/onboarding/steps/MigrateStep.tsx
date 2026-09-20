// 引导第 1 步·迁移：检测其他 Agent 的会话与**模型配置**，一次点击都带进来。
// 会话导入走既有插件面板路由（api.importSessions / api.importRun），模型配置走
// 壳读原文 + onboarding/agentModelImport 的映射计划——两件事都在这一步、一个按钮。
import { useEffect, useState } from "react";
import { useT } from "../../i18n";
import { api, type ImportableSession } from "../../api";
import { scanAgentConfigs } from "../../host";
import { useStore } from "../../store";
import { useModelCatalog } from "../../settings/useModelCatalog";
import { applyModelImport, planModelImport, type ModelImportPlan } from "../agentModelImport";
import css from "../OnboardingWizard.module.css";
import { ArrowRight, Loader2 } from "lucide-react";

interface ChatGroup {
  source: string;
  sessions: ImportableSession[];
}

interface ImportSummary {
  chats: number;
  models: string[];
  failed: string[];
}

export function MigrateStep({ onNext }: { onNext: () => void }) {
  const { t, tt } = useT();
  const store = useStore();
  const cat = useModelCatalog();
  const [groups, setGroups] = useState<ChatGroup[] | null>(null);
  const [plan, setPlan] = useState<ModelImportPlan | null>(null);
  const [withModels, setWithModels] = useState(true);
  const [busy, setBusy] = useState(false);
  const [summary, setSummary] = useState<ImportSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      const sessions = await api.importSessions({ limit: 500 }).then((r) => r.sessions).catch(() => []);
      const files = await scanAgentConfigs().catch(() => ({}));
      if (!alive) return;
      const bySource = new Map<string, ImportableSession[]>();
      for (const s of sessions) {
        const list = bySource.get(s.format) ?? [];
        list.push(s);
        bySource.set(s.format, list);
      }
      setGroups([...bySource.entries()].map(([source, list]) => ({ source, sessions: list })));
      setPlan(planModelImport({
        files,
        providers: cat.providers,
        deepseekApiKeyEnv: cat.deepseek.apiKeyEnv,
        existingRoutes: Object.keys(cat.pi.providers),
        protocols: cat.piProtocols,
      }));
    })();
    return () => { alive = false; };
    // 只跑一次：目录（providers/protocols）在挂载时已经就绪（这一步只在引擎连上后出现）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const chatCount = (groups ?? []).reduce((n, g) => n + g.sessions.length, 0);
  const modelItems = plan?.items ?? [];
  const hasAnything = chatCount > 0 || modelItems.length > 0;

  const run = async () => {
    setBusy(true);
    setError(null);
    let importedChats = 0;
    const failed: string[] = [];
    const models: string[] = [];
    try {
      if (chatCount > 0) {
        const items = (groups ?? []).flatMap((g) =>
          g.sessions.map((s) => ({ source: s.format, sourcePath: s.sourcePath, ...(s.sessionId ? { sessionId: s.sessionId } : {}) })),
        );
        const result = await api.importRun({ items });
        importedChats = result.results.reduce((n, r) => n + (r.imported ?? 0), 0);
        for (const r of result.results) if (r.error) failed.push(String(r.error).slice(0, 120));
        await store.refresh();
      }
      if (withModels && modelItems.length > 0 && plan) {
        const applied = await applyModelImport(plan);
        models.push(...applied.imported);
        failed.push(...applied.failed.map((f) => `${f.label}：${f.reason}`));
      }
      setSummary({ chats: importedChats, models, failed });
    } catch (err) {
      setError((err as Error).message.slice(0, 200));
    }
    setBusy(false);
  };

  if (summary) {
    return (
      <div className={css.step}>
        <div className={css.stepTitle}>{t("迁移完成")}</div>
        <div className={css.stepLead}>
          {summary.chats > 0
            ? tt("已导入 {n} 条会话，它们出现在侧栏。", "Imported {n} chats — they are in the sidebar.", { n: summary.chats })
            : t("没有导入会话。")}
        </div>
        {summary.models.length > 0 && (
          <div className={css.stepLead}>
            {tt("已导入 {n} 个提供方的模型配置：{list}", "Imported model configs for {n} providers: {list}",
              { n: summary.models.length, list: summary.models.join("、") })}
          </div>
        )}
        {summary.failed.length > 0 && (
          <ul className={css.notes}>
            {summary.failed.slice(0, 4).map((reason) => <li key={reason}>{reason}</li>)}
          </ul>
        )}
        <div className={css.actions}>
          <button type="button" className={css.primary} onClick={onNext}>
            {t("下一步")}<ArrowRight size={14} />
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={css.step}>
      <div className={css.stepTitle}>{t("迁移已有数据")}</div>
      <div className={css.stepLead}>
        {t("把其他 Agent 的聊天记录和模型配置一次性带过来，省得重新配一遍。")}
      </div>

      {groups === null || plan === null ? (
        <div className={css.scanning}><Loader2 size={14} className={css.spin} />{t("正在检测…")}</div>
      ) : !hasAnything ? (
        <div className={css.empty}>{t("没有检测到可导入的数据——跳过这一步直接配置模型即可。")}</div>
      ) : (
        <>
          <div className={css.groupLabel}>{t("聊天记录")}</div>
          {groups.length === 0 ? (
            <div className={css.empty}>{t("没有可导入的聊天记录。")}</div>
          ) : (
            <ul className={css.rows}>
              {groups.map((g) => (
                <li key={g.source} className={css.row}>
                  <span className={css.rowName}>{g.source}</span>
                  <span className={css.rowMeta}>{tt("{n} 条", "{n} chats", { n: g.sessions.length })}</span>
                </li>
              ))}
            </ul>
          )}
          <div className={css.groupLabel}>{t("模型配置")}</div>
          {modelItems.length === 0 ? (
            <div className={css.empty}>{t("没有可导入的模型配置。")}</div>
          ) : (
            <>
              <label className={css.checkRow}>
                <input type="checkbox" checked={withModels} onChange={(e) => setWithModels(e.target.checked)} />
                {tt("同时导入 {n} 个提供方（含密钥与端点）", "Also import {n} providers (keys and endpoints)", { n: modelItems.length })}
              </label>
              <ul className={css.rows}>
                {modelItems.map((item) => (
                  <li key={`${item.source}-${item.label}`} className={css.row}>
                    <span className={css.rowName}>{item.label}</span>
                    <span className={css.rowMeta}>{item.providerId ? t("内置提供方 · 导入密钥") : t("自定义端点 · 含模型清单")}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
          {(plan?.notes.length ?? 0) > 0 && (
            <ul className={css.notes}>
              {plan?.notes.slice(0, 4).map((n) => (
                <li key={`${n.source}-${n.label}`}>{tt("{s} 的 {l}：{r}", "{s} · {l}: {r}", { s: n.source, l: n.label, r: n.reason })}</li>
              ))}
            </ul>
          )}
        </>
      )}

      {error && <div className={css.error}>{error}</div>}
      <div className={css.actions}>
        <button type="button" className={css.primary} disabled={busy || !hasAnything} onClick={() => void run()}>
          {busy ? t("正在导入…") : t("导入")}
        </button>
        <button type="button" className={css.secondary} disabled={busy} onClick={onNext}>{t("跳过这一步")}</button>
      </div>
    </div>
  );
}
