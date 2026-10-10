// 模型选择弹层（搜索框 + 按厂商分组的模型列表 + 基准详情卡）。
// 只管**选模型**——思考强度档位是输入框自己的控件（components/composer/EffortPicker.tsx），
// 与模型选择分开（用户 2026-10-09 定稿）。
//
// 详情卡（ModelDetailCard）挂在搜索框右上的 ⓘ：点一下常驻开/关；开着时显示
// hover 行的模型（无 hover 落回当前选择）——速度/智能/成本刻度来自 modelFacts
// 登记表，上下文/能力来自引擎目录投影，未收录的显示「暂无基准数据」占位。
// 卡片与菜单同 portal、都算「菜单内部」（点卡片不触发外点关闭）。
//
// 弹层挂 body（portal + fixed）：会话头的触发器与会话设置面板的滚动容器都会裁掉
// 行内/绝对定位的菜单——面板里当年内联展开还会把下方分区顶下去。
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { RefObject } from "react";
import { useT } from "../i18n";
import { Check, Info, Search } from "lucide-react";
import { ProviderIcon } from "./ProviderIcon";
import { HoverScrollText } from "./HoverScrollText";
import { ModelDetailCard } from "./ModelDetailCard";
import type { ModelBench, ModelPrice } from "../modelFacts";

export interface ModelOption {
  provider: string;
  model: string;
  label: string;
  providerLabel: string;
  /** 该模型的思考强度档位（modelCatalog reasoning 元数据）；空 = 模型不支持调档。
   *  目录原样透传，消费方是输入框的档位胶囊（本菜单不渲染档位）。 */
  efforts?: Array<{ id: string; name: string }>;
  defaultEffort?: string;
  /** 引擎目录透出的能力事实（缺 = 引擎也不知道，详情卡相应省行）。 */
  inputModalities?: string[];
  contextWindow?: number;
  /** 引擎目录透出的 peak 牌价（$/Mtok；缺 = 适配器不发价，详情卡走手工档）。 */
  cost?: ModelPrice;
  /** 基准登记表刻度（modelFacts join）；未收录的模型缺席。 */
  facts?: ModelBench;
}

/** 与 .model-menu 的 width/max-height 同步（定位要按它们算翻转与限高）。 */
const MENU_WIDTH = 280;
const MENU_MAX_HEIGHT = 460;
/** 与 .model-detail 的 width 同步（卡片贴菜单旁定位要按它算）。 */
const CARD_WIDTH = 240;

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
  onPick,
  onClose,
  anchorRef,
}: {
  options: ModelOption[];
  current: string;
  currentModel?: { provider: string; model: string };
  /** 点选模型：由父级提交（会话内 selectModel / 草稿页记 draftModel）。 */
  onPick: (m: ModelOption) => void;
  onClose: () => void;
  /** 触发器元素（弹层按它的 rect 定位，点它不算点菜单外部）。 */
  anchorRef: RefObject<HTMLElement | null>;
}) {
  const { t } = useT();
  const [query, setQuery] = useState("");
  const [infoOn, setInfoOn] = useState(false);
  const [hovered, setHovered] = useState<string | null>(null);
  const [rect, setRect] = useState<{ top: number; left: number; maxHeight: number } | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);

  // 量触发器必须在绘制前完成，否则首帧会闪在左上角（useLayoutEffect）
  useLayoutEffect(() => {
    const el = anchorRef.current;
    if (el) setRect(popupRect(el));
  }, [anchorRef]);

  useEffect(() => {
    const close = (e: MouseEvent) => {
      const target = e.target as Node;
      // 触发器与详情卡也算"内部"：点触发器由父级的开合逻辑接管（否则 mousedown
      // 先关、click 再开，看着像"点不动"）；点卡片只是看数据，不该顺手关菜单。
      if (!ref.current?.contains(target) && !cardRef.current?.contains(target)
        && !anchorRef.current?.contains(target)) onClose();
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [onClose, anchorRef]);

  const flat = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter((m) => m.label.toLowerCase().includes(q) || m.providerLabel.toLowerCase().includes(q));
  }, [options, query]);

  // 分组显示（保持目录顺序）：过滤结果按厂商名聚合；空组在过滤后自然消失。
  const groups = useMemo(() => {
    const out: Array<{ label: string; items: ModelOption[] }> = [];
    const index = new Map<string, ModelOption[]>();
    for (const m of flat) {
      let items = index.get(m.providerLabel);
      if (!items) { items = []; index.set(m.providerLabel, items); out.push({ label: m.providerLabel, items }); }
      items.push(m);
    }
    return out;
  }, [flat]);

  if (rect === null) return null;

  // 卡片位置：优先贴菜单左（参考样式同款），左放不下贴右，再不行贴窗右缘。
  const cardLeft = (() => {
    const l = rect.left - CARD_WIDTH - 10;
    if (l >= 8) return l;
    const r = rect.left + MENU_WIDTH + 10;
    if (r + CARD_WIDTH <= window.innerWidth - 8) return r;
    return Math.max(8, window.innerWidth - CARD_WIDTH - 8);
  })();
  const cardTop = Math.max(8, rect.top);

  // 卡片内容：hover 行优先；无 hover 落回当前选择（当前选择不在目录里则不出卡）。
  const activeOption = options.find((m) => m.label === current || (currentModel?.provider === m.provider && currentModel?.model === m.model));
  const cardOption = (hovered === null ? undefined : flat.find((m) => `${m.provider}/${m.model}` === hovered)) ?? activeOption;

  return createPortal(
    <>
      <div className="model-menu" ref={ref} style={{ top: rect.top, left: rect.left, maxHeight: rect.maxHeight }}>
        <div className="model-menu-view">
          <div className="model-menu-search">
            <Search size={13} />
            <input autoFocus placeholder={t("搜索模型…")} value={query} onChange={(e) => setQuery((e.target as HTMLInputElement).value)} />
            <button
              type="button"
              className="model-menu-info"
              aria-pressed={infoOn}
              title={t("基准详情")}
              onClick={() => setInfoOn((v) => !v)}
            >
              <Info size={13} />
            </button>
          </div>
          <div className="model-menu-body" onMouseLeave={() => setHovered(null)}>
            {groups.map((g) => (
              <div key={g.label}>
                <div className="model-menu-group">{g.label}</div>
                {g.items.map((m) => {
                  const active = m.label === current || (currentModel?.provider === m.provider && currentModel?.model === m.model);
                  return (
                    <button
                      key={`${m.provider}/${m.model}`}
                      className={`model-menu-row${active ? " active" : ""}`}
                      onMouseEnter={() => setHovered(`${m.provider}/${m.model}`)}
                      onClick={() => { onPick(m); onClose(); }}
                    >
                      <ProviderIcon provider={m.provider} size={15} />
                      <HoverScrollText className="name">{m.label}</HoverScrollText>
                      {active && <Check size={15} />}
                    </button>
                  );
                })}
              </div>
            ))}
            {flat.length === 0 && <div className="model-menu-empty">{t("无匹配模型")}</div>}
          </div>
        </div>
      </div>
      {infoOn && cardOption && (
        <div
          className="model-detail"
          ref={cardRef}
          style={{ top: cardTop, left: cardLeft, maxHeight: window.innerHeight - cardTop - 8 }}
        >
          <ModelDetailCard option={cardOption} />
        </div>
      )}
    </>,
    document.body,
  );
}
