// 命令中心的**选择页**：卡内翻到的那一层——一段段选项列表，当前值打勾，点一下就写完并返回。
// 模型、思考强度、权限、会话模式、发送方式全是这一个件，只有 sections 不同（各脸自己装配，
// 见 MiniSettingsRows）。只管呈现与按查询过滤；写回由调用方的 onPick 给（写入路径仍是既有那些）。
import { Check } from "lucide-react";
import { useT } from "../i18n";

export interface ChoiceOption {
  v: string;
  label: string;
}

export interface ChoiceSection {
  key: string;
  /** 段标题（如模型页的厂商名）；不给就不画标题行。 */
  title?: string;
  options: ChoiceOption[];
}

/** 过滤后展平的行序（段序即视觉序）——键盘光标与「这一屏有哪些可选项」同源。 */
export function flattenChoices(sections: ChoiceSection[], query: string): ChoiceOption[] {
  const q = query.trim().toLowerCase();
  return sections.flatMap((s) => s.options.filter((o) => !q || o.label.toLowerCase().includes(q)));
}

export function MiniChoicePage({
  sections,
  value,
  query,
  cursor,
  onPick,
}: {
  sections: ChoiceSection[];
  /** 当前值（打勾那一条）。 */
  value: string | undefined;
  query: string;
  /** 键盘光标（面板持有：搜索框拿着焦点，行序是各页展平出来的）。 */
  cursor: number;
  onPick: (v: string) => void;
}) {
  const { t } = useT();
  const q = query.trim().toLowerCase();
  const shown = sections
    .map((s) => ({ ...s, options: s.options.filter((o) => !q || o.label.toLowerCase().includes(q)) }))
    .filter((s) => s.options.length > 0);
  let index = -1;
  return (
    <div className="mini-cc-list">
      {shown.map((section) => (
        <section className="mini-cc-section" key={section.key}>
          {section.title !== undefined && <h3 className="mini-cc-section-title">{section.title}</h3>}
          {section.options.map((o) => {
            index += 1;
            const here = index;
            return (
              <button
                type="button"
                key={`${section.key}:${o.v}`}
                className="mini-cc-choice"
                data-cursor={here === cursor || undefined}
                onClick={() => onPick(o.v)}
              >
                <span className="mini-cc-choice-label">{o.label}</span>
                {o.v === value && <Check size={14} className="mini-cc-choice-check" />}
              </button>
            );
          })}
        </section>
      ))}
      {shown.length === 0 && <p className="mini-cc-empty">{t("没有匹配的选项")}</p>}
    </div>
  );
}
