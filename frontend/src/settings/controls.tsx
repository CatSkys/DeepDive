import { useEffect, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import { createPortal } from "react-dom";
import { IconCheckOutline16 } from "../settings/primitives/icons";
import rowsCss from "../settings/SettingsRows.module.css";

/** Shared controls for the built-in settings sections: monochrome toggle,
 *  labelled row, labelled group card, custom dropdown (portaled so the
 *  options scroller cannot clip it). Styles: SettingsRows.module.css. */

export function Toggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      className={`${rowsCss.toggle}${on ? ` ${rowsCss.on}` : ""}`}
      role="switch"
      aria-checked={on}
      onClick={() => onChange(!on)}
    />
  );
}

export function Dropdown({ options, value, onChange }: { options: Array<{ v: string; label: string }>; value: string; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number; minWidth: number } | null>(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  const toggle = () => {
    if (!open) {
      const r = triggerRef.current?.getBoundingClientRect();
      if (r) setPos({ top: r.bottom + 4, left: r.left, minWidth: r.width });
    }
    setOpen((o) => !o);
  };
  const current = options.find((o) => o.v === value);
  // Portaled to <body> with fixed positioning: the options scroller clips
  // absolutely-positioned menus (user report).
  const menu = open && pos && createPortal(
    <div
      className={rowsCss.ddMenu}
      role="listbox"
      style={{
        position: "fixed",
        // space below the trigger, else flip above it
        ...(window.innerHeight - pos.top > options.length * 36 + 24
          ? { top: pos.top }
          : { bottom: window.innerHeight - pos.top + 4 }),
        left: Math.max(8, Math.min(pos.left, window.innerWidth - pos.minWidth - 12)),
        minWidth: pos.minWidth,
      }}
    >
      {options.map((o) => (
        <button
          key={o.v}
          type="button"
          className={rowsCss.ddItem}
          onClick={() => {
            setOpen(false);
            if (o.v !== value) onChange(o.v);
          }}
        >
          <span>{o.label}</span>
          {o.v === value && <IconCheckOutline16 size={14} className={rowsCss.ddCheck} />}
        </button>
      ))}
    </div>,
    document.body,
  );
  return (
    <div className={rowsCss.dd} ref={rootRef}>
      <button ref={triggerRef} type="button" className={rowsCss.ddTrigger} onClick={toggle}>
        <span>{current?.label ?? value}</span>
        <ChevronDown size={14} className={rowsCss.ddChevron} />
      </button>
      {menu}
    </div>
  );
}

export function Row({ title, caption, children }: { title: string; caption?: string; children?: React.ReactNode }) {
  return (
    <div className={rowsCss.rowCard}>
      <div className={rowsCss.rowHead}>
        <div className={rowsCss.rowIdentity}>
          <div className={rowsCss.rowName}>{title}</div>
          {caption && <div className={rowsCss.rowCaption}>{caption}</div>}
        </div>
        <div className={rowsCss.rowActions}>{children}</div>
      </div>
    </div>
  );
}

export function Section({ title, intro, children }: { title: string; intro?: string; children: React.ReactNode }) {
  return (
    <div className={rowsCss.section}>
      <div className={rowsCss.title}>{title}</div>
      {intro && <div className={rowsCss.intro}>{intro}</div>}
      <div className={rowsCss.rows}>{children}</div>
    </div>
  );
}
