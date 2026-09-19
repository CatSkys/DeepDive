// 项目图标选择器（新建项目弹窗「名称」行尾的触发钮，版式照参考图）：点开
// 一个带搜索框的浮层，从 lucide 精选集里按名字搜索、点选回填触发钮上的
// glyph。精选集只收适合当项目头像的 ~46 个 glyph——不做 lucide 全集的
// 千项长列表。菜单配方复用 Dropdown 的 .ddMenu/.ddItem（portal 防裁切、
// 放不下向上翻、翻转分支显式 top:"auto"，PITFALLS §1.7）。
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  Anchor, Bot, Boxes, Bug, Building2, Bike, Book, BookOpen, Briefcase, Car,
  Camera, CircleSlash, Cloud, Code, Coffee, Cpu, Database, Feather, Film,
  FlaskConical, Flame, Folder, Gamepad2, Globe, GraduationCap, Hammer, Heart,
  Home, Image, Layers, Monitor, Music, Package, Palette, PenLine, Plane,
  Rocket, Server, ShoppingBag, Smartphone, Sparkles, Star, Target, Terminal,
  Trophy, Wrench, Zap,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Check, ChevronDown } from "lucide-react";
import rowsCss from "../settings/SettingsRows.module.css";
import css from "./NewProjectDialog.module.css";
import { t } from "../i18n";

/** 精选集（名字即菜单行文案，图标名保持 lucide 原名不翻译）。 */
const ICONS: Array<{ name: string; icon: LucideIcon }> = [
  { name: "Folder", icon: Folder }, { name: "Rocket", icon: Rocket },
  { name: "Bug", icon: Bug }, { name: "FlaskConical", icon: FlaskConical },
  { name: "Hammer", icon: Hammer }, { name: "Wrench", icon: Wrench },
  { name: "Book", icon: Book }, { name: "BookOpen", icon: BookOpen },
  { name: "PenLine", icon: PenLine }, { name: "Code", icon: Code },
  { name: "Terminal", icon: Terminal }, { name: "Database", icon: Database },
  { name: "Server", icon: Server }, { name: "Cloud", icon: Cloud },
  { name: "Globe", icon: Globe }, { name: "Star", icon: Star },
  { name: "Heart", icon: Heart }, { name: "Zap", icon: Zap },
  { name: "Flame", icon: Flame }, { name: "Target", icon: Target },
  { name: "Trophy", icon: Trophy }, { name: "Music", icon: Music },
  { name: "Camera", icon: Camera }, { name: "Image", icon: Image },
  { name: "Film", icon: Film }, { name: "Gamepad2", icon: Gamepad2 },
  { name: "ShoppingBag", icon: ShoppingBag }, { name: "Briefcase", icon: Briefcase },
  { name: "GraduationCap", icon: GraduationCap }, { name: "Plane", icon: Plane },
  { name: "Car", icon: Car }, { name: "Bike", icon: Bike },
  { name: "Home", icon: Home }, { name: "Building2", icon: Building2 },
  { name: "Package", icon: Package }, { name: "Boxes", icon: Boxes },
  { name: "Layers", icon: Layers }, { name: "Cpu", icon: Cpu },
  { name: "Smartphone", icon: Smartphone }, { name: "Monitor", icon: Monitor },
  { name: "Bot", icon: Bot }, { name: "Sparkles", icon: Sparkles },
  { name: "Palette", icon: Palette }, { name: "Feather", icon: Feather },
  { name: "Anchor", icon: Anchor }, { name: "Coffee", icon: Coffee },
];

/** glyph 名 → 图标组件；查无（历史脏数据）回 null，由消费方走下一级回落。 */
export function wsGlyphIcon(name: string | null): LucideIcon | null {
  if (!name) return null;
  return ICONS.find((i) => i.name === name)?.icon ?? null;
}

const MENU_WIDTH = 240;

