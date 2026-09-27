// 浏览器设置页「登录态」分节的壳侧数据：从本机其它浏览器导入 cookie（壳读完写进浏览器自己的
// store），以及清除浏览数据。
//
// 与壳的报文：发 `browser-cookies`（action: sources | import | clear），
// 收 `browserCookieSources`（来源清单）与 `browserCookieResult`（一次导入/清除的结果码 + 条数）。
// 结果只给**码**，文案在 SPA（壳不产出给人看的句子）。
import { useCallback, useEffect, useState } from "react";
import { onHostEvent, sendToShell } from "../host";

export interface CookieSourceFace {
  id: string;
  name: string;
  /** 数据目录列不出来（被系统挡着）：先说清楚，别等人点了导入才报错 */
  blocked?: boolean;
}

/** 一次导入/清除的结果。`code` 见壳侧 BrowserCookieImport.Code（多一个 cleared 给清除用）。 */
export interface CookieResultFace {
  source: string;
  code: string;
  total: number;
  imported: number;
}

export function useBrowserCookies() {
  const [sources, setSources] = useState<CookieSourceFace[]>([]);
  const [result, setResult] = useState<CookieResultFace | null>(null);
  /** 正在跑的活：某个来源 id，或 "clear"；空串 = 没有 */
  const [busy, setBusy] = useState("");
  const [loading, setLoading] = useState(false);
  const [hasScanned, setHasScanned] = useState(false);

  useEffect(() => onHostEvent((cmd, payload) => {
    if (cmd === "browserCookieSources") {
      const list = (payload as { sources?: CookieSourceFace[] } | undefined)?.sources;
      setSources(Array.isArray(list) ? list : []);
      setLoading(false);
      setHasScanned(true);
      return;
    }
    if (cmd === "browserCookieResult") {
      const data = payload as Partial<CookieResultFace> | undefined;
      setResult({
        source: typeof data?.source === "string" ? data.source : "",
        code: typeof data?.code === "string" ? data.code : "empty",
        total: Number(data?.total ?? 0),
        imported: Number(data?.imported ?? 0),
      });
      setBusy("");
    }
  }), []);

  const scan = useCallback(() => {
    setLoading(true);
    sendToShell({ type: "browser-cookies", action: "sources" });
  }, []);
  const refresh = scan;
  const importFrom = useCallback((id: string) => {
    setBusy(id);
    setResult(null);
    sendToShell({ type: "browser-cookies", action: "import", source: id });
  }, []);
  const clear = useCallback(() => {
    setBusy("clear");
    setResult(null);
    sendToShell({ type: "browser-cookies", action: "clear" });
  }, []);

  return { sources, result, busy, loading, hasScanned, scan, refresh, importFrom, clear };
}
