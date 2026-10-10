# engine/ — DeepDive 自有引擎

本目录是 DeepDive 的引擎源码：以 dsh 内核（MIT，`deepseek-harness/` 为对照副本）为起点
的 fork，加 DeepDive 自己的插件与组合。目标形态见 `docs/ARCHITECTURE.md §5`——
**产品的一切都是插件，Swift 只做 OS 能力与进程监督**。

## 目录

```
apps/cli/            @deepseek-ai/dsh 本体（bin: lib/bin.js，spawn 入口）
packages/            dsh 内核包（agent-loop / session / tools / llm / typert / api …）
vendor/              Cordis 框架层（cordis / loader / include / schemastery …，MIT）
apps/web/            官方前端产物的运行时形态（package.json + dist；web-app 硬性
                     require.resolve 它——DeepDive 不用其页面，桥自伺服 SPA）
profile/             DeepDive 的引擎组合（唯一事实源，宿主树）
scripts/             collect-engine-closure.mjs（闭包收集，DeepDive 侧脚本在
                     仓库 scripts/ 下，这里只有上游自带的）
```

`deepseek-harness/` 与本目录的关系：**上游对照副本 vs 本仓实体**。升引脚 = 同步
`deepseek-harness/` 后重跑 `scripts/sync-engine-fork.mjs`（逐字覆盖 + 重放本仓补丁），
再过两道对等闸门（见下）。fork 是逐字复制、未改名（`@deepseek-ai/*` 保持原样）：
改名触及全部 manifest 与 import，无行为收益，后续需要时再做。

## 构建与产物

```sh
pnpm --dir engine install          # 首次；之后增量
bash scripts/build-engine.sh       # 双面构建 → 原生 flock 编译 → 闭包收集 → validate_runtime → prompt 冒烟
```

产物 `dist/.dsh-engine-build/<pin>/`，形状与 npm 闭包完全一致
（`package.json` + `lib/bin.js` + 扁平 `node_modules`），因此
`prepare-dsh-runtime.sh --validate`、`smoke-engine-boot.sh`、`embed-engine.sh`
原样可用。嵌入应用：`bash scripts/build-release.sh`（默认嵌自有引擎；`DEEPDIVE_ENGINE_SOURCE=npm` 回退闭包轨——回退轨下产品面 RPC 不可用，仅对照）。

`@earendil-works/pi-ai` 是 fork 自己的依赖决策（2026-10-10 起 1.1.0），不随
dsh 引脚走；模型目录随它自带生成数据层，不再有数据覆盖层。

## 三道对等闸门

每次改动引擎源码或同步上游后必须全绿（后两道已接入 `build-engine.sh` 尾部，构建即验）：

1. **启动**：`scripts/smoke-engine-boot.sh dist/.dsh-engine-build/<pin> engine/profile`
   ——真起一次到 `dsh web:` 就绪行。
2. **消息可落**：`scripts/smoke-engine-prompt.sh <产物> engine/profile`
   ——create + prompt + 断言提交文本回录进 turnOutline。readiness 不证明消息能落：
   2026-09-28 闭包缺 flock 原生产物时 boot 全绿但发消息全空（PITFALLS §4.34）。
3. **组合等价**：`scripts/dump-engine-composition.sh --runtime <产物> --local-bundle
   engine/profile --bundles deepdive-engine-profile` 与
   `engine/profile/composition.expected.txt` 逐字节 diff 为零。

## 与上游的已知偏差

- `vitest.config.ts`：上游那套 harness（root 配置 + 各 lane 配置 + coverage 分区脚本）
  **没有**随 `sync-engine-fork.mjs` 进本仓，本仓只有一份最小配置，够跑包级 spec。
  没有它，带 `@Remote` 的 spec 一条用例都跑不起来——Vite/esbuild 不降级标准装饰器，
  装饰器原样进 V8 就是 `SyntaxError`（症状是「0 test / Failed Suites 1」，看着像加载
  失败而不是断言失败）。用法：`cd engine && node node_modules/vitest/vitest.mjs run <spec>`。
  `vitest.shared.ts` 是上游逐字副本，已列进同步脚本的文件清单，勿手工编辑。
  上游的 coverage 门与平台排除表没带进来：fork 自己的合入判据仍是上面三道闸门，
  这批 spec 是写代码时的自检工具。
- `tsconfig.host.json` / `tsconfig.client.json`：由
  `scripts/gen-engine-host-include.mjs` / `gen-engine-client-config.mjs` 从上游
  原件生成——**逐条保留、只删本 fork 不存在的路径**（apps/desktop、apps/web 源码、
  docs-site gate 族），client 面额外带上 vendor 目录引用（与 host 面同模式，使
  vendor 以项目引用被消费而非以源码进入 program）。不要手工编辑这两个文件。
- `apps/web/` 只含 `package.json + dist/`（取自 npm 闭包的引脚产物）：web-app 运行
  时 require.resolve 它，但 DeepDive 从不请求其页面。源码与 vite 构建链未 fork。
- 仓库级 gate 脚本（`scripts/`）随上游复制但不在 host 类型检查内
  （`gen-engine-host-include.mjs` 的 FORCE_DROP 清单）；website/ 仅保留被 import
  的 `docs.ts`。
- `pnpm install`（engine/ 内）的 lefthook postinstall 会在 **git 根**落一份全注释的
  `lefthook.yml` 示例（上游脚本的副作用，无活动钩子）——出现即删，别提交。
- 第三方依赖版本与 npm 发布闭包**有意不同**（fork 快照按 vendored lockfile 冻结解析，
  与发布那一刻的 resolution 存在约 74 个包的漂移；引擎自有代码两侧逐字节一致）。等价性
  不靠版本号一致保证，靠上面三道闸门保证——升级引脚后若闸门红，按闸门报错裁决。

## 本仓对引擎的改动纪律

改引擎代码 = 改本目录源码 + `bash scripts/build-engine.sh` + 两道闸门 + 
默认嵌自有引擎，走完整交付链。组合改动仍走 `engine/profile/`
（README 见该目录），组合闸门不变。
