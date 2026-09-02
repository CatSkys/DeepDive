import { useEffect, useMemo, useRef, useState } from "react";
import { useT } from "../i18n";
import { Check, ChevronRight, ChevronLeft, Cpu, Search } from "lucide-react";

export interface ModelOption {
  provider: string;
  model: string;
  label: string;
  providerLabel: string;
  /** 该模型的思考强度档位（session.models 元数据）；空 = 模型不支持调档 */
  efforts?: Array<{ id: string; name: string }>;
  defaultEffort?: string;
}

/** 思考强度滑杆草稿：进入第二层时快照，Apply 才提交。 */
interface EffortDraft {
  model: ModelOption;
  levels: Array<{ id: string; name: string }>;
  showDefault: boolean;
  value: string | undefined;
}

/** 档位显示：直接用引擎返回的名称（Off/Low/High/Max…）。 */
export function effortDisplayName(id: string | undefined, levels: Array<{ id: string; name: string }>): string {
  return id === undefined ? "Default" : (levels.find((l) => l.id === id)?.name ?? id);
}

/** Change-Model sheet（参考双层结构）：
 *  第一层 = 搜索框 + 平铺模型列表（图标 + 白字模型名 + 浅色小字厂商名 + 箭头）；
 *  点模型 → 第二层该模型的思考强度页（滑杆选档 + 应用提交）。Speed 不做。 */
