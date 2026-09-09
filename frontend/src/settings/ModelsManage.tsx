import { useEffect, useState } from "react";
import { Check, ChevronDown, Loader2, Pencil, Plug, Plus, Trash2, X } from "lucide-react";
import { SettingsConflictError } from "./useSettingNamespace";
import { api } from "../api";
import { tt, useT } from "../i18n";
import { ProviderIcon } from "../components/ProviderIcon";
import {
  ModelDialog, keyRefOf, removePiProvider, updateDeepseekModels, updatePiProviders,
  type EditTarget,
} from "./ModelDialog";
import { useModelCatalog } from "./useModelCatalog";
import { confirmDialog } from "../components/DialogHost";
import cssRows from "./SettingsRows.module.css";

// 模型设置（折叠卡片式）：按提供方聚类的可折叠分组，模型行展示 Meta
// （模态类型 / 推理 / 上下文窗口），增删改走 ModelDialog 弹窗。
// 数据源：目录与密钥态走 useModelCatalog（与首启引导共用），本组件只用
// session/modelCatalog 把它派生成「已保存模型」分组；删除语义按落点分流：目录条目
// 删条目；引擎声明目录行清提供方密钥。

interface GroupModel {
  id: string;
  label: string;
  reasoning: boolean;
  contextWindow?: number;
  modalities?: string[];
  inDir: boolean;
}
interface ProviderGroup {
  provider: string;
  name: string;
  models: GroupModel[];
  /** 引擎声明目录（deepseek-official 等）＝内置不可组级删除。 */
  declared: boolean;
}

const MODALITY_LABEL: Record<string, string> = { text: "文本", image: "视觉", audio: "音频", video: "视频" };
/** 上下文窗口紧凑表示：1000000 → 1M，131072 → 131K */
const fmtContext = (n: number) => (n >= 1e6 ? `${Math.round((n / 1e6) * 10) / 10}M` : n >= 1e3 ? `${Math.round(n / 1e3)}K` : String(n));

