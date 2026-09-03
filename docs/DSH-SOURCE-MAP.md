# DSH 参考源码（已定位，勿再询问）

官方实现源码的移植对照图。以后移植 DSH UI 直接读源码，**不要自行发挥**。

- **首选：本仓库 vendored 副本** `deepseek-harness-master/`（根目录）——随仓库走、与运行时引脚同版（`scripts/dsh-runtime-version.txt`）。
- 备选（同结构）：`/Users/hanbyking/Downloads/deepseek-harness-master`（本地下载目录，版本可能不同）。

## 图标
- `packages/client/ui-primitives/src/icons/index.tsx`
  - 全部 ic_ds_* 图标（search/check/branch/copy/edit/think/browse/code/api/checklist/question…）
  - 移植时：函数体原样复制到 `frontend/src/components/Icons.tsx`，仅替换 IconProps 来源。

## 消息操作用户/尾部（消息下方的 meta 行）
- `packages/client/ui-chat/src/client/chat/MessageIconActions.tsx`
  - 用户消息：`clock="start"`（时钟在前）+ copy，**传 `onBranch` 才有分支**；用户消息不传 → 无分支。
  - assistant turn 尾部：`clock="end"`（时钟在后）+ copy + branch(可选) + usage(用时/首token/tok/s)。
- `packages/client/ui-chat/src/client/chat/MessageItem.tsx`
  - `UserMessageNodeView`：用户消息 actions（copy+clock start，无 branch）；`data-actions-reveal` 由 `isLatestUserRow` 决定 `always|hover`。
- `packages/client/ui-chat/src/client/chat/TurnTailNodeView.tsx`
  - turn 尾部 actions（copy+branch+clock end+usage），`data-actions-reveal={isLatestTurn ? 'always' : 'hover'}`。
- `packages/client/ui-chat/src/client/chat/MessageIconActions.module.css`
  - 官方 reveal 语义：`[data-actions-reveal='hover'] .actions {opacity:0}`，hover/focus-within 显示；latest='always' 常驻。
- `packages/client/ui-chat/src/client/chat/MessageItem.module.css`
  - 用户 row 右对齐：`.userRow{display:flex;flex-direction:column;align-items:flex-end;gap:6px}`（气泡+actions 同列右对齐）。
- `packages/client/ui-chat/src/client/chat/ReasoningRow.module.css`
  - Think 行样式；`data-state='running'` 时扫光动画 `dsh-reasoning-row-sweep`。

## 工具行（bash / todo / read / search / edit 等）
- `packages/client/ui-tool/src/client/tool/toolviews/GenericToolCard.tsx`
  - `VARIANT_ICONS`：search→IconSearchOutline16, read→IconBrowseOutline16, bash→IconApiOutline14, write/edit→IconEditOutline16, code→IconCodeOutline16。
  - `toolRowModel()`：variant/state(summary 推导)。
- `packages/client/ui-tool/src/client/tool/toolviews/todo-row.tsx`
  - 任务行：`IconChecklistOutline14`、`title=todo.rowTitle`（"任务"）、summary=`{done}/{total} 已完成 · {active} 进行中 · {pending} 待处理`。
- `packages/client/ui-tool/src/client/tool/toolviews/read-row.tsx`、`search-row.tsx`、`web-row.tsx`、`file-mutation-row.tsx`、`ask-question-row.tsx`

## 产物（ProducedFiles）
- `packages/client/ui-deliverables/src/client/ProducedFiles.tsx`
  - label=`产物`、`SHOWN_LIMIT=6`、more=`+ {n} 个文件`、file chip 样式。

## 任务（TodoRow）
- `packages/client/ui-tool/src/client/tool/toolviews/todo-row.tsx`（summary/planSummary 逻辑）

## Plan 模式
- `packages/client/ui-plan/src/client/PlanModeControl.tsx`
  - `PlanChip`：读取 `plan` projection（`active`/`pending`），激活时显示 `Plan` chip。