export function IconPicker({ value, onChange }: { value: string | null; onChange: (v: string | null) => void }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [pos, setPos] = useState<{ top: number; maxH: number; left: number } | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const target = e.target as Node;
      // portal 菜单挂 body，但点击沿 React 树冒泡——两个子树都算"内部"
      if (!rootRef.current?.contains(target) && !menuRef.current?.contains(target)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return ICONS;
    return ICONS.filter((i) => i.name.toLowerCase().includes(q));
  }, [query]);

  // 菜单高：搜索行 46 + 行 30/个 + 内边距；摆不下时压限高度内滚。
  const menuH = (n: number) => 46 + n * 30 + 16;

  const toggle = () => {
    if (!open) {
      const r = triggerRef.current?.getBoundingClientRect();
      if (r) {
        const h = menuH(filtered.length);
        const below = window.innerHeight - r.bottom;
        // 下方放不下且上方更高才向上翻；翻转分支显式 top:"auto"（PITFALLS §1.7）
        const flip = below < h + 12 && r.top > below;
        setPos({
          top: flip ? Math.max(8, r.top - Math.min(h, r.top - 12) - 4) : r.bottom + 4,
          maxH: Math.min(h, (flip ? r.top : below) - 16),
          left: Math.max(8, Math.min(r.right - MENU_WIDTH, window.innerWidth - MENU_WIDTH - 8)),
        });
      }
      setQuery("");
    }
    setOpen((o) => !o);
  };

  // 菜单 portal 到 body 但仍是弹窗的 React 子树：keydown 在此截断
  //（stopPropagation），Escape 只关菜单不关整个弹窗。
  const CurrentIcon = wsGlyphIcon(value) ?? Folder;
  const menu = open && pos && createPortal(
    <div
      ref={menuRef}
      className={rowsCss.ddMenu}
      role="listbox"
      style={{
        position: "fixed",
        top: pos.top,
        bottom: "auto",
        left: pos.left,
        right: "auto",
        // 显式 min-width：.ddMenu 类自带 min-width:100%（以 body 为基准，
        // 会把菜单撑到整屏宽）
        width: MENU_WIDTH,
        minWidth: MENU_WIDTH,
        maxHeight: pos.maxH,
        overflowY: "auto",
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape") { e.stopPropagation(); setOpen(false); }
      }}
    >
      <IconMenuBody value={value} onPick={(v) => { setOpen(false); onChange(v); }} query={query} setQuery={setQuery} />
    </div>,
    document.body,
  );

  return (
    <div className={css.pickerRoot} ref={rootRef}>
      <button ref={triggerRef} type="button" className={css.pickerTrigger} aria-label={t("图标")} onClick={toggle}>
        <CurrentIcon size={14} />
        <ChevronDown size={12} />
      </button>
      {menu}
    </div>
  );
}

/* ── 菜单体：搜索行 + 「默认」复位项 + 精选集过滤列表（两种入口共用） ── */

function IconMenuBody({ value, onPick, query, setQuery }: {
  value: string | null;
  onPick: (v: string | null) => void;
  query: string;
  setQuery: (q: string) => void;
}) {
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return ICONS;
    return ICONS.filter((i) => i.name.toLowerCase().includes(q));
  }, [query]);
  return (
    <>
      <div className={css.searchRow}>
        <input autoFocus placeholder={t("搜索")} value={query} onChange={(e) => setQuery(e.target.value)} />
      </div>
      <button type="button" className={rowsCss.ddItem} onClick={() => onPick(null)}>
        <CircleSlash size={15} className={rowsCss.ddItemIcon} />
        <span className={rowsCss.ddItemMain}><span>{t("默认（首字母）")}</span></span>
        {value === null && <Check size={14} className={rowsCss.ddCheck} />}
      </button>
      {filtered.map(({ name, icon: Icon }) => (
        <button key={name} type="button" className={rowsCss.ddItem} onClick={() => onPick(name)}>
          <Icon size={15} className={rowsCss.ddItemIcon} />
          <span className={rowsCss.ddItemMain}><span>{name}</span></span>
          {value === name && <Check size={14} className={rowsCss.ddCheck} />}
        </button>
      ))}
      {filtered.length === 0 && <div className={css.searchEmpty}>{t("无结果")}</div>}
    </>
  );
}

/* ── 坐标锚定的独立图标选择器（项目右键菜单「修改图标」）：App 根部挂一次
    <IconPickerHost />，任何入口经 openIconPickerAt 打开 ── */

interface IconPickerRequest {
  x: number;
  y: number;
  value: string | null;
  onChange: (v: string | null) => void;
}

let dispatchReq: ((req: IconPickerRequest) => void) | null = null;

export function openIconPickerAt(req: IconPickerRequest): void {
  dispatchReq?.(req);
}

export function IconPickerHost() {
  const [req, setReq] = useState<IconPickerRequest | null>(null);
  const [query, setQuery] = useState("");
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    dispatchReq = (r) => { setQuery(""); setReq(r); };
    return () => { dispatchReq = null; };
  }, []);

  useEffect(() => {
    if (!req) return;
    const onDoc = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setReq(null);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setReq(null); };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [req]);

  if (!req) return null;
  // 位置夹在视口内；底部放不下向上翻（maxH 压限内滚）
  const left = Math.max(8, Math.min(req.x, window.innerWidth - MENU_WIDTH - 8));
  const h = 46 + ICONS.length * 30 + 16;
  const below = window.innerHeight - req.y;
  const flip = below < h + 12 && req.y > below;
  const top = flip ? Math.max(8, req.y - Math.min(h, req.y - 12) - 4) : req.y + 4;
  return createPortal(
    <div
      ref={menuRef}
      className={rowsCss.ddMenu}
      role="listbox"
      style={{
        position: "fixed",
        top,
        bottom: "auto",
        left,
        right: "auto",
        width: MENU_WIDTH,
        minWidth: MENU_WIDTH,
        maxHeight: Math.min(h, (flip ? req.y : below) - 16),
        overflowY: "auto",
      }}
    >
      <IconMenuBody
        value={req.value}
        onPick={(v) => { req.onChange(v); setReq(null); }}
        query={query}
        setQuery={setQuery}
      />
    </div>,
    document.body,
  );
}
