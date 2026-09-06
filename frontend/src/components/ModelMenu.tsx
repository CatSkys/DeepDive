import { useEffect, useMemo, useRef, useState } from "react";
import { useT } from "../i18n";
import { Check, ChevronRight, ChevronLeft, Search } from "lucide-react";
import { ProviderIcon } from "./ProviderIcon";
import { HoverScrollText } from "./HoverScrollText";
import { PixelGrid } from "./LoadingState";

export interface ModelOption {
  provider: string;
  model: string;
  label: string;
  providerLabel: string;
  /** 该模型的思考强度档位（session.models 元数据）；空 = 模型不支持调档 */
  efforts?: Array<{ id: string; name: string }>;
  defaultEffort?: string;
}

/** 思考强度滑杆草稿：进入第二层时快照，滑杆松手即提交。 */
interface EffortDraft {
  model: ModelOption;
  levels: Array<{ id: string; name: string }>;
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
      // 没有"默认档"这个档位：初始值取会话生效档（当前模型）或该模型默认档，
      // 都为空则取第一档 —— 滑杆上只有真实档位，应用必提交具体 id。
      const initial = (isCurrent ? effortValue : undefined) ?? m.defaultEffort ?? m.efforts[0]?.id;
      setDraft({ model: m, levels: m.efforts, value: initial });
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
                  <ProviderIcon provider={m.provider} size={15} />
                  <HoverScrollText className="name">{m.label}</HoverScrollText>
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
            <ChevronLeft size={14} />
            <ProviderIcon provider={draft.model.provider} size={15} />
            {draft.model.label}
            <span className="effort-head-value">
              {effortDisplayName(draft.value, draft.levels)}
            </span>
          </button>
          <div className="model-menu-body">
            <EffortSlider
              levels={draft.levels}
              value={draft.value}
              onChange={(id) => setDraft((d) => (d ? { ...d, value: id } : d))}
              onCommit={(id) => onApplyEffort(draft.model, id)}
            />
          </div>
        </div>
      )}
    </div>
  );
}

/** 思考强度滑杆：厚胶囊填充条 —— 无文字（档位名在头部模型名右侧）、
 *  无拖柄；停靠点只标未覆盖档位且内缩不顶两端。 */
function EffortSlider({
  levels,
  value,
  onChange,
  onCommit,
}: {
  levels: Array<{ id: string; name: string }>;
  value: string | undefined;
  onChange: (id: string) => void;
  /** 松手即应用：选择就是提交（本页不再有"应用"按钮）。 */
  onCommit: (id: string) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const stops = levels;
  const idx = Math.max(0, stops.findIndex((s) => s.id === value));
  const n = stops.length;
  const frac = (i: number) => (n <= 1 ? 0 : i / (n - 1));
  // 自适应：任意档位数。单档位视为满格；停靠点只在 3-6 档时显示
  // （档位再多点会拥挤，纯填充条更干净）。
  const fillFrac = n <= 1 ? 1 : frac(idx);
  const showDots = n >= 3 && n <= 6;
  const [dragging, setDragging] = useState(false);
  // 能量涌动：思考动画同款像素波前（LoadingState Drive 网格复用），随档位
  // 加速但整体比思考动画（650ms）慢一档——低档 1.6s、满档 1.0s。
  const energy = n <= 1 ? 0 : idx / (n - 1);
  const dur = Math.round(1600 - 600 * energy);

  const idAt = (clientX: number) => {
    const r = ref.current?.getBoundingClientRect();
    if (!r || r.width === 0) return stops[idx]?.id;
    const tFrac = Math.min(1, Math.max(0, (clientX - r.left) / r.width));
    return stops[Math.min(n - 1, Math.max(0, Math.round(tFrac * (n - 1))))].id;
  };

  const onPointerDown = (e: React.PointerEvent) => {
    setDragging(true);
    let currentId = idAt(e.clientX);
    onChange(currentId);
    const onMove = (ev: PointerEvent) => {
      currentId = idAt(ev.clientX);
      onChange(currentId);
    };
    const finish = (commitId: string) => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
      setDragging(false);
      if (commitId !== value) onCommit(commitId);   // 松手即应用
    };
    const onUp = (ev: PointerEvent) => finish(idAt(ev.clientX));
    // pointercancel 坐标不可靠：视为在最后位置松手，提交当前值（同 up 语义）
    const onCancel = () => finish(currentId);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
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
        <div className="effort-fill" style={{ width: `${fillFrac * 100}%` }}>
          {energy > 0.01 && <PixelGrid dur={dur} />}
        </div>
        {showDots &&
          stops.map((s, i) =>
            i > idx && i < n - 1 ? (
              <div key={s.id} className="effort-tick" style={{ left: `${frac(i) * 100}%` }} />
            ) : null,
          )}
      </div>
    </div>
  );
}
