// 会话历史脸的「分组 / 排序」偏好：一块 localStorage（与 browserPrefs 同口径——纯展示
// 偏好，壳不需要知道）。默认按日期分组、按最近更新排序。
//
// 值来自 localStorage 就是外部输入：读的时候按白名单校验，坏值/旧值回默认，不写兜底逻辑
// （铁律 5：边界处显式收敛）。

import { useCallback, useState } from "react";
import type { HistoryGroup, HistorySort } from "./miniHistoryView";

const KEY = "deepdive.miniHistory.view";

export interface MiniHistoryView {
  group: HistoryGroup;
  sort: HistorySort;
}

const GROUPS: readonly HistoryGroup[] = ["date", "status", "agent", "none"];
const SORTS: readonly HistorySort[] = ["updated", "title"];
const DEFAULT_VIEW: MiniHistoryView = { group: "date", sort: "updated" };

function read(): MiniHistoryView {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "null") as Partial<MiniHistoryView> | null;
    if (!raw) return DEFAULT_VIEW;
    return {
      group: GROUPS.includes(raw.group as HistoryGroup) ? (raw.group as HistoryGroup) : DEFAULT_VIEW.group,
      sort: SORTS.includes(raw.sort as HistorySort) ? (raw.sort as HistorySort) : DEFAULT_VIEW.sort,
    };
  } catch {
    /* localStorage 值损坏（非 JSON）：回默认，不留半份坏值 */
    return DEFAULT_VIEW;
  }
}

export function useMiniHistoryView(): [MiniHistoryView, (patch: Partial<MiniHistoryView>) => void] {
  const [view, setView] = useState<MiniHistoryView>(read);
  const update = useCallback((patch: Partial<MiniHistoryView>) => {
    setView((prev) => {
      const next = { ...prev, ...patch };
      try {
        localStorage.setItem(KEY, JSON.stringify(next));
      } catch {
        /* 存储不可用（无痕/配额）：偏好退化成会话内有效，界面照常 */
      }
      return next;
    });
  }, []);
  return [view, update];
}
