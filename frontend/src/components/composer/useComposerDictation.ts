// 听写 hook：订阅壳端 SFSpeechRecognizer 事件并持有开关状态——partial 由
// 编排方进占位文案，final 拼接进草稿。不管麦克风按钮与占位文案的渲染。

import { useEffect, useState } from "react";
import { onHostEvent, sendToShell } from "../../host";
import { t as globalT } from "../../i18n";
import { DD_EVENTS } from "../../events";
import { alertDialog } from "../DialogHost";

export function useComposerDictation({
  setText,
  refocus,
}: {
  setText: React.Dispatch<React.SetStateAction<string>>;
  /** final 落稿后回焦 textarea 并按新内容重新长高。 */
  refocus: () => void;
}) {
  // 听写（壳端 SFSpeechRecognizer）：partial 进 placeholder，final 落入草稿。
  const [listening, setListening] = useState(false);
  const [partial, setPartial] = useState("");

  // 听写事件：partial 进占位文案；final 拼接到草稿末尾；error 弹提示。
  // 模块级 globalT 读最新 currentLang（useT 的闭包随渲染重建，订阅只挂一次）。
  useEffect(() => onHostEvent((cmd, payload) => {
    const text = (payload as { text?: string } | undefined)?.text ?? "";
    if (cmd === "dictation-partial") {
      setListening(true);
      setPartial(text);
    } else if (cmd === "dictation-final") {
      setListening(false);
      setPartial("");
      setText((current) => (current.trim() ? `${current.trimEnd()} ${text}`.trim() : text));
      refocus();
    } else if (cmd === "dictation-error") {
      setListening(false);
      setPartial("");
      void alertDialog({ message: text || globalT("听写失败") });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- 订阅只挂一次：setText 为 setState 稳定引用，refocus 仅触达稳定 taRef（拖拽订阅同款）
  }), []);

  const toggleDictation = () => {
    if (listening) {
      sendToShell({ type: "dictation-stop" });
      setListening(false);
      setPartial("");
    } else {
      setPartial("");
      setListening(true);
      sendToShell({ type: "dictation-start" });
    }
  };

  // 听写快捷键（快捷键页可改）：热键经全局事件转到本组件，状态机单一。
  useEffect(() => {
    const onToggle = () => toggleDictation();
    window.addEventListener(DD_EVENTS.dictationToggle, onToggle);
    return () => window.removeEventListener(DD_EVENTS.dictationToggle, onToggle);
  });

  return { listening, partial, toggleDictation };
}
