import { useEffect, useMemo, useRef, useState } from "react";
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

/** Change-Model sheet（参考双层结构）：
 *  第一层 = 搜索框 + 平铺模型列表（图标 + 白字模型名 + 浅色小字厂商名 + 箭头）；
 *  点模型 → 第二层该模型的思考强度页（单选列表，选中档带对勾，点选即提交并关菜单）。
 *  Speed 不做。 */
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
      // 都为空则取第一档 —— 列表里只有真实档位，点选必提交具体 id。
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
    </div>
  );
}
