// 崩溃自愈守卫：React #185（Maximum update depth exceeded）从调度器抛出，
// **不经过错误边界**——整树卸载后用户看到的就是一块不响应的黑玻璃（2026-10-11
// 实测，交付前的旧 bundle 亦犯：预存循环，根因未明）。这里在 window.error 上
// 拦它：15s 窗内至多自动重载一次（sessionStorage 守卫防重载风暴）；窗口期内
// 再犯就写一条裸 DOM 提示——此刻 React 已死，别指望组件渲染，把重载留给用户。
// 重载的代价与 mux.recycle 同源：各流重发快照、消费方全量替换，草稿在
// localStorage 里不丢。根因定位后此守卫保留（正常路径零开销）。
const RELOAD_KEY = "deepdive.crashreload";
const RELOAD_WINDOW_MS = 15_000;

function isMaxUpdateDepth(message: string): boolean {
  return message.includes("#185") || message.includes("Maximum update depth");
}

function showBareNote(): void {
  if (document.getElementById("crash-note")) return;
  const note = document.createElement("div");
  note.id = "crash-note";
  note.textContent = "界面遇到循环更新问题已停止工作，请手动重载（⌘R）。";
  note.style.cssText =
    "position:fixed;left:0;right:0;bottom:38%;text-align:center;color:var(--ink-3,#888);font:13px -apple-system,sans-serif;";
  document.body.appendChild(note);
}

export function installCrashGuard(): void {
  window.addEventListener("error", (e) => {
    if (!isMaxUpdateDepth(String(e.message ?? ""))) return;
    // 先上报后重载：fetch 在卸载时会被掐掉，beacon 不挑时机——#185 的现场栈
    // 只有这里能送出去（错误边界接不住调度器抛的这类错）。
    try {
      navigator.sendBeacon("/__deepdive_error", "[crashguard] " + String(e.message ?? "") + "\n" + String(e.error?.stack ?? ""));
    } catch { /* beacon 不可用时放弃上报，重载不受影响 */ }
    const now = Date.now();
    const last = Number(sessionStorage.getItem(RELOAD_KEY) ?? 0);
    if (now - last < RELOAD_WINDOW_MS) {
      showBareNote();
      return;
    }
    sessionStorage.setItem(RELOAD_KEY, String(now));
    window.location.reload();
  });
}