export function ModelMenu({
  options,
  current,
  currentModel,
  effortValue,
  onPick,
  onApplyEffort,
  onClose,
}: {
  options: ModelOption[];
  current: string;
  currentModel?: { provider: string; model: string };
  /** 当前会话生效的思考档位 id（undefined = 跟随默认档）。 */
  effortValue: string | undefined;
  /** 点选不支持调档的模型：立即切换并关闭菜单。 */
  onPick: (m: ModelOption) => void;
  /** 应用：一次调用同时提交模型与思考档位（selectModel + reasoningEffort）。 */
  onApplyEffort: (m: ModelOption, id: string | undefined) => void;
  onClose: () => void;
}) {
  const { t } = useT();
  const [draft, setDraft] = useState<EffortDraft | null>(null);
  const [query, setQuery] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [onClose]);

  const flat = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter((m) => m.label.toLowerCase().includes(q) || m.providerLabel.toLowerCase().includes(q));
  }, [options, query]);

  const onRowClick = (m: ModelOption) => {
    if (m.efforts && m.efforts.length > 0) {
      onPick(m);      // 切换模型（父级不再负责关菜单）
      // 进入该模型的思考强度页；初始档位：当前模型用会话生效档，新模型用其默认档
      const isCurrent = currentModel?.provider === m.provider && currentModel?.model === m.model;
      setDraft({
        model: m,
        levels: m.efforts,
        showDefault: true,
        value: isCurrent ? effortValue : m.defaultEffort,
      });
    } else {
      onPick(m);
      onClose();      // 无档位可调：选择即完成
    }
  };

  return (
    <div className="model-menu" ref={ref}>
      {draft === null ? (
        <div className="model-menu-view" key="root">
          <div className="model-menu-search">
            <Search size={13} />
            <input autoFocus placeholder={t("搜索模型…")} value={query} onChange={(e) => setQuery((e.target as HTMLInputElement).value)} />
          </div>
          <div className="model-menu-body">
            {flat.map((m) => {
              const active = m.label === current || (currentModel?.provider === m.provider && currentModel?.model === m.model);
              const hasEfforts = !!m.efforts && m.efforts.length > 0;
              return (
                <button key={`${m.provider}/${m.model}`} className={`model-menu-row${active ? " active" : ""}`} onClick={() => onRowClick(m)}>
                  <Cpu size={15} />
                  <span className="name">{m.label}</span>
                  <span className="provider">{m.providerLabel}</span>
                  {hasEfforts ? (
                    <ChevronRight size={14} className="chev" />
                  ) : active ? (
                    <Check size={15} />
                  ) : null}
                </button>
              );
            })}
            {flat.length === 0 && <div className="model-menu-empty">{t("无匹配模型")}</div>}
          </div>
        </div>
      ) : (
        <div className="model-menu-view" key="effort">
          <button className="model-menu-back" onClick={() => setDraft(null)}>
            <ChevronLeft size={14} /> {draft.model.label}
            <span className="effort-head-value">
              {effortDisplayName(draft.value, [{ id: "__default__", name: "Default" }, ...draft.levels])}
            </span>
          </button>
          <div className="model-menu-body">
            <EffortSlider
              levels={draft.levels}
              value={draft.value}
              onChange={(id) => setDraft((d) => (d ? { ...d, value: id } : d))}
            />
            <button
              className="effort-apply"
              onClick={() => {
                onApplyEffort(draft.model, draft.value);
                onClose();
              }}
            >
              {t("应用")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/** 思考强度滑杆：厚胶囊填充条。胶囊内左"思考强度/effort"右"当前档位"
 *  （双层 clip 文字：覆盖区反色、轨道区墨色，颜色自动做出差异）；
 *  停靠点只标在未覆盖档位上（Default 恒不显示）；拖柄仅拖动时出现；
 *  填充/裁切带滚动动画，松手时值文本按方向上下滑入。 */
function EffortSlider({
  levels,
  value,
  onChange,
}: {
  levels: Array<{ id: string; name: string }>;
  value: string | undefined;
  onChange: (id: string) => void;
}) {
  const { t } = useT();
  const ref = useRef<HTMLDivElement>(null);
  const stops = useMemo(() => [{ id: "__default__", name: "Default" }, ...levels], [levels]);
  const idx = Math.max(0, stops.findIndex((s) => s.id === value));
  const n = stops.length;
  const frac = (i: number) => (n <= 1 ? 0 : i / (n - 1));
  const [dragging, setDragging] = useState(false);
  const [valueAnim, setValueAnim] = useState<{ k: number; dir: "up" | "down" }>({ k: 0, dir: "up" });

  const idAt = (clientX: number) => {
    const r = ref.current?.getBoundingClientRect();
    if (!r || r.width === 0) return stops[idx]?.id;
    const tFrac = Math.min(1, Math.max(0, (clientX - r.left) / r.width));
    return stops[Math.min(n - 1, Math.max(0, Math.round(tFrac * (n - 1))))].id;
  };

  const onPointerDown = (e: React.PointerEvent) => {
    const startIdx = idx;
    setDragging(true);
    const onMove = (ev: PointerEvent) => onChange(idAt(ev.clientX));
    const onUp = (ev: PointerEvent) => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      setDragging(false);
      const endIdx = Math.max(0, stops.findIndex((s) => s.id === idAt(ev.clientX)));
      if (endIdx !== startIdx) setValueAnim({ k: startIdx + 1, dir: endIdx > startIdx ? "down" : "up" });
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  return (
    <div className="effort-wrap">
      <div
        className={`effort-slider${dragging ? " dragging" : ""}`}
        ref={ref}
        onPointerDown={onPointerDown}
        role="slider"
        aria-valuemin={1}
        aria-valuemax={n}
        aria-valuenow={idx + 1}
        style={{ ["--p" as string]: frac(idx) } as React.CSSProperties}
      >
        <div className="effort-track" />
        <div className="effort-fill" />
        {stops.map((s, i) =>
          // 已覆盖（填充区）与 Default 不显示停靠点；只标未覆盖的其他档位
          i > idx && s.id !== "__default__" ? (
            <div key={s.id} className="effort-tick" style={{ left: `${frac(i) * 100}%` }} />
          ) : null,
        )}
        {dragging && <div className="effort-thumb" style={{ left: `${frac(idx) * 100}%` }} />}
        {/* 双层 clip 文字：base = 轨道区墨色；clip = 填充区反色（裁剪同步填充宽度） */}
        <div className="effort-bar-text base">
          <span className="left">{t("思考强度")}</span>
          <span key={`b${valueAnim.k}`} className={`right${valueAnim.dir === "down" ? " switch down" : valueAnim.k ? " switch" : ""}`}>
            {effortDisplayName(value, stops)}
          </span>
        </div>
        <div className="effort-bar-text clip" aria-hidden="true">
          <span className="left">{t("思考强度")}</span>
          <span key={`c${valueAnim.k}`} className={`right${valueAnim.dir === "down" ? " switch down" : valueAnim.k ? " switch" : ""}`}>
            {effortDisplayName(value, stops)}
          </span>
        </div>
      </div>
    </div>
  );
}
