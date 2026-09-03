import { useEffect, useRef, useState } from "react";
import { listDir } from "./host";

// @ 引用候选 hook：查询串按最后一个 / 拆 目录前缀/文件名过滤段，
// 目录层经壳侧 listDir 列举（防抖），再按文件名前缀过滤。纯浏览器
// 环境（无壳桥）返回空数组，@ 菜单随之无候选——显式降级面。

export interface AtEntry {
  name: string;
  path: string;
  isDir: boolean;
}

const DEBOUNCE_MS = 140;

export function useAtCandidates(query: string, wsPath: string | undefined): AtEntry[] {
  const [entries, setEntries] = useState<AtEntry[]>([]);
  const seqRef = useRef(0);

  const slash = query.lastIndexOf("/");
  const dirPart = slash >= 0 ? query.slice(0, slash + 1) : "";
  const namePart = (slash >= 0 ? query.slice(slash + 1) : query).toLowerCase();

  useEffect(() => {
    // 选中目录后插入的是绝对路径提及（formatMention），续层查询自带根 ——
    // 绝对查询直列该目录；相对查询才拼工作空间根。
    const basePath = !wsPath
      ? undefined
      : dirPart.startsWith("/")
        ? dirPart
        : `${wsPath}/${dirPart}`;
    if (!basePath) {
      setEntries([]);
      return;
    }
    const seq = ++seqRef.current;
    const timer = setTimeout(() => {
      void listDir(basePath).then((rows) => {
        if (seqRef.current === seq) setEntries(rows);
      });
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [wsPath, dirPart]);

  const filtered = entries.filter((e) => e.name.toLowerCase().startsWith(namePart));
  return filtered;
}
