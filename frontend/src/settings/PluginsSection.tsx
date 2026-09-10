// 插件节（§7 市场面 v1）：已装清单（壳 PluginStore）+ GitHub topic 搜索安装。
// 安装/移除都是壳侧异步操作（不执行插件脚本）；完成时壳推 "plugins" 清单，
// 本节经 onHostEvent 刷新。装/卸后需重启引擎生效（restart-engine 桥已有）。

import { useEffect, useState } from "react";
import { Download, RefreshCw, Trash2 } from "lucide-react";
import { onHostEvent, pluginInstall, pluginRemove, pluginsList, sendToShell, type InstalledPlugin } from "../host";
import { tt, useT } from "../i18n";
import cssRows from "./SettingsRows.module.css";

interface GhRepo {
  full_name: string;
  description: string | null;
  stargazers_count: number;
  pushed_at: string;
}

export function PluginsSection() {
  const { t } = useT();
  const [installed, setInstalled] = useState<InstalledPlugin[] | null>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<GhRepo[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [installing, setInstalling] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [needsRestart, setNeedsRestart] = useState(false);

  useEffect(() => {
    let alive = true;
    void pluginsList().then((list) => { if (alive) setInstalled(list); }).catch(() => void 0);
    const off = onHostEvent((cmd, payload) => {
      if (cmd !== "plugins") return;
      if (alive) setInstalled((payload as { plugins?: InstalledPlugin[] } | undefined)?.plugins ?? []);
      setInstalling(null);
      setNeedsRestart(true);
    });
    return () => { alive = false; off(); };
  }, []);

  const search = async () => {
    setSearching(true);
    setError(null);
    try {
      const q = query.trim() ? `topic:dsh-plugin ${query.trim()}` : "topic:dsh-plugin";
      const r = await fetch(`https://api.github.com/search/repositories?q=${encodeURIComponent(q)}&sort=stars&per_page=10`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const body = (await r.json()) as { items?: GhRepo[] };
      setResults(body.items ?? []);
    } catch (err) {
      setError(tt("搜索失败：{m}", "Search failed: {m}", { m: (err as Error).message }));
    }
    setSearching(false);
  };

  const install = (repo: string) => {
    setInstalling(repo);
    setError(null);
    pluginInstall(repo);
  };

  const remove = (id: string) => {
    pluginRemove(id);
    setNeedsRestart(true);
  };

  const restartEngine = () => {
    sendToShell({ type: "restart-engine" });
    setNeedsRestart(false);
  };

  return (
    <div className={cssRows.section}>
      <div className={cssRows.sectionTitle}>{t("插件")}</div>
      <div className={cssRows.sectionIntro}>
        {t("引擎侧插件清单。安装会下载仓库到引擎数据目录并挂入启动补丁（不执行任何安装脚本）；装/卸后重启引擎生效。")}
      </div>

      {needsRestart && (
        <div className={cssRows.sectionIntro} role="status">
          {t("清单已变更，需重启引擎生效。")}
          <button type="button" className={cssRows.textBtn} onClick={restartEngine}>{t("立即重启引擎")}</button>
        </div>
      )}

      {installed !== null && installed.length > 0 && (
        <div className={cssRows.fieldGroup}>
          <div className={cssRows.fieldLabel}>{t("已安装")}</div>
          {installed.map((p) => (
            <div key={p.id} className={cssRows.fieldRow}>
              <span className={cssRows.fieldLabel} title={`${p.repo} · ${p.packageName}`}>{p.packageName}</span>
              <button
                type="button"
                className={cssRows.textBtn}
                aria-label={t("卸载插件")}
                onClick={() => remove(p.id)}
              >
                <Trash2 size={13} /> {t("卸载")}
              </button>
            </div>
          ))}
        </div>
      )}

      <div className={cssRows.fieldGroup}>
        <div className={cssRows.fieldLabel}>{t("从 GitHub 安装（topic: dsh-plugin）")}</div>
        <div className={cssRows.fieldRow}>
          <input
            className={cssRows.textField}
            placeholder={t("搜索关键词（可留空看全部）")}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") void search(); }}
          />
          <button type="button" className={cssRows.textBtn} disabled={searching} onClick={() => void search()}>
            <RefreshCw size={13} /> {searching ? t("搜索中…") : t("搜索")}
          </button>
        </div>
        {error && <div role="alert">{error}</div>}
        {results !== null && results.length === 0 && <div>{t("没有匹配的插件仓库。")}</div>}
        {results?.map((r) => (
          <div key={r.full_name} className={cssRows.fieldRow}>
            <span className={cssRows.fieldLabel} title={r.description ?? r.full_name}>
              {r.full_name} · ★{r.stargazers_count}
            </span>
            <button
              type="button"
              className={cssRows.textBtn}
              disabled={installing !== null}
              aria-label={t("安装插件")}
              onClick={() => install(r.full_name)}
            >
              <Download size={13} /> {installing === r.full_name ? t("安装中…") : t("安装")}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
