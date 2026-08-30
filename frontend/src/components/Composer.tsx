import { useRef, useState } from "react";
import { ArrowUp, RotateCcw } from "lucide-react";
import { api } from "../api";
import { useStore } from "../store";

export function Composer({ sessionId, onSent }: { sessionId: string | null; onSent?: () => void }) {
  const [text, setText] = useState("");
  const ref = useRef<HTMLTextAreaElement>(null);
  const store = useStore();

  const submit = async () => {
    const value = text.trim();
    if (!value) return;
    if (sessionId === null) {
      const create = await store.createSession();
      if (!create) return;
      await api.prompt({ sessionId: create, mode: "queue", content: [{ type: "text", text: value }] });
    } else {
      try {
        await api.prompt({ sessionId, mode: "queue", content: [{ type: "text", text: value }] });
      } catch {
        // engine may still be booting; keep the draft
        return;
      }
    }
    setText("");
    onSent?.();
  };

  const autoGrow = (el: HTMLTextAreaElement) => {
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 160) + "px";
  };

  return (
    <div className="composer">
      <button className="round-btn" title="重置">
        <RotateCcw size={15} />
      </button>
      <textarea
        ref={ref}
        placeholder="输入任务，@ 引用 · / 命令"
        rows={1}
        value={text}
        onChange={(e) => { setText(e.target.value); autoGrow(e.target); }}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            void submit();
          }
        }}
      />
      <button
        className="send-btn"
        disabled={!text.trim()}
        onClick={() => void submit()}
        title="发送"
      >
        <ArrowUp size={15} />
      </button>
    </div>
  );
}
