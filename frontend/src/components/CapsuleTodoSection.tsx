// 状态胶囊的「任务与计划」区。长清单只留进行中 + 前几项未完成、其余折成计数行，
// 短清单（≤ TODO_COMPACT_THRESHOLD）连已完成一起内联——做过什么本身就是信息，
// 短清单还收起来要多点一次。
// 两个开合标记是**本区自己的**状态：放在这里，面板就不必为它多担一份状态。
import { useState } from "react";
import { ArrowRight, ChevronDown, Circle, CircleCheck, ListTodo } from "lucide-react";
import { t, tt } from "../i18n";
import { todoView, type CapsuleTodo } from "./capsuleModel";

export function CapsuleTodoSection({ todos }: { todos: CapsuleTodo[] | null | undefined }) {
  const [showDone, setShowDone] = useState(false);
  const [showAllPending, setShowAllPending] = useState(false);
  const todo = todoView(todos);
  if (todo.total === 0) return null;
  return (
    <div className="capsule-sec">
      <div className="capsule-sec-name">
        <ListTodo size={12} />{t("任务与计划")}
        {/* 区名右侧的进度：与胶囊 pill 同一个数（已完成/总数） */}
        <span className="capsule-sec-count">{todo.done}/{todo.total}</span>
      </div>
      {todo.active && (
        <div className="capsule-row">
          <ArrowRight size={13} />
          <span className="capsule-row-text">{todo.active.content}</span>
        </div>
      )}
      {(showAllPending ? [...todo.pending, ...todo.pendingHidden] : todo.pending).map((p) => (
        <div key={p.content} className="capsule-row">
          <Circle size={12} />
          <span className="capsule-row-text">{p.content}</span>
        </div>
      ))}
      {/* 被窗口折掉的未完成项：点击可全部摊开，不丢信息 */}
      {todo.pendingHidden.length > 0 && (
        <button type="button" className="capsule-sec-toggle" onClick={() => setShowAllPending((v) => !v)}>
          <ChevronDown size={12} style={showAllPending ? undefined : { transform: "rotate(-90deg)" }} />
          {showAllPending
            ? tt("收起未完成项", "Collapse pending")
            : tt("展开其余 {n} 项未完成", "{n} more pending", { n: todo.pendingHidden.length })}
        </button>
      )}
      {todo.completed.length > 0 && (todo.listCompleted ? (
        todo.completed.map((c) => (
          <div key={c.content} className="capsule-row">
            <CircleCheck size={13} className="capsule-check" />
            <span className="capsule-row-text capsule-row-done">{c.content}</span>
          </div>
        ))
      ) : (
        <>
          <button type="button" className="capsule-sec-toggle" onClick={() => setShowDone((v) => !v)}>
            <ChevronDown size={12} style={showDone ? undefined : { transform: "rotate(-90deg)" }} />
            {tt("已完成 {n} 项", "Completed {n}", { n: todo.completed.length })}
          </button>
          {showDone && todo.completed.map((c) => (
            <div key={c.content} className="capsule-row">
              <CircleCheck size={13} className="capsule-check" />
              <span className="capsule-row-text capsule-row-done">{c.content}</span>
            </div>
          ))}
        </>
      ))}
    </div>
  );
}
