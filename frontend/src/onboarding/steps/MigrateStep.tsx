// 引导第 1 步·迁移：检测其他 Agent 的会话与**模型配置**，勾选后一次带进来。
// 会话导入走既有插件面板路由（api.importSessions / api.importRun），逐会话细选复用
// 既有的 ImportDialog；模型配置走壳读原文 + onboarding/agentModelImport 的映射计划。
// 两件事都在这一步，但**都可选**：来源与条目各带勾选框，主按钮写明将导入多少
//（用户反馈："一个孤零零的导入按钮，不知道会发生什么" → 按钮必须说清范围与数量）。
import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, ChevronDown, ChevronUp, ListChecks } from "lucide-react";
import { api, type ImportableSession } from "../../api";
import { scanAgentConfigs } from "../../host";
import { useT } from "../../i18n";
import { useStore } from "../../store";
import { useOnboardingCatalog } from "../catalog";
import { ImportDialog } from "../../settings/ImportDialog";
import { ProviderIcon } from "../../components/ProviderIcon";
import { applyModelImport, planModelImport, type ModelImportPlan } from "../agentModelImport";
import css from "../OnboardingWizard.module.css";

interface ChatGroup {
  source: string;
  sessions: ImportableSession[];
}

interface ImportSummary {
  chats: number;
  models: string[];
  failed: string[];
}

const modelKey = (item: { source: string; label: string }) => `${item.source}·${item.label}`;

/** 列表项错落入场（20ms 步进，超过 12 项不再叠加延迟）。 */
const rowStyle = (index: number) => ({ animationDelay: `${Math.min(index, 12) * 22}ms` });

