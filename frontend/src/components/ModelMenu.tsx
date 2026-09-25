// 模型选择弹层（参考双层结构）：
//  第一层 = 搜索框 + 平铺模型列表（图标 + 白字模型名 + 浅色小字厂商名 + 箭头）；
//  点模型 → 第二层该模型的思考强度页（单选列表，选中档带对勾，点选即提交并关菜单）。
//  Speed 不做。
//
// 弹层挂 body（portal + fixed）：会话头的触发器与会话设置面板的滚动容器都会裁掉
// 行内/绝对定位的菜单——面板里当年内联展开还会把下方分区顶下去。
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { RefObject } from "react";
import { useT } from "../i18n";
import { Check, ChevronRight, ChevronLeft, Search } from "lucide-react";
import { ProviderIcon } from "./ProviderIcon";
import { HoverScrollText } from "./HoverScrollText";

export interface ModelOption {
  provider: string;
  model: string;
  label: string;
  providerLabel: string;
  /** 该模型的思考强度档位（modelCatalog reasoning 元数据）；空 = 模型不支持调档 */
  efforts?: Array<{ id: string; name: string }>;
  defaultEffort?: string;
}

/** 思考强度档位草稿：进入第二层时快照，点选即提交。 */
interface EffortDraft {
  model: ModelOption;
  levels: Array<{ id: string; name: string }>;
  value: string | undefined;
}

/** 档位显示：直接用引擎返回的名称（Off/Low/High/Max…）。 */
export function effortDisplayName(id: string | undefined, levels: Array<{ id: string; name: string }>): string {
  return id === undefined ? "Default" : (levels.find((l) => l.id === id)?.name ?? id);
}

/** 与 .model-menu 的 width/max-height 同步（定位要按它们算翻转与限高）。 */
const MENU_WIDTH = 280;
const MENU_MAX_HEIGHT = 460;

/** 触发器下方的弹层位置：下方放不下且上方更宽裕就翻上去，两侧留 8px 边距。 */
function popupRect(anchor: HTMLElement): { top: number; left: number; maxHeight: number } {
  const r = anchor.getBoundingClientRect();
  const below = window.innerHeight - r.bottom - 8;
  const above = r.top - 8;
  const flip = below < 260 && above > below;
  const maxHeight = Math.min(MENU_MAX_HEIGHT, Math.max(200, (flip ? above : below) - 4));
  return {
    top: flip ? Math.max(8, r.top - maxHeight - 4) : r.bottom + 4,
    left: Math.max(8, Math.min(r.left, window.innerWidth - MENU_WIDTH - 12)),
    maxHeight,
  };
}

export function ModelMenu({
  options,
  current,
  currentModel,
  effortValue,
  onPick,
  onApplyEffort,
  onClose,
  anchorRef,
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
  /** 触发器元素（弹层按它的 rect 定位，点它不算点菜单外部）。 */
  anchorRef: RefObject<HTMLElement | null>;
}) {
  const { t } = useT();
  const [draft, setDraft] = useState<EffortDraft | null>(null);
  const [query, setQuery] = useState("");
  const [rect, setRect] = useState<{ top: number; left: number; maxHeight: number } | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  // 量触发器必须在绘制前完成，否则首帧会闪在左上角（useLayoutEffect）
  useLayoutEffect(() => {
    const el = anchorRef.current;
    if (el) setRect(popupRect(el));
  }, [anchorRef]);

  useEffect(() => {
    const close = (e: MouseEvent) => {
      const target = e.target as Node;
      // 触发器也算"内部"：点它由父级的开合逻辑接管，否则 mousedown 先关、click 再开
      if (!ref.current?.contains(target) && !anchorRef.current?.contains(target)) onClose();
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [onClose, anchorRef]);

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
      // 都为空则取第一档 —— 列表里只有真实档位，点选必提交具体 id。
      const initial = (isCurrent ? effortValue : undefined) ?? m.defaultEffort ?? m.efforts[0]?.id;
      setDraft({ model: m, levels: m.efforts, value: initial });
    } else {
      onPick(m);
      onClose();      // 无档位可调：选择即完成
    }
  };

  if (rect === null) return null;

  return createPortal(
    <div className="model-menu" ref={ref} style={{ top: rect.top, left: rect.left, maxHeight: rect.maxHeight }}>
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
            {/* 档位单选列表：用与第一层同一套行样式（选中行填充 + 行尾对勾），
                点选即提交并关菜单——不做拖拽，少一层手势状态就少一类卡死。 */}
            {draft.levels.map((level) => {
              const selected = level.id === draft.value;
              return (
                <button
                  key={level.id}
                  type="button"
                  role="menuitemradio"
                  aria-checked={selected}
                  className={`model-menu-row${selected ? " active" : ""}`}
                  onClick={() => {
                    onApplyEffort(draft.model, level.id);
                    onClose();
                  }}
                >
                  <span className="name">{level.name}</span>
                  {selected && <Check size={15} />}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>,
    document.body,
  );
}
