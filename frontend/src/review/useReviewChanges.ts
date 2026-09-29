// 审查面板的取数：改动清单一次拉全，单文件 diff 懒取（展开谁取谁）。
// 刷新是 revision 计数 + 整份丢弃旧缓存——用键带 revision 的写法不如直接换一
// 份 store 干净，也免得旧响应在新一轮里落地。只管取数与缓存，不管渲染。

import { useCallback, useEffect, useRef, useState } from "react";
import { gitChanges, gitDiff } from "../host";
import type { ReviewChange, ReviewDiff } from "./types";

/** 一轮的 diff 缓存。整份换掉而不是清空，是为了让飞行中的旧请求写进废纸堆。 */
interface DiffStore {
  cache: Map<string, ReviewDiff>;
  pending: Set<string>;
}

export interface ReviewController {
  /** 清单在途（首拉与刷新共用这一个态）。 */
  loading: boolean;
  /** 非 git 仓库 / git 不可用 / 超时 —— 面板按"没有 git 数据"呈现，不报错。 */
  available: boolean;
  branch: string;
  files: ReviewChange[];
  /** 手动刷新（面板顶栏的 ⟳）。 */
  refresh: () => void;
  /** 刷新轮次：每刷新一次 +1。已展开的行把它列入 effect 依赖，
   *  缓存随刷新整份换掉后才会重新去取。 */
  revision: number;
  /** 已取到的 diff；未取为 undefined。 */
  diff: (path: string) => ReviewDiff | undefined;
  /** 该文件正在取。 */
  fetching: (path: string) => boolean;
  /** 请求某个文件的 diff（重复调用无副作用）。 */
  request: (path: string) => void;
}

export function useReviewChanges(wsPath: string | undefined): ReviewController {
  const [revision, setRevision] = useState(0);
  const [state, setState] = useState<{ loading: boolean; available: boolean; branch: string; files: ReviewChange[] }>({
    loading: false, available: false, branch: "", files: [],
  });
  // diff 落在 ref 里（不进 state：一次改动是一张 Map，不适合做 state 值），
  // 所以取回后要 bump 一下让订阅者重渲——ref 变了 React 不会自己知道。
  const [, bump] = useState(0);
  const store = useRef<DiffStore>({ cache: new Map(), pending: new Set() });

  useEffect(() => {
    if (!wsPath) return;
    let alive = true;
    store.current = { cache: new Map(), pending: new Set() };
    setState((s) => ({ ...s, loading: true }));
    void gitChanges(wsPath).then((r) => {
      if (!alive) return;
      setState({ loading: false, available: r.repo, branch: r.branch, files: r.files });
    });
    return () => { alive = false; };
  }, [wsPath, revision]);

  const request = useCallback((path: string) => {
    if (!wsPath) return;
    const s = store.current;
    if (s.cache.has(path) || s.pending.has(path)) return;
    s.pending.add(path);
    bump((n) => n + 1); // 请求发出：pending 置位，行要立刻转成载入态
    void gitDiff(wsPath, path).then((d) => {
      s.pending.delete(path);
      s.cache.set(path, d);
      bump((n) => n + 1);
    });
  }, [wsPath]);

  const diff = useCallback((path: string) => store.current.cache.get(path), []);
  const fetching = useCallback((path: string) => store.current.pending.has(path), []);
  const refresh = useCallback(() => setRevision((r) => r + 1), []);

  return { ...state, revision, refresh, diff, fetching, request };
}
