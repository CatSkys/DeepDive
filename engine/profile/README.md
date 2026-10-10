# engine/profile — DeepDive 的引擎组合

**这个目录是「引擎装载哪些插件」的唯一事实源。** `cordis.patch.yml` 就是全部：
壳启动引擎时，profile 的 `dsh.profile.bundles` 只列它一个（外加两个随包社区插件），
上游的 `@deepseek-ai/dsh-base` 与 `@deepseek-ai/dsh-web-app` **不再作为层参与组合**。

## 它是什么

引擎的组合是一条**扁平补丁列表**，后层可覆盖前层：

```
bundles（按 dsh.profile.bundles 顺序）→ profiles/<name>/cordis.patch.yml
  → $DSH_HOME/cordis.patch.yml → --patch overlay
```

上游把这条链分成两层用（base 出核心行、web-app 出 web 面行并回头覆盖 base 的若干行）。
本目录把两层的**最终结果**收敛成一份 `- insert:`，因此三条引擎规则必须由我们自己守住：

1. **`config` 是整体替换、不深合并**——带 config 的行必须写全。上游自己的补丁头就在警告
   这件事，而壳的 `engine-patch.yml` 曾踩中它（只写 `personaPrefix`，把 web 层的
   `personaSuffix` 打回 schema 默认空串），见 `docs/PITFALLS.md`。
2. **没有删除**，只有 `disabled: true`。
3. **`- id:` 匹配不到只 warn、不报错**——所以漂移不能靠启动发现，只能靠重新 dump 对比。

行顺序不承载加载语义（激活由服务可用性驱动），保序只是为了与上游 diff 干净。

## 怎么部署

壳在启动引擎前把本目录装进 `$DSH_HOME/profiles/web/node_modules/deepdive-engine-profile`
（`ProfileComposer.swift`，幂等 + 版本标记，纪律同 `ChatImportPlugin`），再写
`dsh.profile.bundles`。**顺序不能反**：bundle 解析先查 dsh 安装锚点、再查 profile 的
`node_modules`，而 loader 的模块兜底修复**不会**替我们创建 bundle 包本身。

本包**不声明 dependencies**：行里引用的插件名（`@deepseek-ai/dsh-tools` 等）从 dsh 安装
闭包解析，实测启动正常。

**版本标记是内容寻址的**：`embed-engine.sh` 在构建期把 Resources 副本的
package.json version 盖成 `<原版本>+<内容哈希>`——本目录任何文件变化都必然触发
ProfileComposer 重装，不会出现"组合改了、用户机器还跑着旧 bundle"的静默陈旧。
仓内 `package.json` 的 version 保持手写干净值，只在有意义的发布节点改它。

## 预设（agent 平面）也在本目录

`presets/` 下是四个 agent 预设（`standard`/`ptc`/`minimal`/`cordis`），逐字复制自
`engine/packages/preset/agent-presets/presets/`。`cordis.patch.yml` 的 agent-presets 行
用 `includeShippedRoot: false` 关掉包内预设根、`roots` 指向本 bundle 的安装位置
（`!!js dshHomePath('profiles/web/node_modules/deepdive-engine-profile/presets')`，
机器无关——dump 快照按 `!!js` 标签原样记录）。`trust: system` 与 shipped 一致（只读）；
`includeUserRoot` 保持默认 true，`$DSH_HOME/.agent-presets` 用户扩展点保留且排在我们
之后、不能覆盖我们的 id。

预设是**每会话 agent 平面的事实源**：宿主组合里的 `disabled: true` 对预设行不可达
（预设经 standing scope 独立挂载），所以"模型看得见哪些工具"由这里裁决——
宿主行只管宿主层。改预设与改组合同纪律：沙箱实跑、`pluginInventory/list` 对比
预设组合清单、prompt 冒烟过门。

## 怎么改

改 `cordis.patch.yml` → 跑 `scripts/dump-engine-composition.sh` 对比改动前后的组合清单 →
启动引擎实跑一轮。**不要**只读补丁文件就判断生效。

## 动引擎包时怎么查组合漂移

`composition.expected.txt` 是本目录组合结果的**期望快照**，`scripts/check-engine-composition.sh`
每次 `make test` 与构建链都会拿实际 dump 与它对比，不一致即失败。所以漂移不会静默：
动过 `engine/packages`（升依赖、改插件）后第一次跑测试就会红，diff 直接告诉你组合变了什么。

裁决时把改动前后的 dump 对比——**差异就是待裁决清单**（需要对照上游行为时，
对 vendored 基线 `deepseek-harness/` 里的两层做同样的 dump）：

```sh
# 我们这份组合出什么
scripts/dump-engine-composition.sh --bundles 'deepdive-engine-profile' \
  --local-bundle engine/profile --out /tmp/ours-composition.txt
```

逐条判断：删掉的核心行（能力静默缺失）、改过的 config（要不要那样改）、
新增的行（是否本意）。注意我们**有意移除**的那批行也在期望快照里，
它们同时列在 `cordis.patch.yml` 的文件头——在清单里=我们有意为之，
不期而遇的变化=待裁决。
裁决完把结论落回 `cordis.patch.yml`，重新生成期望快照，两者一起提交:

```sh
scripts/dump-engine-composition.sh --bundles deepdive-engine-profile \
  --local-bundle engine/profile --out engine/profile/composition.expected.txt
```

**预设文件同样要查漂移**：动过 `engine/packages/preset/agent-presets/presets/` 时，
diff 会告诉我们预设内容变没变——逐字复制是默认，除非我们有意的裁剪行被改了
（那时重新裁决再落）：

```sh
diff -r engine/packages/preset/agent-presets/presets engine/profile/presets
```

这就是「整棵树归本仓」的代价，用这条流程把它变成机械动作。
