# atd-apps 素材出处

本目录是「Atd 个人小应用（My apps）」这一块的素材固化，供 `../../APPS.md` 引用。
与 `../` 根下 v0.7.12 那批不同，本批**取自上游仓库 main 的源码**，不是发布包。

| 项 | 值 |
|---|---|
| 上游仓库 | `https://github.com/JUNERDD/Atd` |
| 抓取时点 | 2026-10-13 |
| 该时点 HEAD | `45d4714`（`fix(website): retry transient CDN asset checks (#58)`，2026-10-13 12:04 +0800） |
| 上游最新 release | **v0.8.1**（2026-10-13 03:52 UTC） |
| 本机安装副本 | `/Applications/Atd.app`，`CFBundleShortVersionString = 0.8.0` |
| 抓取方式 | `git clone --depth 1 https://github.com/JUNERDD/Atd /tmp/atd-src`（75 MB；只读，未改动上游） |

复测（换新版本时）：

```sh
curl -s https://api.github.com/repos/JUNERDD/Atd/releases/latest
rm -rf /tmp/atd-src && git clone --depth 1 https://github.com/JUNERDD/Atd /tmp/atd-src
cd /tmp/atd-src && git log -1 --format=%H%n%ci
```

## 本目录内容

| 路径 | 是什么 |
|---|---|
| `product-skills/create-app/SKILL.md` | 模型侧的「创建应用」产品技能：工作流、外观设计指引、硬约束（原文） |
| `product-skills/create-app/references/sdk.md` | `@atd/app-kit` 的 SDK 速查：页面 + 后端 `ctx` + 组件构造器与全部上限（原文） |
| `product-skills/create-app/references/starter.md` | `app scaffold` 落下的起步工程、`atd-app.json` 字段、窗口表面与 hash 路由（原文） |
| `product-skills/create-app/references/example.md` | 一个成品示例（Mood），用来校准「每个应用长得像它自己」（原文） |
| `plans/2026-10-03-create-app.md` | 它自己的立项计划：照 Raycast Glaze 做、Q1–Q4 决策、T1/T1b/T1c 三份原型实测结论、风险清单（原文） |
| `plans/2026-10-06-app-capability-layer.md` | 能力层计划（Draft，未授权实现）：沙箱碰不到本机这一缺口的证据与统一能力层设计（原文） |
| `contracts/app-manifest.ts` | `atd-app.json` 的 TypeBox 契约（字段、上下限、`additionalProperties:false`） |
| `contracts/app-identity.ts` | 应用身份与能力清单常量（`APP_CAPABILITIES`、名称/描述上限） |
| `contracts/widgets.ts` | 桌面组件视图树 schema（节点词表、族、刷新下限、深度/快照上限） |

上游另有发布包内副本可对照（`/Applications/Atd.app/Contents/Resources/agent-service/`）：
`product-skills/create-app/`（与本目录同源）、`dist/apps/`（编译后的运行时）。
