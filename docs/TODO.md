# DeepDive 路线待办

> 产品路线的唯一事实源：一项一节，只写「要做什么 + 已查明的路径」；完成即删节（沿革归 git）。分发与生态是当前评分短板（2026-09-05 review），以下按优先级排序。

## 0. 0.1.2-rc.1 引擎新特性移植（Phase 2，2026-09-09 升级解锁）

引擎已升 0.1.2-rc.1（见 `DSH-WIRE.md`），四个新面实测可达、按价值排序：

1. **消息反馈 UI**：`messageFeedback/list|put|delete`（`request` 包裹；put 为
   `{sessionId, messageId, rating:'positive'|'negative', note?, ifVersion}` CAS）——
   消息操作行 👍/👎 + 已反馈态，对照官方 `packages/client/ui-message-feedback`。
2. **命令原生化**：`commands/list {agentId}` + `commands/execute {agentId, line,
   images}`（整行斜杠命令直发）——替代 `commands.ts` 静态目录与 `/goal` 客户端
   派发；`session/prompt` 的 `command` 槽位语义随命令引擎走。
3. **Turn 大纲轨**：`turnOutline` 投影已在（follow 快照 15 键之一）+ `session/
   page` 深分页——对照官方 `ui-chat` turn rail 移植会话内导航。
4. **@ 候选原生化**：`sessionReferenceResolver/candidates` 替代壳侧 list-dir
   候选（需评估与 FileManager 路径体验差异再动）。

另：`pluginInventory/list` 已可达，插件市场（§1）的发现面可改走引擎清单。

## 1. 插件市场

引擎侧插件装进 profile 即生效（壳已有 `--patch` overlay 与成熟的引擎重启流）。市场按「发现在前端、安装在壳侧」分工自建：SPA 市场页实时抓 GitHub topic `dsh-plugin` 做搜索与排序；安装走壳侧 暂存 → 校验 → 原子写 profile 依赖 → 提示重启引擎。参考 [ouyangyipeng/dsh-marketplace](https://github.com/ouyangyipeng/dsh-marketplace)（市场即插件，DS-Harness Desktop v0.2.0 起内置其固定版）。

约束（评估时已核实）：安装必须走壳侧（wire 面无插件安装/卸载 RPC，`pluginInventory/list` 只读）；SPA 不挂官方 slots，官方插件 UI 半侧在 DeepDive 无处落地，只接引擎侧插件。红线：安装不执行脚本（`--ignore-scripts` 等价语义）、不自动更新、安装前展示源码仓库与权限面——引擎沙箱不是安全边界，进程内插件视同 bash 权限。

## 2. 自动更新

Sparkle：appcast + EdDSA 签名 + 增量更新。公证链路就绪后接入（公证见 `scripts/package-macos.sh` 的 `DSHMINI_NOTARY_PROFILE`）；发布仍本地打包（CI 无签名凭据）。

## 3. 手机远程

iOS/Android 远程连接引擎：发起任务、查看进度、收通知。前提：引擎桥目前仅回环 + Origin scheme/host/port 全等校验（PITFALLS §4.5），开放非回环访问前先设计鉴权面（配对码或隧道），LAN 模式无鉴权是被 dsh-desktop 明文警告的反面教材。

## 4. 自动化页面

用户提出的方向，具体范围待澄清；启动前先补一页 SPEC（对齐 `docs/` 现状态写作约定）再动工。
