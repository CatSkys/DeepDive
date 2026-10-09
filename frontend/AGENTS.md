# frontend/AGENTS.md

自建 SPA（React + TS + Vite 单入口）。根规则见 [../AGENTS.md](../AGENTS.md)；本文件只放前端局部军令。

## 命令与门槛

```sh
npm run build   # tsc -b --noEmit && vite build —— 提交前必过
npm run test    # vitest run（事件回放/纯函数/api 信封），零失败
npm run lint    # eslint src，零报错
npm run dev     # 本地开发服（浏览器直接开；无壳桥时全部静默降级）
npm run gen     # 重新生成 packages/design/generated/tokens.css（改 tokens.json 后）
npx tsc --noEmit --noUnusedLocals --noUnusedParameters   # 死代码门槛，应为零错误
```

## 样式（theme.css 唯一事实源）

- 动样式或组件前先读 `docs/UI-SPEC.md §0`（外观、原则、不变式，含禁区 `.session-fade`）与 §1.1 的「明暗间刻意不变」清单。
- 颜色/圆角/间距用语义变量（`--ink`/`--line`/`--fill` 等，token 派生）；新增数值先查 `tokens.css` 有无现成变量。
- 圆角禁用 `999px` 级无穷值（WebKit 合成伪影，PITFALLS §1.1）；胶囊用高度值。
- backdrop-filter 必须带 `-webkit-` 双前缀，且只加在浮层白名单（PITFALLS §1.3）。
- 改完 CSS 用 `grep -c` 核对 dist 产物里选择器出现次数（未闭合粘连会吞规则，PITFALLS §1.4）。
- 删除组件时同步删其样式块；不留零引用类（死类扫描：类名在 tsx/ts 无 word 边界引用即删）。

## 契约面

- **RPC 全部走 `api.ts`**：dot-form endpoint + client-request 信封 + 扁平参数。新增方法先查引擎 `UNARY_ROUTES`（PITFALLS §4.6）；版本敏感面配 `probeMethod` 探测。
- **事件**：`types.ts` 可辨识联合；`session/renderModel.ts` 的 `ingest`/`finalizeTurns` 保持 O(1) 索引与"chunk 被 assistant/message 取代即丢弃"语义（PITFALLS §3.1-3.5）。
- **壳桥**：`host.ts` 是唯一通道（指令集见文件头）；新增前端→壳消息要在 `AppDelegate.handleHostMessage` 加 case，双向同步。
- **标题栏**：`titlebar.ts` rect 表与壳端 52px 条带是双端契约；改 `.window-top`/`.session-header` 顶层布局后必须实测"按钮可点 + 空白可拖"（PITFALLS §4.3）。
- **文案**：用户可见文本一律 `t()`/`tt()`（`i18n.ts` 词典，中英成对）；JSX 不写裸中文。

## 组件纪律

- 用户消息与 Agent 消息是两套独立组件/规则（`UserBubble`/`AgentMessage`），禁止共用容器改子类（UI-SPEC §2.2）。
- 流式性能：历史消息靠 `Markdown` memo 跳过重渲；勿在 render 路径新增全量 reconcile。
- 空状态/加载态用现成 `HeroBrand`/`LoadingState`/`ThinkingState`，勿另起炉灶。

## 依赖与素材

- 新增依赖/素材先过根 `AGENTS.md` 铁律 7（是否主流、是否必要）；资产类依赖同样要能说清许可。
- 语言/文件图标来自 `material-icon-theme`（MIT，Copyright (c) 2025 Material Extensions）：只在
  `session/FileIcon.tsx` 逐名 `?raw` 内联（与 `ProviderIcon` 同一条通道），许可原文在
  `node_modules/material-icon-theme/LICENSE`。
- **MIT 要求分发时随附许可，而本应用目前没有「第三方许可」展示面**——把包发给他人前得先落实落点。
