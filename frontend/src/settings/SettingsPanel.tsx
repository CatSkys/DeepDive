import { useEffect, useRef } from "react";
import clsx from "clsx";
import css from "./SettingsRoot.module.css";
import { IconCloseOutline16 } from "./icons";

/** Simplified port of the official dsh ui-settings-general SettingsPanel:
 *  mask + centered panel (800px, r24) + nav rail + header/options content.
 *  The official slot/store indirection is collapsed to plain props; classes
 *  and metrics are the official ones verbatim (token-driven, so the panel
 *  inherits the main window's dark glass). */
export interface SettingsSectionRow {
  id: string;
  label: string;
  icon: (props: { size?: number; className?: string }) => JSX.Element;
  content: React.ReactNode;
}

export function SettingsPanel({ rows, activeId, onSelect, onClose }: {
  rows: readonly SettingsSectionRow[];
  activeId: string;
  onSelect: (id: string) => void;
  onClose: () => void;
}) {
  const closeButton = useRef<HTMLButtonElement>(null);
  useEffect(() => { closeButton.current?.focus(); }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const active = rows.find((r) => r.id === activeId) ?? rows[0];

  return (
    <div
      className={css.overlay}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className={css.mask} />
      <div className={css.panel} role="dialog" aria-modal="true" aria-label="设置">
        <nav className={css.nav}>
          <div className={css.backRow}>
            <button type="button" className={css.back} onClick={onClose}>
              <span style={{ fontSize: 15, lineHeight: 1 }}>←</span>
              返回工作区
            </button>
          </div>
          <div className={css.navGroupLabel}>基础设置</div>
          <div className={css.navList}>
            {rows.map((row) => {
              const Icon = row.icon;
              return (
                <button
                  key={row.id}
                  type="button"
                  className={clsx(css.navCell, row.id === active.id && css.active)}
                  onClick={() => onSelect(row.id)}
                >
                  <Icon size={16} className={css.navIcon} />
                  <span className={css.navLabel}>{row.label}</span>
                </button>
              );
            })}
          </div>
        </nav>
        <div className={css.content}>
          <div className={css.header}>
            <div className={css.pageTitle}>{active.label}</div>
            <button ref={closeButton} type="button" className={css.close} onClick={onClose}>
              <IconCloseOutline16 size={14} />
              <span className={css.hiddenLabel}>关闭</span>
            </button>
          </div>
          <div className={css.options}>{active.content}</div>
        </div>
      </div>
    </div>
  );
}
