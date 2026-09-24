# reference/ — 移植对照物（只读，不参与构建）

这里放**本仓需要移植、但 vendored 副本里没有**的官方源码。它与 `deepseek-harness/` 的
分工是：

- `deepseek-harness/` = 运行时引脚那一版（`scripts/dsh-runtime-version.txt`），逐字对应我们跑的引擎；
- `reference/` = 引脚之外的移植来源。只在「要移植的东西只存在于更新的官方版本」时才有，
  并且必须在 `docs/DSH-SOURCE-MAP.md` 里登记对照关系。

**这些文件不参与构建、不被 import、不改动。** 读它们是为了照抄规则，不是为了运行。

## 目前的内容

### `dsh-0.1.7-client-ui/sidebar-browser/`

`@deepseek-ai/dsh-client-ui-sidebar-browser@0.1.7-rc.1` 的发布包（含 `README.md` 设计文档、
`lib/client.js` 编译产物、`lib/types/**` 类型声明）。

为什么需要它：侧栏浏览器是 **0.1.7 才有的包**，而 vendored 副本停在引脚 0.1.5-rc.1，
所以本仓的右侧边栏（`ui-sidebar-right`，0.1.5 就有，可直接读 vendored 源码）与它合起来才是
完整方案。取包方式：

```sh
npm pack @deepseek-ai/dsh-client-ui-sidebar-browser@0.1.7-rc.1
tar xzf dsh-client-ui-sidebar-browser-0.1.7-rc.1.tgz
# 目录改名成 sidebar-browser，放进本目录
```

升引擎引脚到自带该包的版本之后，本目录可删（届时 vendored 副本就是对照源）。
