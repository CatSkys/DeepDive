// settings.update 的读-改-写围栏单一实现（此前各 section 手抄且冲突无提示）：
// describe 快照（value+revision）缓存于 ref；update 以快照 revision 为
// expectedRevision 提交「快照现值 ∪ patch」，被引擎版本围栏拒绝时抛
// SettingsConflictError 交调用方提示。不做乐观 UI、不做自动重试——桌面单
// 客户端，冲突对用户可见即可。
import { useCallback, useRef } from "react";
import { api, type SettingsNamespaceEntry } from "../api";

/** 引擎 revision 围栏拒绝（wire code settings-conflict）：命名空间在本端
 *  快照之后被其他写入方推进（另一窗口 / settings.yaml 外部编辑）。 */
export class SettingsConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SettingsConflictError";
  }
}

// api.unary 把 RPC error.code 拼成 message 前缀（"settings-conflict: …"），
// 冲突只能从该前缀识别。
const isConflict = (err: unknown): boolean =>
  err instanceof Error && err.message.startsWith("settings-conflict");

/** 非组件场景的一次性围栏写（对话框保存/目录删除等）：describe→find→
 *  以快照 revision 提交，与 hook 同源——冲突抛 SettingsConflictError，
 *  命名空间缺失抛 Error(missingMsg)。 */
export async function writeNamespaceOnce(
  ns: string,
  missingMsg: string,
  submit: (entry: SettingsNamespaceEntry) => Promise<void>,
): Promise<void> {
  const d = await api.settingsDescribe();
  const entry = (d.namespaces ?? []).find((n) => n.ns === ns);
  if (!entry) throw new Error(missingMsg);
  try {
    await submit(entry);
  } catch (err) {
    if (isConflict(err)) throw new SettingsConflictError((err as Error).message);
    throw err;
  }
}

export function useSettingNamespace(ns: string) {
  // 最近一次 describe 快照，update 依据它带 expectedRevision。写成功后置空
  // （引擎 revision 已前进，复用旧快照必致假冲突），下次 update 重取。
  const snapRef = useRef<SettingsNamespaceEntry | undefined>(undefined);

  const describe = useCallback(async (): Promise<SettingsNamespaceEntry | undefined> => {
    const d = await api.settingsDescribe();
    const entry = (d.namespaces ?? []).find((n) => n.ns === ns);
    snapRef.current = entry;
    return entry;
  }, [ns]);

  /** patch 与快照现值合并为整段命名空间值提交；引擎未提供该命名空间时
   *  静默跳过（各 section 原有降级行为）。 */
  const update = useCallback(async (patch: Record<string, unknown>): Promise<void> => {
    const snap = snapRef.current ?? await describe();
    if (!snap) return; /* 引擎无该命名空间：不写不报 */
    const base = (snap.value ?? {}) as Record<string, unknown>;
    try {
      await api.settingsUpdate({ ns, patch: { ...base, ...patch }, expectedRevision: snap.revision });
    } catch (err) {
      if (isConflict(err)) throw new SettingsConflictError((err as Error).message);
      throw err;
    }
    snapRef.current = undefined;
  }, [ns, describe]);

  return { describe, update };
}
