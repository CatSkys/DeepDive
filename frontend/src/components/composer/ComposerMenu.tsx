// 菜单浮层视图：@ 引用与 / 命令候选的分组渲染 + 单条 glide 高亮（高亮
// 随激活行滑动，而非逐行换底色），底部常驻 ⓘ 搜索提示行。行数据与
// active 索引由编排方持有（键盘导航在 textarea）；本组件只做行测量与呈现。

import { useLayoutEffect, useRef, useState } from "react";
import { Info } from "lucide-react";
import { useT } from "../../i18n";
import type { MenuRow } from "./useComposerMenu";

/** 行按 section 字段分组（相邻同组合并，保持原顺序）。 */
function groupSections(rows: MenuRow[]): Array<{ name: string; rows: MenuRow[] }> {
  const sections: Array<{ name: string; rows: MenuRow[] }> = [];
  for (const r of rows) {
    const last = sections[sections.length - 1];
    if (last && last.name === r.section) last.rows.push(r);
    else sections.push({ name: r.section, rows: [r] });
  }
  return sections;
}

/** 单行按钮；flatIndex 是过滤后扁平列表里的索引（高亮与键盘导航共用）。 */
function MenuRowButton({ row, flatIndex, rowRefs, setActive, onPick }: {
  row: MenuRow;
  flatIndex: number;
  rowRefs: { current: Array<HTMLButtonElement | null> };
  setActive: React.Dispatch<React.SetStateAction<number>>;
  onPick: (row: MenuRow) => void;
}) {
  return (
    <button
      type="button"
      ref={(el) => { rowRefs.current[flatIndex] = el; }}
      onMouseDown={(e) => e.preventDefault()}
      onMouseEnter={() => setActive(flatIndex)}
      onClick={() => onPick(row)}
      className="menu-row"
      data-disabled={row.disabled ? "true" : undefined}
      data-tip={row.detail}
    >
      <row.icon size={15} />
      <span className="label">{row.label}</span>
      {row.detail && <span className="menu-detail">{row.detail}</span>}
    </button>
  );
}

export function ComposerMenu({ menu, query, rows, active, setActive, onPick }: {
  menu: "at" | "slash";
  query: string;
  rows: MenuRow[];
  active: number;
  setActive: React.Dispatch<React.SetStateAction<number>>;
  onPick: (row: MenuRow) => void;
}) {
  const { tt } = useT();
  /** 激活行盒（glide 条定位）；鼠标移出菜单即隐藏。 */
  const [rowBox, setRowBox] = useState<{ top: number; height: number } | null>(null);
  const rowRefs = useRef<Array<HTMLButtonElement | null>>([]);

  // a single highlight glides to the active row instead of each row
  // toggling its own background (reference PromptBar)
  useLayoutEffect(() => {
    const el = rowRefs.current[active];
    if (el) {
      setRowBox({ top: el.offsetTop, height: el.offsetHeight });
      // 候选超限高内滚后，高亮行移出可视区时容器跟随（nearest 只滚必要距离）
      el.scrollIntoView({ block: "nearest" });
    }
  }, [menu, query, active, rows.length]);

  const sections = groupSections(rows);
  const hint = menu === "at"
    ? tt("输入内容以搜索文件或会话", "Type to filter files and sessions")
    : tt("输入内容以搜索命令", "Type to filter commands");
  return (
    <div className="composer-menu" onMouseLeave={() => setRowBox(null)}>
      {/* 毛玻璃：单枚 frost 子层（blur+渐变蒙版=自下而上渐进）。面板自身与
          其他祖先都不得挂 backdrop-filter/常驻 transform，否则 WebKit 里子层
          采样静默失效、只剩底色（「完全不透」事故）。噪点 4% 去塑料平感。 */}
      <span className="menu-frost" aria-hidden />
      <span className="menu-noise" aria-hidden />
      <div className="menu-list">
        <span
          aria-hidden
          className="menu-glide"
          style={{ top: rowBox?.top ?? 0, height: rowBox?.height ?? 0, opacity: rowBox && rows.length > 0 ? 1 : 0 }}
        />
        {sections.map((sec) => (
          <div key={sec.name} className="menu-section">
            <div className="menu-section-name">{sec.name}</div>
            {sec.rows.map((r) => (
              <MenuRowButton
                key={r.id}
                row={r}
                flatIndex={rows.indexOf(r)}
                rowRefs={rowRefs}
                setActive={setActive}
                onPick={onPick}
              />
            ))}
          </div>
        ))}
        {rows.length === 0 && <div className="menu-empty">{tt("没有匹配「{q}」", "No matches for “{q}”", { q: query })}</div>}
      </div>
      <div className="menu-hint">
        <Info size={13} />
        <span>{hint}</span>
      </div>
    </div>
  );
}
