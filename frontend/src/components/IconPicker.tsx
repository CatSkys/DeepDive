// 项目图标选择器（新建项目弹窗「名称」行尾的触发钮，版式照参考图）：点开
// 一个带搜索框的浮层，从 lucide 精选集里按名字搜索、点选回填触发钮上的
// glyph。精选集只收适合当项目头像的 ~46 个 glyph——不做 lucide 全集的
// 千项长列表。菜单配方复用 Dropdown 的 .ddMenu/.ddItem（portal 防裁切、
// 放不下向上翻、翻转分支显式 top:"auto"，PITFALLS §1.7）。
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Anchor, Bot, Boxes, Bug, Building2, Bike, Book, BookOpen, Briefcase, Car,
  Camera, Cloud, Code, Coffee, Cpu, Database, Feather, Film,
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
import { Popover } from "./Popover";

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

/** 名称首字（拉丁取大写、CJK 原字；空名回落 ?）——项目图标位的末档回落。 */
export function wsInitial(label: string): string {
  return label.trim().charAt(0).toUpperCase() || "?";
}

/** 首字母图标位：项目图标位末档回落的唯一渲染点。给了 size 就占成图标同尺寸的
    方框（列表里与 lucide 图标同列对齐），不给则随容器（侧栏行首是绝对定位槽位）。 */
export function WsInitial({ label, size, className }: { label: string; size?: number; className?: string }) {
  return (
    <span
      className={`ws-initial${className ? ` ${className}` : ""}`}
      style={size ? { width: size, height: size, fontSize: Math.max(9, size - 3.5) } : undefined}
    >
      {wsInitial(label)}
    </span>
  );
}

/** 项目图标位（两档）：弹窗里选的 glyph，没选就是名称首字母——「默认（首字母）」
 *  那一档的实际观感。带根目录图标文件一档的消费面（底部切换条）自己在这两档
 *  中间插 img；显示优先级见 wsIcons.ts 头部注释。 */
export function WsGlyph({ name, label, size, className }: {
  name: string | null; label: string; size: number; className?: string;
}) {
  const Glyph = wsGlyphIcon(name);
  return Glyph ? <Glyph size={size} className={className} /> : <WsInitial label={label} size={size} className={className} />;
}

const MENU_WIDTH = 240;
/** 行高 30 = .ddItem；列表本体最多露 5 项（用户定稿，含「默认（首字母）」那一行，
   与 .iconList 的 max-height 150px 是一对，改一个要改另一个）。 */
const ROW_H = 30;
const MAX_ROWS = 5;
/** 搜索行与菜单内边距的高度估算（沿用原值，未变）。 */
const SEARCH_H = 46;
const MENU_PAD = 16;

/** 菜单自然高度：搜索行 + 最多 5 项 + 内边距。 */
const menuHeight = (iconCount: number) => SEARCH_H + Math.min(1 + iconCount, MAX_ROWS) * ROW_H + MENU_PAD;

export function IconPicker({ value, label, onChange }: { value: string | null; label: string; onChange: (v: string | null) => void }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return ICONS;
    return ICONS.filter((i) => i.name.toLowerCase().includes(q));
  }, [query]);

  const toggle = () => {
    if (!open) setQuery("");
    setOpen((o) => !o);
  };

  // Esc 由 Popover 在 document 捕获阶段截断（stopPropagation），弹窗那层收不到
  // ——「Esc 只关菜单不关整个弹窗」这条因此仍然是菜单自己的事。
  const menu = (
    <Popover
      open={open}
      anchor={triggerRef}
      onClose={() => setOpen(false)}
      sideOffset={4}
      align="end"
      width={MENU_WIDTH}
      height={menuHeight(filtered.length)}
      className={rowsCss.ddMenu}
      role="listbox"
      contentRef={menuRef}
    >
      <IconMenuBody value={value} label={label} onPick={(v) => { setOpen(false); onChange(v); }} query={query} setQuery={setQuery} />
    </Popover>
  );

  return (
    <div className={css.pickerRoot} ref={rootRef}>
      <button ref={triggerRef} type="button" className={css.pickerTrigger} aria-label={t("图标")} onClick={toggle}>
        <WsGlyph name={value} label={label} size={14} />
        <ChevronDown size={12} />
      </button>
      {menu}
    </div>
  );
}

/* ── 菜单体：搜索行 + 「默认」复位项 + 精选集过滤列表（两种入口共用） ── */

function IconMenuBody({ value, label, onPick, query, setQuery }: {
  value: string | null;
  label: string;
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
      <div className={css.iconList}>
        <button type="button" className={rowsCss.ddItem} onClick={() => onPick(null)}>
          <WsInitial label={label} size={15} className={rowsCss.ddItemIcon} />
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
      </div>
    </>
  );
}

/* ── 坐标锚定的独立图标选择器（项目右键菜单「修改图标」）：App 根部挂一次
    <IconPickerHost />，任何入口经 openIconPickerAt 打开 ── */

interface IconPickerRequest {
  x: number;
  y: number;
  value: string | null;
  /** 项目名：首字母回落的字面来源（「默认（首字母）」那一档的观感）。 */
  label: string;
  onChange: (v: string | null) => void;
}

let dispatchReq: ((req: IconPickerRequest) => void) | null = null;

export function openIconPickerAt(req: IconPickerRequest): void {
  dispatchReq?.(req);
}

export function IconPickerHost() {
  const [req, setReq] = useState<IconPickerRequest | null>(null);
  const [query, setQuery] = useState("");
  const menuRef = useRef<HTMLDivElement | null>(null);

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
  return (
    <Popover
      open
      anchor={{ top: req.y, bottom: req.y, left: req.x, right: req.x, width: 0, height: 0 }}
      onClose={() => setReq(null)}
      sideOffset={4}
      width={MENU_WIDTH}
      height={menuHeight(ICONS.length)}
      className={rowsCss.ddMenu}
      role="listbox"
      contentRef={menuRef}
    >
      <IconMenuBody
        value={req.value}
        label={req.label}
        onPick={(v) => { req.onChange(v); setReq(null); }}
        query={query}
        setQuery={setQuery}
      />
    </Popover>
  );
}
