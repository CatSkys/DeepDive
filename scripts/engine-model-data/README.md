# engine-model-data — 引擎内嵌 pi-ai 模型目录数据层覆盖

## 是什么

`@earendil-works/pi-ai` 的**生成数据层**快照（纯数据，无任何可执行代码改动），
来源 `pi-ai@0.84.4` 的 dist 产物：

- `models.generated.js` — 聊天模型目录聚合器（`export const MODELS`）
- `image-models.generated.js` — 图片模型目录（`export const IMAGE_MODELS`）
- `providers/*.models.js` — 各提供方模型字面量（聚合器按文件名逐个 import，
  缺一个整个 pi-ai 在 require 时崩溃）
- `providers/data/` — 上述目录的生成源 JSON（运行时不读，随附保持一致，
  避免与 models.js 出现两套"事实"）

## 为什么存在

`scripts/dsh-runtime-version.txt` 引脚的引擎自带**它发布当天**的 pi-ai 目录
（0.1.1-rc.2 → pi-ai 0.82.1），提供方模型清单（模型菜单）在引脚不动期间会持续
过时；而配置层无法补齐（`llm-pi-ai.providers.<id>.models` 整体替换目录，且混合
协议路由下配置新增陌生 id 会让整个路由解析失败——`dsh-llm-pi-ai` catalog 的
`sharedCatalogApi` 约束）。嵌入时由 `scripts/patch-engine-model-data.sh` 把本
目录覆盖进 bundle 内的 pi-ai dist，使所有提供方目录与上游最新生成数据一致，
引擎引脚保持不动。

## 生命周期

`patch-engine-model-data.sh` 带版本闸：运行时 pi-ai ≥ `0.84.0` 时自动跳过。
**引擎引脚升到自带 pi-ai ≥ 0.84.0 的版本后，删除本目录**，勿再手维护。

## 更新快照

```sh
npm pack @earendil-works/pi-ai@<新版>
tar xzf earendil-works-pi-ai-<新版>.tgz
cp package/dist/{models.generated.js,image-models.generated.js} scripts/engine-model-data/
cp package/dist/providers/*.models.js scripts/engine-model-data/providers/
rm -rf scripts/engine-model-data/providers/data && cp -R package/dist/providers/data scripts/engine-model-data/providers/
```

同步把 `scripts/patch-engine-model-data.sh` 的 `SNAPSHOT_VERSION` 改为新版次
（语义：运行时 pi-ai ≥ 该版次即认为自带目录不旧于快照，跳过覆盖）。
