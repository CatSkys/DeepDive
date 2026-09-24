# DSH 参考源码（已定位，勿再询问）

官方实现源码的移植对照图。以后移植 DSH UI 直接读源码，**不要自行发挥**。

- **唯一对照源：本仓库 vendored 副本** `deepseek-harness/`（根目录）——随仓库走，版本恒等于运行时引脚（`scripts/dsh-runtime-version.txt`；嵌入引擎时 `scripts/check-dsh-source.sh` 强校验。升引脚必须同步换源：用 GitHub `dsh-v<版本>` tag tarball 整目录替换）。
- 勿用本机 Downloads 散落副本对照（历史上曾 vendored 0.1.2-alpha.2 与引脚 0.1.1-rc.2 错位，造成 wire 契约误判）。

## 图标
- `packages/client/ui-primitives/src/icons/index.tsx`
  - 全部 ic_ds_* 图标（search/check/branch/copy/edit/think/browse/code/api/checklist/question…）
  - 移植时：函数体原样复制到 `frontend/src/components/Icons.tsx`，仅替换 IconProps 来源。

## 消息操作用户/尾部（消息下方的 meta 行）
- `packages/client/ui-chat/src/client/chat/MessageIconActions.tsx`
  - 用户消息：`clock="start"`（时钟在前）+ copy，**传 `onBranch` 才有分支**；用户消息不传 → 无分支。
  - assistant turn 尾部：`clock="end"`（时钟在后）+ copy + branch(可选) + usage(用时/首token/tok/s)。
- `packages/client/ui-chat/src/client/chat/MessageItem.tsx`
  - `UserMessageNodeView`：用户消息 actions（copy+clock start，无 branch）；消息容器挂 `data-time-hover-root`。
- `packages/client/ui-chat/src/client/chat/TurnTailNodeView.tsx`
  - turn 尾部 actions（copy+branch+clock end+usage），tail 根节点挂 `data-time-hover-root`。
- `packages/client/ui-chat/src/client/chat/MessageIconActions.module.css`
  - 官方 reveal 语义：图标常驻，`[data-time-hover-root]` 容器内 hover/focus-within 只显现时间/统计标签。
  - 本仓移植（用户定稿，有意偏离官方）：自建 `data-actions-reveal` 挂在轮容器 `.turn-group`（SessionView 分组层），按钮+Meta 全部 hover/focus-within 才显现，无 always 常驻（theme.css「meta actions」节）。
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

## 新增参考（Phase 2 移植锚点，2026-09-10 已全量落地）
- 消息反馈：**不移植**——DeepDive 没有反馈 UI，`packages/client/ui-message-feedback/` 与
  `packages/feedback/message-feedback/` 都不在组合里（连同 `/feedback` 命令与遥测一并移除，
  见 `engine/profile/cordis.patch.yml` 的移除清单）。
- 命令面：`packages/client/ui-commands/src/client/service.ts`（commands/list 驱动目录 + execute 整行派发；带参命令 claim、无参直发、未知命令拒收保草稿）→ SPA `composer/useSlashCommands.ts` + `commandLine.ts`。
- @ 候选：`packages/client/ui-reference/src/client/index.ts`（sessionReferenceResolver/candidates 消费）+ `packages/api/session-controller/src/file-references.ts`（fileReferences/list，本地实现 `file-reference-local`：cwd 亲和整库索引）→ SPA `useMentionCandidates.ts`。