export function MigrateStep({ onNext, registerPrimary }: {
  onNext: () => void;
  registerPrimary: (p: { label: string; run: () => void | Promise<void>; disabled?: boolean } | null) => void;
}) {
  const { t, tt } = useT();
  const store = useStore();
  const cat = useOnboardingCatalog();
  const [groups, setGroups] = useState<ChatGroup[] | null>(null);
  const [files, setFiles] = useState<Record<string, string> | null>(null);
  const [pickedSources, setPickedSources] = useState<Set<string>>(new Set());
  const [pickedModels, setPickedModels] = useState<Set<string>>(new Set());
  /** 展开查看/挑选模型的条目；缺省 = 该提供方的模型全选。 */
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [modelChoice, setModelChoice] = useState<Map<string, Set<string>>>(new Map());
  const [modelFilter, setModelFilter] = useState<Record<string, string>>({});
  /** 已经逐会话导入过的来源：计入汇总、从"整来源导入"里摘掉（插件幂等，但账不能重记）。 */
  const [handledSources, setHandledSources] = useState<Map<string, number>>(new Map());
  const [dialogFor, setDialogFor] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [scanning, setScanning] = useState(true);
  const [scanError, setScanError] = useState<string | null>(null);
  const [summary, setSummary] = useState<ImportSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  // 扫描：会话（插件面板路由，首次全源扫描可能跑几十秒）与配置文件原文（壳宿主消息）。
  // 失败**不静默**——此前吞成空列表，用户看到的是"没有会话"却不知道为什么。
  const scan = useCallback(async () => {
    setScanError(null);
    setScanning(true);
    try {
      const sessions = await api.importSessions({ limit: 500 }).then((r) => r.sessions);
      const configs = await scanAgentConfigs().catch(() => ({}));
      return { sessions, configs };
    } catch (err) {
      setScanError((err as Error).message.slice(0, 160));
      return null;
    } finally {
      setScanning(false);
    }
  }, []);

  /** 扫描结果落地：按来源分组、默认全选、模型配置原文交给派生计划。 */
  const applyScan = useCallback((scanned: { sessions: ImportableSession[]; configs: Record<string, string> }) => {
    const bySource = new Map<string, ImportableSession[]>();
    for (const s of scanned.sessions) {
      const list = bySource.get(s.format) ?? [];
      list.push(s);
      bySource.set(s.format, list);
    }
    const next = [...bySource.entries()].map(([source, list]) => ({ source, sessions: list }));
    setGroups(next);
    setPickedSources(new Set(next.map((g) => g.source))); // 默认全选，可逐项取消
    setFiles(scanned.configs);
  }, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      const scanned = await scan();
      if (alive && scanned) applyScan(scanned);
    })();
    return () => { alive = false; };
  }, [scan, applyScan]);

  // 计划是**纯派生**：模型目录首拉回来后自动重算（目录 hook 现在挂载即自拉，见
  // useModelCatalog——此前漏调 reload 导致目录恒空、所有项被两道表挡掉）。
  const plan: ModelImportPlan | null = useMemo(() => {
    if (files === null || !cat.ready) return null;
    return planModelImport({
      files,
      providers: cat.providers,
      deepseekApiKeyEnv: cat.deepseek.apiKeyEnv,
      existingRoutes: Object.keys(cat.pi.providers),
      protocols: cat.piProtocols,
    });
  }, [files, cat.ready, cat.providers, cat.deepseek.apiKeyEnv, cat.pi.providers, cat.piProtocols]);

  // 模型条目默认全选（目录到了才补默认值；用户改过之后不再覆盖）。
  useEffect(() => {
    if (!plan) return;
    setPickedModels((cur) => (cur.size > 0 ? cur : new Set(plan.items.map(modelKey))));
  }, [plan]);

  const selectedGroups = (groups ?? []).filter((g) => pickedSources.has(g.source) && !handledSources.has(g.source));
  const chatCount = selectedGroups.reduce((n, g) => n + g.sessions.length, 0);
  const handledCount = [...handledSources.values()].reduce((n, x) => n + x, 0);
  /** 某条目实际会被导入的模型清单（缺省 = 全选；条目级未勾选则为空）。 */
  const chosenModelsOf = (item: { source: string; label: string; models?: { id: string }[] }): string[] => {
    const key = modelKey(item);
    if (!pickedModels.has(key)) return [];
    const all = (item.models ?? []).map((m) => m.id);
    const chosen = modelChoice.get(key);
    return chosen ? all.filter((id) => chosen.has(id)) : all;
  };
  const selectedModels = (plan?.items ?? []).filter((item) => chosenModelsOf(item).length > 0 || (item.models?.length ?? 0) === 0);
  const scanDone = groups !== null && plan !== null;
  const allSources = groups ?? [];
  const allModels = plan?.items ?? [];

  const toggle = <T,>(set: Set<T>, value: T, on: boolean): Set<T> => {
    const next = new Set(set);
    if (on) next.add(value); else next.delete(value);
    return next;
  };

  const run = async () => {
    setBusy(true);
    setError(null);
    let importedChats = handledCount;
    const failed: string[] = [];
    const models: string[] = [];
    try {
      if (chatCount > 0) {
        const items = selectedGroups.flatMap((g) =>
          g.sessions.map((s) => ({ source: s.format, sourcePath: s.sourcePath, ...(s.sessionId ? { sessionId: s.sessionId } : {}) })),
        );
        const result = await api.importRun({ items });
        importedChats += result.results.reduce((n, r) => n + (r.imported ?? 0), 0);
        for (const r of result.results) if (r.error) failed.push(String(r.error).slice(0, 120));
        await store.refresh();
      }
      if (selectedModels.length > 0 && plan) {
        // 按挑选结果裁剪模型清单（条目级未勾选/一个模型都没选的不导）。
        const scoped = selectedModels.map((item) => (
          (item.models?.length ?? 0) > 0
            ? { ...item, models: (item.models ?? []).filter((m) => chosenModelsOf(item).includes(m.id)) }
            : item
        ));
        const applied = await applyModelImport({ items: scoped, notes: plan.notes });
        models.push(...applied.imported);
        failed.push(...applied.failed.map((f) => `${f.label}：${f.reason}`));
      }
      // 有失败就留在本步看结果（底栏仍可前进）；全成功直接进下一步——导入就是前进。
      if (failed.length > 0) setSummary({ chats: importedChats, models, failed });
      else onNext();
    } catch (err) {
      setError((err as Error).message.slice(0, 200));
    }
    setBusy(false);
  };

  // 底栏那个主按钮＝导入（没勾选任何东西时退化为「下一步」）：不再有第二个按钮。
  useEffect(() => {
    registerPrimary(scanning || !scanDone
      ? { label: t("正在检测…"), run: () => undefined, disabled: true }
      : summary
        ? null
        : {
          label: busy
            ? t("正在导入…")
            : chatCount === 0 && selectedModels.length === 0
              ? t("下一步")
              : tt("导入 {c} 条聊天 · {m} 项模型配置", "Import {c} chats · {m} model configs", { c: chatCount, m: selectedModels.length }),
            run: () => (chatCount === 0 && selectedModels.length === 0 ? onNext() : run()),
            disabled: busy,
          });
    return () => registerPrimary(null);
  });

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
            {summary.failed.map((reason) => <li key={reason}>{reason}</li>)}
          </ul>
        )}
      </div>
    );
  }

  return (
    <div className={css.step}>
      <div className={css.stepTitle}>{t("迁移已有数据")}</div>
      <div className={css.stepLead}>
        {t("把其他 Agent 的聊天记录和模型配置带过来，省得重新配一遍。勾选你要的部分。")}
      </div>

      {scanError && (
        <div className={css.error}>
          {tt("检测失败：{m}", "Scan failed: {m}", { m: scanError })}
          <button type="button" className={css.mini} onClick={() => void scan().then((r) => { if (r) applyScan(r); })}>
            {t("重试")}
          </button>
        </div>
      )}
      {scanning || !scanDone ? (
        // 加载态用骨架屏（形状照真实清单：分组标签 + 勾选行），首次扫描可能几十秒——
        // 一行"正在检测…"太空，看不出在等什么。
        <div className={css.skeleton}>
          <span className={css.skelGroup} />
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className={css.skelRow} style={{ animationDelay: `${i * 110}ms` }}>
              <span className={css.skelBox} />
              <span className={css.skelBar} style={{ width: `${72 - i * 9}%` }} />
            </div>
          ))}
          <div className={css.skelHint}>{t("正在检测其他 Agent 的数据，首次可能要几十秒…")}</div>
        </div>
      ) : allSources.length === 0 && allModels.length === 0 ? (
        <div className={css.empty}>{t("没有检测到可导入的数据——直接下一步配置模型即可。")}</div>
      ) : (
        <>
          {allSources.length > 0 && (
            <>
              <div className={css.groupHead}>
                <span className={css.groupLabel}>{t("聊天记录")}</span>
                <button
                  type="button"
                  className={css.mini}
                  onClick={() => setPickedSources(
                    pickedSources.size === allSources.length ? new Set() : new Set(allSources.map((g) => g.source)))}
                >
                  {pickedSources.size === allSources.length ? t("全不选") : t("全选")}
                </button>
              </div>
              <ul className={css.rows}>
                {allSources.map((g, i) => (
                  <li key={g.source} className={`${css.pickRow} ${css.rowIn}`} style={rowStyle(i)}>
                    <label className={css.pickMain}>
                      <input
                        className={css.native}
                        type="checkbox"
                        checked={pickedSources.has(g.source) && !handledSources.has(g.source)}
                        disabled={handledSources.has(g.source)}
                        onChange={(e) => setPickedSources(toggle(pickedSources, g.source, e.target.checked))}
                      />
                      <span className={css.box} aria-hidden="true"><Check size={11} /></span>
                      <span className={css.rowName}>{g.source}</span>
                      <span className={css.rowMeta}>
                        {handledSources.has(g.source)
                          ? tt("已导入 {n} 条", "{n} imported", { n: handledSources.get(g.source) ?? 0 })
                          : tt("{n} 条", "{n} chats", { n: g.sessions.length })}
                      </span>
                    </label>
                    <button type="button" className={css.mini} onClick={() => setDialogFor(g.source)}>
                      <ListChecks size={12} />{t("选择会话…")}
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}

          <div className={css.groupHead}>
            <span className={css.groupLabel}>{t("模型配置")}</span>
            {allModels.length > 1 && (
              <button
                type="button"
                className={css.mini}
                onClick={() => setPickedModels(
                  pickedModels.size === allModels.length ? new Set() : new Set(allModels.map(modelKey)))}
              >
                {pickedModels.size === allModels.length ? t("全不选") : t("全选")}
              </button>
            )}
          </div>
          {allModels.length === 0 ? (
            <div className={css.empty}>{t("没有可导入的模型配置。")}</div>
          ) : (
            <ul className={css.rows}>
              {allModels.map((item, i) => {
                const key = modelKey(item);
                return (
                  <li key={key} className={`${css.pickRow} ${css.rowIn}`} style={rowStyle(i)}>
                    <label className={css.pickMain}>
                      <input
                        className={css.native}
                        type="checkbox"
                        checked={pickedModels.has(key)}
                        onChange={(e) => setPickedModels(toggle(pickedModels, key, e.target.checked))}
                      />
                      <span className={css.box} aria-hidden="true"><Check size={11} /></span>
                      <ProviderIcon provider={item.providerId ?? item.routeId} size={15} />
                      <span className={css.rowName}>{item.label}</span>
                      <span className={css.rowMeta}>
                        {item.providerId
                          ? t("内置 · 密钥")
                          : tt("{n} 个模型", "{n} models", { n: item.models?.length ?? 0 })}
                        <span className={css.srcTag}>{item.source}</span>
                      </span>
                    </label>
                    {(item.models?.length ?? 0) > 0 && (
                      <button
                        type="button"
                        className={css.mini}
                        onClick={() => setExpanded(toggle(expanded, key, !expanded.has(key)))}
                      >
                        {expanded.has(key) ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                        {t("选模型…")}
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
          {/* 展开的模型挑选：全量列出（长列表在卡内滚）+ 筛选 + 全选 */}
          {allModels.filter((item) => expanded.has(modelKey(item))).map((item) => {
            const key = modelKey(item);
            const models = item.models ?? [];
            const chosen = modelChoice.get(key) ?? new Set(models.map((m) => m.id));
            const needle = (modelFilter[key] ?? "").trim().toLowerCase();
            const shown = needle
              ? models.filter((m) => `${m.name ?? ""} ${m.id}`.toLowerCase().includes(needle))
              : models;
            const setChosen = (next: Set<string>) => setModelChoice((cur) => new Map(cur).set(key, next));
            return (
              <div key={`pick-${key}`} className={css.subPick}>
                <div className={css.groupHead}>
                  <span className={css.groupLabel}>{item.label}</span>
                  <span className={css.rowMeta}>
                    {tt("已选 {a}/{b}", "{a}/{b} selected", { a: chosen.size, b: models.length })}
                    <button
                      type="button"
                      className={css.mini}
                      onClick={() => setChosen(chosen.size === models.length ? new Set() : new Set(models.map((m) => m.id)))}
                    >
                      {chosen.size === models.length ? t("全不选") : t("全选")}
                    </button>
                  </span>
                </div>
                {models.length > 12 && (
                  <input
                    className={css.field}
                    placeholder={t("筛选模型…")}
                    value={modelFilter[key] ?? ""}
                    onChange={(e) => setModelFilter((cur) => ({ ...cur, [key]: e.target.value }))}
                  />
                )}
                <ul className={`${css.rows} ${css.rowsTall}`}>
                  {shown.map((m) => (
                    <li key={m.id}>
                      <label className={css.pickMain}>
                        <input
                          className={css.native}
                          type="checkbox"
                          checked={chosen.has(m.id)}
                          onChange={(e) => setChosen(toggle(chosen, m.id, e.target.checked))}
                        />
                        <span className={css.box} aria-hidden="true"><Check size={11} /></span>
                        <span className={css.rowName}>{m.name ?? m.id}</span>
                        {typeof m.contextWindow === "number" && (
                          <span className={css.rowMeta}>{`${Math.round(m.contextWindow / 1000)}K`}</span>
                        )}
                      </label>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
          {(plan?.notes.length ?? 0) > 0 && (
            <ul className={css.notes}>
              {plan?.notes.map((n) => (
                <li key={`${n.source}-${n.label}`}>{tt("{s} 的 {l}：{r}", "{s} · {l}: {r}", { s: n.source, l: n.label, r: n.reason })}</li>
              ))}
            </ul>
          )}
        </>
      )}

      {error && <div className={css.error}>{error}</div>}
      {dialogFor && (
        <ImportDialog
          sourceName={dialogFor}
          format={dialogFor}
          sessions={allSources.find((g) => g.source === dialogFor)?.sessions ?? []}
          onDone={(r) => {
            setHandledSources((cur) => new Map(cur).set(dialogFor, r.imported));
            setPickedSources((cur) => toggle(cur, dialogFor, false));
            if (r.error) setError(r.error);
            void store.refresh();
            setDialogFor(null);
          }}
          onClose={() => setDialogFor(null)}
        />
      )}
    </div>
  );
}
