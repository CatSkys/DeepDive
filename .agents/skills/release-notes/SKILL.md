---
name: release-notes
description: Write DeepDive's user-facing app update notes — the docs/release-notes/<version>.md file that ships as release-notes.md and shows up in the in-app update card. Use this whenever preparing a release (before DEEPDIVE_NOTARY_PROFILE=... make package, or before make publish), and whenever someone asks what changed in a version, wants release notes drafted, or wants a list of changes summarized for users.
---

# DeepDive 应用更新说明

产出 `docs/release-notes/<版本>.md`。这一份会变成发布链上的 `release-notes.md`，出现在三个
地方：GitHub Release 正文、发布资产（装好的应用去拉它）、以及**应用标题栏那张更新卡的正文**。

所以读者是**用 DeepDive 的人**，不是读这个仓的人。这就是这份 skill 存在的全部理由：仓库的
提交信息是写给下一个 agent 的（工程因果、`PITFALLS §5.5`、内部组件名），直接搬给用户是错的。

## 什么时候做

发版之前。发布链优先取 `docs/release-notes/<版本>.md`；没有这个文件就退回用提交主题自动
生成，并在终端打出告警——那一版的说明会是工程语气。所以**要发版就先写这一份**。

## 取数

1. 上一个发布基准：

   ```sh
   git describe --tags --abbrev=0 --match 'app-v*'
   ```

   没有 tag 就是首次发布。

2. 这一版的范围：

   ```sh
   git log --no-merges --pretty='%s' <基准tag>..HEAD -- .
   git diff --stat <基准tag>..HEAD
   ```

   `--no-merges` 必带：本仓一个任务一条合并提交，它不进说明。

3. **提交主题只是线索，不是素材。** 判断"这条改动用户能不能感知"要回到代码：对拿不准的
   条目看实际 diff（前端看 `frontend/src`，壳侧看 `apps/macos/Sources`）。提交主题写的是
   实现动作（"识别钉到 Vision rev2"），用户能感知的往往是结果（"截图取字更准、更快"）。

## 挑选

进说明的只有**用户能感知**的变化：新增的能力、看得见的修复、行为变化、能感觉到的快慢。

不进说明的：

- 内部重构、构建与发布链、测试、脚本、只有贡献者读的文档
- 用户基本遇不到的边界情况
- 只在开发机上发生的事

拿不准就问一句：**用户会注意到吗？** 不会就不写。

## 格式契约

正文是 Markdown，但渲染它的是一张 **340px 宽、正文区最高 320px** 的卡（用仓库自带的
Markdown 子管线，不是完整 CommonMark）。所以：

- **第一行必须是 `## 本版变更`。** 发布链上传后会 grep 这个串，缺了它那道门会拦下发布。
- 只用：`##` 小标题、段落、**无序列表（不要嵌套）**、`**粗体**`、`` `行内码` ``、`[链接](url)`。
- 不要用：`####` 及更深标题、表格、嵌套列表、HTML、脚注、图片。
- 全文控制在**十几行以内**。卡是 hover 出来的，长了自己滚，没人读到后面。

## 语气

- 说用户拿到什么，不说我们改了什么。
- 一句一件事，动词开头。
- 不出现：文件路径、函数或组件名、`PITFALLS` 编号、`§`、提交前缀（`fix(截图):`）、内部
  代号与架构词（壳、桥、引擎子进程、契约——除非用户真的会看到那个东西）。

## 写完自检

- 第一行是 `## 本版变更`？
- 每一条都能让用户说出"哦，这个我看得到"？
- 对着 `git log` 再扫一遍，有没有漏掉用户可见的变化？
- 搜一遍 `PITFALLS`、`§`、`.swift`、`.tsx`、`.sh`、`scripts/`——都不该出现。

## 例子

`references/example.md` 是同一批改动的两种写法对照。
