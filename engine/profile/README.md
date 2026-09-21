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

## 怎么改

改 `cordis.patch.yml` → 跑 `scripts/dump-engine-composition.sh` 对比改动前后的组合清单 →
启动引擎实跑一轮。**不要**只读补丁文件就判断生效。

## 升引脚时怎么查漂移

上游每次升引脚都可能改自己那两层。**把上游两层与我们这份跑出来的组合对 diff，就是漂移报告**，
不需要额外的行表提取工具：

```sh
# 上游两层在本 pin 下组合出什么
scripts/dump-engine-composition.sh --bundles '@deepseek-ai/dsh-base,@deepseek-ai/dsh-web-app' \
  --out /tmp/upstream-composition.txt

# 我们这份组合出什么
scripts/dump-engine-composition.sh --bundles 'deepdive-engine-profile' \
  --local-bundle engine/profile --out /tmp/ours-composition.txt

diff /tmp/upstream-composition.txt /tmp/ours-composition.txt
```

**差异就是待裁决清单**，逐条判断：上游新增的核心行（我们没跟上 → 能力静默缺失）、
上游改过的 config（我们要不要跟）、上游删掉的行（我们的行成了死行）。裁决完把结论
落回 `cordis.patch.yml`，再提交——这就是「整棵树归本仓」的代价，用这条流程把它变成机械动作。
