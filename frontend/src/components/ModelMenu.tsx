// 模型选择弹层（搜索框 + 平铺模型列表：图标 + 白字模型名 + 浅色小字厂商名 + 当前项对勾）。
// 只管**选模型**——思考强度档位是输入框自己的控件（components/composer/EffortPicker.tsx），
// 与模型选择分开（用户 2026-10-09 定稿）。Speed 不做。
//
// 弹层挂 body（portal + fixed）：会话头的触发器与会话设置面板的滚动容器都会裁掉
// 行内/绝对定位的菜单——面板里当年内联展开还会把下方分区顶下去。
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { RefObject } from "react";
import { useT } from "../i18n";
import { Check, Search } from "lucide-react";
import { ProviderIcon } from "./ProviderIcon";
import { HoverScrollText } from "./HoverScrollText";

export interface ModelOption {
  provider: string;
  model: string;
  label: string;
  providerLabel: string;
  /** 该模型的思考强度档位（modelCatalog reasoning 元数据）；空 = 模型不支持调档。
   *  目录原样透传，消费方是输入框的档位胶囊（本菜单不渲染档位）。 */
  efforts?: Array<{ id: string; name: string }>;
  defaultEffort?: string;
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

  if (rect === null) return null;

  return createPortal(
    <div className="model-menu" ref={ref} style={{ top: rect.top, left: rect.left, maxHeight: rect.maxHeight }}>
      <div className="model-menu-view">
        <div className="model-menu-search">
          <Search size={13} />
          <input autoFocus placeholder={t("搜索模型…")} value={query} onChange={(e) => setQuery((e.target as HTMLInputElement).value)} />
        </div>
        <div className="model-menu-body">
          {flat.map((m) => {
            const active = m.label === current || (currentModel?.provider === m.provider && currentModel?.model === m.model);
            return (
              <button
                key={`${m.provider}/${m.model}`}
                className={`model-menu-row${active ? " active" : ""}`}
                onClick={() => { onPick(m); onClose(); }}
              >
                <ProviderIcon provider={m.provider} size={15} />
                <HoverScrollText className="name">{m.label}</HoverScrollText>
                <span className="provider">{m.providerLabel}</span>
                {active && <Check size={15} />}
              </button>
            );
          })}
          {flat.length === 0 && <div className="model-menu-empty">{t("无匹配模型")}</div>}
        </div>
      </div>
    </div>,
    document.body,
  );
}
