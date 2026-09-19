// 项目图标 glyph（新建项目弹窗里选的 lucide 图标名）按 workspaceId 存
// localStorage：桥端口已固定（PITFALLS §4.17），localStorage 跨启动稳定，
// 与 deepdive.pinned / deepdive.usageFold 同一先例。引擎 wire 的
// WorkspaceView 没有 icon 字段，这是纯前端装饰层。显示优先级（三处消费方
// 侧栏项目行 / 底部切换条 / 弹窗预览统一走 useWsIcon）：
//   所选 glyph > 项目根目录约定图标文件（useWorkspaceIcon）> 首字母。
import { useEffect, useState } from "react";

const PREFIX = "deepdive.ws.icon.";

const cache = new Map<string, string | null>();
const listeners = new Set<() => void>();

function read(id: string): string | null {
  if (!cache.has(id)) cache.set(id, localStorage.getItem(PREFIX + id));
  return cache.get(id) ?? null;
}

function notify(): void {
  for (const l of listeners) l();
}

export function getWsIcon(id: string): string | null {
  return read(id);
}

export function setWsIcon(id: string, glyph: string): void {
  localStorage.setItem(PREFIX + id, glyph);
  cache.set(id, glyph);
  notify();
}

/** 删除工作区时清理（WorkspaceMenu.remove），避免 key 无限累积。 */
export function clearWsIcon(id: string): void {
  localStorage.removeItem(PREFIX + id);
  cache.delete(id);
  notify();
}

/** 订阅式读取：任何一处 set/clear，三处消费方同步重渲。 */
export function useWsIcon(id: string | undefined): string | null {
  const [, bump] = useState(0);
  useEffect(() => {
    const l = () => bump((v) => v + 1);
    listeners.add(l);
    return () => { listeners.delete(l); };
  }, []);
  return id ? read(id) : null;
}