export function ModelsManage() {
  const { t } = useT();
  const cat = useModelCatalog();
  const { reload } = cat;
  const [groups, setGroups] = useState<ProviderGroup[] | null>(null);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [dialog, setDialog] = useState<{ edit: EditTarget | null } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [testInfo, setTests] = useState<Record<string, { state: "testing" | "ok" | "fail"; msg: string }>>({});

  useEffect(() => { void reload(); }, [reload]);

  // 已保存模型分组 = session/modelCatalog（引擎实况）＋目录富化（contextWindow/模态）；
  // 目录态（providers/deepseek/pi）每次 reload 换新引用，随之重建。
  useEffect(() => {
    if (!cat.ready) return;
    if (cat.loadError) { setGroups([]); return; }
    void (async () => {
      const llm = await api.sessionModelCatalog().catch(() => ({ groups: [] as Array<{ id: string; name: string; models: Array<{ id: string; name?: string; reasoning?: { efforts?: unknown[] } }> }> }));
      const piVal = cat.pi.providers;
      const providerMap = new Map(cat.providers.map((p) => [p.provider, p]));
      const enrich = new Map<string, { contextWindow?: number; modalities?: string[] }>();
      for (const m of cat.deepseek.models) {
        enrich.set(`deepseek-official|${m.id}`, { contextWindow: m.contextWindow, modalities: m.inputModalities });
      }
      for (const [pid, p] of Object.entries(piVal)) {
        for (const m of p.models ?? []) enrich.set(`${pid}|${m.id}`, { contextWindow: m.contextWindow });
      }
      const built = (llm.groups ?? [])
        .filter((g) => (g.models ?? []).length > 0)
        .map((g) => {
          const p = providerMap.get(g.id);
          return {
            provider: g.id,
            name: p?.displayName || g.name || g.id,
            // declared=true = 用户手写落盘的自定义提供方（引擎目录内置的
            // deepseek-official 与 pi 预置 catalog 均无此标记），才可组级删除。
            declared: p?.declared === true,
            models: (g.models ?? []).map((m) => {
              const en = enrich.get(`${g.id}|${m.id}`) ?? {};
              return {
                id: m.id,
                label: m.name || m.id,
                reasoning: !!m.reasoning?.efforts?.length,
                contextWindow: en.contextWindow,
                modalities: en.modalities,
                inDir: g.id === "deepseek-official" || !!piVal[g.id]?.models?.some((x) => x.id === m.id),
              };
            }),
          };
        });
      setGroups(built);
    })();
  }, [cat.ready, cat.loadError, cat.providers, cat.deepseek, cat.pi]);

  /** 连通测试：pi 提供方走发现接口（列出模型 = 连通且 Key 有效）；
      DeepSeek 无发现路由，退化为密钥配置状态检查。 */
  const test = async (row: { provider: string; id: string }) => {
    const key = `${row.provider}|${row.id}`;
    setTests((s0) => ({ ...s0, [key]: { state: "testing", msg: t("测试中…") } }));
    try {
      if (row.provider === "deepseek-official") {
        const ref = keyRefOf(row.provider, cat.deepseek.apiKeyEnv);
        const cr = await api.credentialsDescribe({ refs: [ref] });
        const ok = !!cr.credentials?.[ref]?.configured;
        setTests((s0) => ({ ...s0, [key]: { state: ok ? "ok" : "fail", msg: ok ? t("密钥已配置") : t("未配置密钥") } }));
      } else {
        const r = await api.discoverModels({ settingsNs: "llm-pi-ai", provider: row.provider });
        setTests((s0) => ({ ...s0, [key]: { state: "ok", msg: tt("连通 · {n} 个模型", "Connected · {n} models", { n: r.length }) } }));
      }
    } catch (err) {
      setTests((s0) => ({ ...s0, [key]: { state: "fail", msg: String((err as Error).message).slice(0, 140) } }));
    }
    setTimeout(() => setTests((s0) => {
      const next = { ...s0 };
      delete next[key];
      return next;
    }), 6000);
  };

  const remove = async (row: { provider: string; label: string; id: string; inDir: boolean }) => {
    setNotice(null);
    try {
      if (row.inDir) {
        if (!(await confirmDialog({ message: tt("删除模型「{m}」？", "Delete model \"{m}\"?", { m: row.label }), danger: true }))) return;
        if (row.provider === "deepseek-official") {
          await updateDeepseekModels(cat.deepseek.models.filter((m) => m.id !== row.id));
        } else {
          const prof = cat.pi.providers[row.provider] ?? {};
          await updatePiProviders({
            ...cat.pi.providers,
            [row.provider]: { ...prof, models: (prof.models ?? []).filter((m) => m.id !== row.id) },
          });
        }
      } else {
        if (!(await confirmDialog({ message: tt("将清除「{p}」的 API 密钥，其全部模型将从选择器移除。", "This clears the API key of \"{p}\"; all its models will leave the picker.", { p: row.label }), danger: true }))) return;
        await api.credentialsUnset({ ref: keyRefOf(row.provider, cat.deepseek.apiKeyEnv) });
      }
      await reload();
    } catch (err) {
      setNotice(tt("保存失败：{m}", "Save failed: {m}", {
        m: err instanceof SettingsConflictError ? t("设置已在其他位置被修改。") : (err as Error).message,
      }));
    }
  };

  /** 删除整个提供方（仅用户自定义 = 非引擎声明目录的组）：unset 目录条目 +
   *  清密钥。密钥先清——失败即停在可重试状态；目录删除成功后密钥残留反而
   *  成不可见孤儿。密钥未配置时的报错吞掉（目标态就是无密钥）。 */
  const removeProvider = async (g: ProviderGroup) => {
    setNotice(null);
    if (!(await confirmDialog({
      message: tt("删除提供方「{p}」？\n其 API 密钥与全部模型将从引擎移除。", "Delete provider \"{p}\"?\nIts API key and all models will be removed from the engine.", { p: g.name }),
      danger: true,
    }))) return;
    try {
      await api.credentialsUnset({ ref: keyRefOf(g.provider, cat.deepseek.apiKeyEnv) });
    } catch { /* 密钥本就未配置：unset 报「未找到」，目标态一致，不阻塞目录删除 */ }
    try {
      await removePiProvider(g.provider);
      await reload();
    } catch (err) {
      setNotice(tt("保存失败：{m}", "Save failed: {m}", {
        m: err instanceof SettingsConflictError ? t("设置已在其他位置被修改。") : (err as Error).message,
      }));
    }
  };

  return (
    <div className={cssRows.section}>
      <div className={cssRows.mgmtCard}>
        <div className={cssRows.mgmtCardMain}>
          <div className={cssRows.mgmtCardTitle}>{t("本地配置文件")}</div>
          <div className={cssRows.mgmtCardDesc}>{t("提供方密钥与模型目录写入引擎 settings.yaml，保存即生效。")}</div>
        </div>
        <button className={cssRows.primaryButton} onClick={() => { setNotice(null); setDialog({ edit: null }); }}>
          <Plus size={13} /> {t("添加模型")}
        </button>
      </div>
      <div className={`${cssRows.sectionTitle} ${cssRows.savedTitle}`}>{t("已保存模型")}</div>
      {groups === null && <div className={cssRows.muted}>{t("载入中…")}</div>}
      {cat.loadError && <div className={cssRows.modelError}>{cat.loadError}</div>}
      {groups !== null && groups.length === 0 && !cat.loadError && (
        <div className={cssRows.muted}>{t("暂无已保存模型——点上方「添加模型」配置提供方密钥。")}</div>
      )}
      {groups !== null && groups.map((g) => {
        const isCollapsed = !!collapsed[g.provider];
        // 只有手写落盘的自定义提供方（declared）给组级删除入口；引擎内置
        // 目录（deepseek-official、pi 预置 catalog）不可删。
        return (
          <div key={g.provider} className={cssRows.modelGroup}>
            <div className={cssRows.modelGroupHeadRow}>
              <button
                type="button"
                className={cssRows.modelGroupHead}
                aria-expanded={!isCollapsed}
                onClick={() => setCollapsed((c) => ({ ...c, [g.provider]: !c[g.provider] }))}
              >
                <ProviderIcon provider={g.provider} size={17} />
                <span className={cssRows.modelGroupName}>{g.name}</span>
                <span className={cssRows.modelGroupCount}>{g.models.length}</span>
                <ChevronDown size={14} className={`${cssRows.modelGroupChevron}${isCollapsed ? ` ${cssRows.closed}` : ""}`} />
              </button>
              {g.declared && (
                <button
                  type="button"
                  className={cssRows.iconBtn}
                  data-danger="true"
                  data-tip={t("删除提供方")}
                  aria-label={t("删除提供方")}
                  onClick={() => void removeProvider(g)}
                >
                  <Trash2 size={14} />
                </button>
              )}
            </div>
            {!isCollapsed && g.models.map((m) => (
              <div key={m.id} className={cssRows.modelRow}>
                <div className={cssRows.modelRowMain}>
                  <div className={cssRows.rowName} style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                    {m.label}
                    {m.reasoning && <span className={cssRows.metaTag}>{t("推理")}</span>}
                    {(m.modalities ?? []).map((mod) => (
                      <span key={mod} className={cssRows.metaTag}>{t(MODALITY_LABEL[mod] ?? mod)}</span>
                    ))}
                    {m.contextWindow ? <span className={cssRows.metaTag}>{fmtContext(m.contextWindow)}</span> : null}
                  </div>
                </div>
                <div className={cssRows.rowActions}>
                  <button
                    className={cssRows.iconBtn}
                    data-tip={testInfo[`${g.provider}|${m.id}`]?.msg ?? t("测试连通")}
                    aria-label={t("测试连通")}
                    onClick={() => void test({ provider: g.provider, id: m.id })}
                  >
                    {(() => {
                      const st = testInfo[`${g.provider}|${m.id}`]?.state;
                      if (st === "testing") return <Loader2 size={14} className={cssRows.spin} />;
                      if (st === "ok") return <Check size={14} className={cssRows.testOk} />;
                      if (st === "fail") return <X size={14} className={cssRows.testFail} />;
                      return <Plug size={14} />;
                    })()}
                  </button>
                  <button
                    className={cssRows.iconBtn}
                    aria-label={t("编辑")}
                    onClick={() => setDialog({ edit: { provider: g.provider, kind: g.provider === "deepseek-official" ? "deepseek" : "pi", origId: m.inDir ? m.id : undefined } })}
                  >
                    <Pencil size={14} />
                  </button>
                  <button className={cssRows.iconBtn} data-danger="true" aria-label={t("删除")} onClick={() => void remove({ provider: g.provider, label: m.label, id: m.id, inDir: m.inDir })}>
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        );
      })}
      {notice && <div className={cssRows.modelError}>{notice}</div>}
      {dialog && (
        <ModelDialog
          providers={cat.providers}
          deepseek={cat.deepseek}
          pi={cat.pi}
          edit={dialog.edit}
          credentials={cat.credentials}
          onDone={() => { setDialog(null); void reload(); }}
          onCancel={() => setDialog(null)}
        />
      )}
    </div>
  );
}
