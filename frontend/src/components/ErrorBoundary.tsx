// 顶层错误边界：渲染树崩了给一块可恢复的面板，而不是整树卸载后的纯黑窗
// （2026-10-11 实测：React #185 同步 setState 循环把整树卸了，用户看到的就是
// 一块不响应的黑玻璃）。catch 到的错连同**组件栈**经 console.error 交给壳——
// 壳把 webview 的 console error 记进 engine.log（[web] 行），线上偶发崩溃由此
// 可定位；componentStack 在生产构建同样有效。
import { Component, type ErrorInfo, type ReactNode } from "react";
import { t } from "../i18n";

interface Props { children: ReactNode; }
interface State { error: Error | null; }

export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    // 走 index.html 内联上报器的同一条通道（壳 /__deepdive_error → engine.log
    // [web] 行）：边界接住的错误**不经过** window.onerror，不上报就谁也看不见
    // ——线上崩溃的组件栈全靠这里。componentStack 生产构建同样有效。
    const body =
      "[crash-boundary] " + (error.stack ?? String(error))
      + "\n--- component stack ---" + (info.componentStack ?? "");
    fetch("/__deepdive_error", { method: "POST", body }).catch(() => {});
  }

  override render(): ReactNode {
    if (this.state.error === null) return this.props.children;
    return (
      <div className="crash-boundary" role="alert">
        <p className="crash-boundary-title">{t("界面出了点问题，已自动记录")}</p>
        <button type="button" className="crash-boundary-reload" onClick={() => window.location.reload()}>
          {t("重载界面")}
        </button>
      </div>
    );
  }
}
