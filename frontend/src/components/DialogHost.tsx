// 应用风格 confirm/alert/prompt 弹窗（DialogHost + Promise API，替换
// window.confirm/alert/prompt 系统原生弹窗——原生弹窗无法走应用玻璃风格，
// 且在 WKWebView 里样式割裂）。模块级请求队列：任何地方 import { confirm
// Dialog, alertDialog, promptDialog } 发请求；App 根部挂一次 <DialogHost />
// 消费，串行显示（并发请求排队）。样式走 theme.css 的 .dialog-* 语义类
//（与设置弹窗同一玻璃配方）。
import { useEffect, useRef, useState } from "react";
import { useT } from "../i18n";

export interface DialogOptions {
  /** 正文（可多行，\n 保留） */
  message: string;
  title?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** 危险操作：确认按钮标红（语义色 --dsh-signal-danger）。 */
  danger?: boolean;
}

export interface PromptOptions {
  /** 输入框上方的标签（必填——纯输入弹窗没有标题会没有语义） */
  title: string;
  initialValue?: string;
  placeholder?: string;
  confirmLabel?: string;
}

interface DialogRequest {
  kind: "confirm" | "alert" | "prompt";
  opts: Partial<DialogOptions> & Partial<PromptOptions>;
  resolve: (v: boolean | string | null) => void;
}

let dispatch: ((req: DialogRequest) => void) | null = null;
const queue: DialogRequest[] = [];

function request(kind: DialogRequest["kind"], opts: Partial<DialogOptions> & Partial<PromptOptions>): Promise<boolean | string | null> {
  return new Promise((resolve) => {
    const req: DialogRequest = { kind, opts, resolve };
    if (dispatch) dispatch(req);
    else queue.push(req); // Host 未挂载（极端时序）：排队等挂载后消费
  });
}

/** 应用风格确认框：resolve true = 确认，false = 取消/Escape/点空白。 */
export function confirmDialog(opts: DialogOptions): Promise<boolean> {
  return request("confirm", opts).then((v) => v === true);
}

/** 应用风格提示框：单按钮，resolve 即关闭。 */
export function alertDialog(opts: DialogOptions): Promise<void> {
  return request("alert", opts).then(() => undefined);
}

/** 应用风格输入框（替代 window.prompt）：resolve 输入原文，取消/Escape 为 null。 */
export function promptDialog(opts: PromptOptions): Promise<string | null> {
  return request("prompt", opts).then((v) => (typeof v === "string" ? v : null));
}

export function DialogHost() {
  const { t } = useT();
  const [req, setReq] = useState<DialogRequest | null>(null);
  // prompt 输入值：请求切换时回填 initialValue（key=req 引用驱动重挂）
  const [text, setText] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    dispatch = setReq;
    if (queue.length > 0) setReq(queue.shift()!);
    return () => { dispatch = null; };
  }, []);

  useEffect(() => {
    if (req?.kind === "prompt") {
      setText(req.opts.initialValue ?? "");
      // 拉起即选中默认文本：重命名场景直接输入即整体替换（同 window.prompt 习惯）
      inputRef.current?.select();
    }
  }, [req]);

  if (!req) return null;
  const isAlert = req.kind === "alert";
  const isPrompt = req.kind === "prompt";
  const settle = (v: boolean | string | null) => {
    req.resolve(v);
    setReq(queue.shift() ?? null);
  };
  const cancel = () => settle(isAlert ? true : isPrompt ? null : false);
  const confirm = () => settle(isPrompt ? text : true);

  return (
    <div className="dialog-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) cancel(); }}>
      <div className="dialog-card" role={isAlert ? "alertdialog" : "dialog"} aria-modal="true"
        onKeyDown={(e) => {
          if (e.key === "Escape") cancel();
          if (e.key === "Enter" && isPrompt) confirm();
        }}>
        {req.opts.title && <div className="dialog-title">{req.opts.title}</div>}
        {req.opts.message && <div className="dialog-msg">{req.opts.message}</div>}
        {isPrompt && (
          <input
            ref={inputRef}
            className="dialog-input"
            autoFocus
            value={text}
            placeholder={req.opts.placeholder}
            onChange={(e) => setText(e.target.value)}
          />
        )}
        <div className="dialog-actions">
          {!isAlert && (
            <button type="button" className="dialog-btn" onClick={() => cancel()}>
              {req.opts.cancelLabel ?? t("取消")}
            </button>
          )}
          <button
            type="button"
            autoFocus={!isPrompt}
            className={`dialog-btn primary${req.opts.danger ? " danger" : ""}`}
            onClick={confirm}
          >
            {req.opts.confirmLabel ?? (isAlert ? t("好") : t("确定"))}
          </button>
        </div>
      </div>
    </div>
  );
}
