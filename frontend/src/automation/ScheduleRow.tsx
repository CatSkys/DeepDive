// 调度行：无计划时是「+ 添加计划」，有计划后展开成 类型 + 参数 下拉，
// 右侧是时区标签、人读摘要与清除钮。参数下拉随类型不同（每周给星期、
// 每月给日、自定义给间隔），一律走设置页同款 Dropdown。

import { useEffect, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Dropdown, type DropdownOption } from "../components/controls";
import { GlassLayer } from "../components/GlassLayer";
import { useT } from "../i18n";
import { clockText, defaultSchedule, describeSchedule, SCHEDULE_KINDS, utcOffsetLabel, weekdayLabel, type Schedule, type ScheduleKind } from "./model";
import css from "./Automation.module.css";

const KIND_LABEL: Record<ScheduleKind, string> = {
  hourly: "每小时",
  daily: "每天",
  weekdays: "每工作日",
  weekly: "每周",
  monthly: "每月",
  custom: "自定义",
};

/** 半点粒度的一天（00:00…23:30）：任务按分钟排班，半小时够用且菜单不长。 */
function timeOptions(atLabel: (text: string) => string): DropdownOption[] {
  const out: DropdownOption[] = [];
  for (let h = 0; h < 24; h++) {
    for (const m of [0, 30]) {
      const text = clockText(h, m);
      out.push({ v: text, label: atLabel(text) });
    }
  }
  return out;
}

function TimeDropdown({ hour, minute, onPick }: { hour: number; minute: number; onPick: (h: number, m: number) => void }) {
  const { tt } = useT();
  return (
    <Dropdown
      variant="bare"
      options={timeOptions((text) => tt("于 {t}", "at {t}", { t: text }))}
      value={clockText(hour, minute)}
      onChange={(v) => onPick(Number(v.slice(0, 2)), Number(v.slice(3, 5)))}
    />
  );
}

function Params({ value, onChange }: { value: Schedule; onChange: (s: Schedule) => void }) {
  const { tt } = useT();
  switch (value.kind) {
    case "hourly":
      return (
        <Dropdown
          variant="bare"
          options={[0, 15, 30, 45].map((m): DropdownOption => ({ v: String(m), label: `:${clockText(0, m).slice(3)}` }))}
          value={String(value.minute)}
          onChange={(v) => onChange({ ...value, minute: Number(v) })}
        />
      );
    case "daily":
    case "weekdays":
      return <TimeDropdown hour={value.hour} minute={value.minute} onPick={(h, m) => onChange({ ...value, hour: h, minute: m })} />;
    case "weekly":
      return (
        <>
          <Dropdown
            variant="bare"
            options={[1, 2, 3, 4, 5, 6, 0].map((wd): DropdownOption => ({ v: String(wd), label: weekdayLabel(wd) }))}
            value={String(value.weekday)}
            onChange={(v) => onChange({ ...value, weekday: Number(v) })}
          />
          <TimeDropdown hour={value.hour} minute={value.minute} onPick={(h, m) => onChange({ ...value, hour: h, minute: m })} />
        </>
      );
    case "monthly":
      return (
        <>
          <Dropdown
            variant="bare"
            options={Array.from({ length: 28 }, (_, i): DropdownOption => ({ v: String(i + 1), label: tt("{n} 日", "Day {n}", { n: String(i + 1) }) }))}
            value={String(value.day)}
            onChange={(v) => onChange({ ...value, day: Number(v) })}
          />
          <TimeDropdown hour={value.hour} minute={value.minute} onPick={(h, m) => onChange({ ...value, hour: h, minute: m })} />
        </>
      );
    case "custom":
      return (
        <>
          <Dropdown
            variant="bare"
            options={Array.from({ length: 30 }, (_, i): DropdownOption => ({ v: String(i + 1), label: tt("每 {n} 天", "Every {n} days", { n: String(i + 1) }) }))}
            value={String(value.everyDays)}
            onChange={(v) => onChange({ ...value, everyDays: Number(v) })}
          />
          <TimeDropdown hour={value.hour} minute={value.minute} onPick={(h, m) => onChange({ ...value, hour: h, minute: m })} />
        </>
      );
  }
}

export function ScheduleRow({ value, onChange }: { value: Schedule | null; onChange: (s: Schedule | null) => void }) {
  const { t } = useT();
  const [menuAt, setMenuAt] = useState<{ top: number; left: number } | null>(null);

  // 点空白收起计划类型菜单（与侧栏右键菜单同款；开菜单那一下在按钮里 stopPropagation）
  useEffect(() => {
    if (!menuAt) return;
    const close = () => setMenuAt(null);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, [menuAt]);

  if (value === null) {
    return (
      <div className={css.schedRow}>
        <button
          className={css.addPlan}
          onClick={(e) => {
            e.stopPropagation();
            const r = e.currentTarget.getBoundingClientRect();
            setMenuAt({ top: r.bottom + 4, left: r.left });
          }}
        >
          <Plus size={14} /> {t("添加计划")}
        </button>
        {menuAt && (
          <div className="ctx-menu" style={{ top: menuAt.top, left: menuAt.left }} onClick={(e) => e.stopPropagation()}>
            <GlassLayer />
            {SCHEDULE_KINDS.map((kind) => (
              <div key={kind} className="ctx-item" onClick={() => { setMenuAt(null); onChange(defaultSchedule(kind)); }}>
                {t(KIND_LABEL[kind])}
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  const sched = describeSchedule(value);
  return (
    <div className={css.schedRow}>
      <Dropdown
        variant="bare"
        options={SCHEDULE_KINDS.map((kind): DropdownOption => ({ v: kind, label: t(KIND_LABEL[kind]) }))}
        value={value.kind}
        onChange={(v) => onChange(defaultSchedule(v as ScheduleKind))}
      />
      <Params value={value} onChange={onChange} />
      <span className={css.schedText}>{utcOffsetLabel()}</span>
      <span className={css.schedText}>{sched.time ? `${sched.prefix}, ${sched.time}` : sched.prefix}</span>
      <button className={css.trashBtn} data-tip={t("清除计划")} aria-label={t("清除计划")} onClick={() => onChange(null)}>
        <Trash2 size={14} />
      </button>
    </div>
  );
}
