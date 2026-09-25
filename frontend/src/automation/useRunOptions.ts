// 编辑器底部那排运行选项的数据源：工作空间（store 现况）、权限预设（引擎
// permission 命名空间的省缺值枚举）、模型与思考档位（session/modelCatalog）。
// 各自独立降级：引擎未就绪时该面留空，界面只在有得选时才摆下拉。

import { useEffect, useState } from "react";
import { api } from "../api";
import type { ModelOption } from "../components/ModelMenu";
import { permissionPresetView, type PresetOption } from "../settings/permissionPreset";
import { useStore } from "../store";

export interface RunOptions {
  workspaces: ReturnType<typeof useStore>["workspaces"];
  permissions: PresetOption[];
  models: ModelOption[];
}

export function useRunOptions(): RunOptions {
  const store = useStore();
  const [permissions, setPermissions] = useState<PresetOption[]>([]);
  const [models, setModels] = useState<ModelOption[]>([]);

  useEffect(() => {
    let alive = true;
    void api.settingsDescribe()
      .then((d) => {
        if (!alive) return;
        const entry = (d.namespaces ?? []).find((n) => n.ns === "permission");
        setPermissions(permissionPresetView(entry)?.options ?? []);
      })
      .catch(() => { /* 引擎未就绪：权限面留空，运行走会话默认 */ });
    void api.modelOptions()
      .then((r) => { if (alive) setModels(r.options); })
      .catch(() => { /* 同上，模型面留空，运行走引擎默认模型 */ });
    return () => { alive = false; };
  }, []);

  return { workspaces: store.workspaces, permissions, models };
}
