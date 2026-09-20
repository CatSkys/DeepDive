# engine-model-data — 引擎内嵌 pi-ai 模型目录数据层覆盖

## 是什么

`@earendil-works/pi-ai` 的**生成数据层**快照（纯数据，无任何可执行代码改动），
来源 `pi-ai@0.86.1` 的 dist 产物：

- `models.generated.js` — 聊天模型目录聚合器（`export const MODELS`）
- `image-models.generated.js` — 图片模型目录（`export const IMAGE_MODELS`）
- `providers/*.models.js` — 各提供方模型字面量（聚合器按文件名逐个 import，
  缺一个整个 pi-ai 在 require 时崩溃）
- `providers/data/` — 上述目录的生成源 JSON（运行时不读，随附保持一致，
  避免与 models.js 出现两套"事实"）

## 为什么存在

`scripts/dsh-runtime-version.txt` 引脚的引擎自带**它发布当天**的 pi-ai 目录
（0.1.5-rc.1 → pi-ai 0.85.1，目录生成于 2026-09-05），提供方模型清单（模型菜单）
在引脚不动期间会持续过时；而配置层无法补齐（`llm-pi-ai.providers.<id>.models`
整体替换目录，且混合协议路由下配置新增陌生 id 会让整个路由解析失败——
`dsh-llm-pi-ai` catalog 的 `sharedCatalogApi` 约束）。嵌入时由
`scripts/patch-engine-model-data.sh` 把本目录覆盖进 bundle 内的 pi-ai dist，
使所有提供方目录与上游最新生成数据一致，引擎引脚保持不动。

注意：pi-ai 的目录数据**只在它自己发版时**刷新（0.86.1 与 0.85.1 是同年同月的
两个发布，数据层的差别就是本快照的全部内容），所以"上游发新版"不等于"数据更新"，
更新前先比 `providers/data/`（见下）。

## 生命周期

`patch-engine-model-data.sh` 带版本闸：运行时 pi-ai ≥ `0.86.1` 时自动跳过。
**引擎引脚升到自带 pi-ai ≥ 0.86.1 的版本后，删除本目录**，勿再手维护。

## 更新快照

```sh
npm pack @earendil-works/pi-ai@<新版>
tar xzf earendil-works-pi-ai-<新版>.tgz
# 先比数据层再决定要不要覆盖：新版可能只动了代码
diff -r <旧版>/dist/providers/data package/dist/providers/data
cp package/dist/{models.generated.js,image-models.generated.js} scripts/engine-model-data/
cp package/dist/providers/*.models.js scripts/engine-model-data/providers/
rm -rf scripts/engine-model-data/providers/data && cp -R package/dist/providers/data scripts/engine-model-data/providers/
```

同步把 `scripts/patch-engine-model-data.sh` 的 `SNAPSHOT_VERSION` 改为新版次
（语义：运行时 pi-ai ≥ 该版次即认为自带目录不旧于快照，跳过覆盖），并确认
`SENTINEL_MODEL` 仍是该快照新引入、包内旧目录没有的模型——冒烟靠它证明
"覆盖真的生效"，只断言目录非空会在覆盖失效时照样通过。

## 本快照的语义变化（0.85.1 → 0.86.1，目录生成 2026-09-05 → 2026-09-20）

新增侧：`deepseek-v4.1-flash` 进入 opencode / opencode-go / qwen-token-plan(-cn) /
vercel-ai-gateway（`deepseek/deepseek-v4.1-flash`）、openrouter、radius，以及以
`deepseek-ai/DeepSeek-V4.1-Flash` 拼写出现的 baseten / together / huggingface，
fireworks 是 `deepseek-v4p1-flash`；qwen-token-plan(-cn) 同时拿到 `glm-5.3`；
`deepseek`（pi-ai 目录里的 DeepSeek 条目）以 `deepseek-flash` 替换
`deepseek-v4-flash`(+`-vision-exp`)；nvidia 加 `z-ai/glm-5.3`(+flash)；新增
`meta`、`radius` 两家提供方（本仓未在快捷厂商表里列出，数据随附但不进 UI）。

移除侧（上游判定已下线，界面上会消失；需要在模型设置里按条目加回）：
`zai-coding-cn` 丢 `glm-4.7`/`glm-5-turbo`/`glm-5.1`/`glm-5.2`/`glm-5.2-highspeed`/
`glm-5v-turbo`（只剩 5.3 系与 4.6v）；`moonshotai(-cn)` 丢 kimi-k2 系预览版与 `kimi-k2.5`；
`openai-codex` 丢 `gpt-5.4`(-mini)；`opencode-go` 丢 `omen-alpha`。

models.dev 的**实时**接口仍列着更老的条目（glm-4.5 系、kimi-k2 预览版、minimax M2/M2.1、
小米 TTS 全系等），那是该站保留的历史条目，不是"更新"——上游 pi-ai 的生成器会裁到
当前在役的档位，所以本覆盖层只跟随 pi-ai 的发布数据，不去直接抄 models.dev。
