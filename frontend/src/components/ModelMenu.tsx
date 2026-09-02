import { useEffect, useMemo, useRef, useState } from "react";
import { useT } from "../i18n";
import { Check, ChevronRight, ChevronLeft, Cpu, Search } from "lucide-react";

export interface ModelOption {
  provider: string;
  model: string;
  label: string;
  providerLabel: string;
}

export interface EffortSpec {
  /** 当前档位显示文本（已本地化） */
  text: string;
  levels: Array<{ id: string; name: string }>;
  showDefault: boolean;
  /** 当前选中档位；undefined = 跟随提供商默认档 */
  value: string | undefined;
  onPick: (id: string | undefined) => void;
}

/** 档位显示：直接用引擎返回的名称（Off/Low/High/Max…）。 */
export function effortDisplayName(id: string | undefined, levels: Array<{ id: string; name: string }>): string {
  return id === undefined ? "Default" : (levels.find((l) => l.id === id)?.name ?? id);
}

/** Change-Model sheet（参考：搜索置顶的平铺模型列表 + inset pill 子视图）。
 *  根视图 = 搜索框 + （推理等级设置行 +）分组模型列表，点选即生效；
 *  推理等级推入子视图，档位为 inset pill 行。 */
export function ModelMenu({
  options,
  current,
  onPick,
  onClose,
  effort,
}: {
  options: ModelOption[];
  current: string;
  onPick: (m: ModelOption) => void;
  onClose: () => void;
  effort?: EffortSpec;
}) {
  const { t } = useT();
  const [view, setView] = useState<"root" | "effort">("root");
  const [query, setQuery] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [onClose]);

  const groups = useMemo(() => {
    const map = new Map<string, ModelOption[]>();
    for (const m of options) {
      if (query && !m.label.toLowerCase().includes(query.toLowerCase())) continue;
      if (!map.has(m.providerLabel)) map.set(m.providerLabel, []);
      map.get(m.providerLabel)!.push(m);
    }
    return [...map.entries()];
  }, [options, query]);

  return (
    <div className="model-menu" ref={ref}>
      {view === "root" && (
        <div className="model-menu-view" key="root">
          <div className="model-menu-search">
            <Search size={13} />
            <input autoFocus placeholder={t("搜索模型…")} value={query} onChange={(e) => setQuery((e.target as HTMLInputElement).value)} />
          </div>
          {effort && effort.levels.length > 0 && (
            <button className="model-menu-nav" onClick={() => setView("effort")}>
              <span className="label">{t("推理等级")}</span>
              <span className="value">{effort.text}</span>
              <ChevronRight size={15} />
            </button>
          )}
          <div className="model-menu-body">
            {groups.map(([provider, rows]) => (
              <div key={provider}>
                <div className="model-menu-group">{provider}</div>
                {rows.map((m) => (
                  <button
                    key={`${m.provider}/${m.model}`}
                    className={`model-menu-row${m.label === current ? " active" : ""}`}
                    onClick={() => onPick(m)}
                  >
                    <Cpu size={15} />
                    <span className="name">{m.label}</span>
                    {m.label === current && <Check size={15} />}
                  </button>
                ))}
              </div>
            ))}
            {groups.length === 0 && <div className="model-menu-empty">{t("无匹配模型")}</div>}
          </div>
        </div>
      )}
      {view === "effort" && effort && (
        <div className="model-menu-view" key="effort">
          <button className="model-menu-back" onClick={() => setView("root")}>
            <ChevronLeft size={14} /> {t("推理等级")}
          </button>
          <div className="model-menu-body">
            <div className="model-menu-pills">
              {effort.showDefault && (
                <button
                  className={`model-menu-pill${effort.value === undefined ? " active" : ""}`}
                  onClick={() => effort.onPick(undefined)}
                >
                  <span className="name">{t("Default")}</span>
                  {effort.value === undefined && <Check size={14} />}
                </button>
              )}
              {effort.levels.map((l) => (
                <button
                  key={l.id}
                  className={`model-menu-pill${effort.value === l.id ? " active" : ""}`}
                  onClick={() => effort.onPick(l.id)}
                >
                  <span className="name">{effortDisplayName(l.id, effort.levels)}</span>
                  {effort.value === l.id && <Check size={14} />}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
