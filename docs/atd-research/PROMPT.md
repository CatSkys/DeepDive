# Atd 调研 · 接手提示词

> 用法:配 `HANDOVER.md` 一起交。把它作为接手 agent 新会话的第一条消息,原样粘贴即可;素材在本目录 `assets/`(持久副本,/tmp 里的原件已不可依)。
> 下一位更新本文件时只改过的,不记沿革。

---

```text
接手「Atd 对照调研」线(对象:GitHub JUNERDD/Atd)。全部家当在
docs/atd-research/:主交接文档 HANDOVER.md
必先通读;assets/ 内有 Atd 仓库的 AGENTS.md 全文(设计章是借鉴提案的出处)、
1245 行 design-source.md、5 张界面预览图、GitHub API 快照,以及
atd-apps/(小应用素材),共约 5.2MB——这是唯一持久副本,/tmp 原件已不可依。

按序执行:
1. 读 HANDOVER.md。事实、数字、复测命令(含本机 mount 的可行/不可行结论)
   都在里面;先拉一次它的最新 release 对照 §1 的版本号,有新版先更新素材再动。
2. 读本仓 AGENTS.md、docs/WORKING-AGREEMENTS.md、docs/PITFALLS.md 的相关条目,
   动手前先读对应的家,不凭记忆。
3. 实机验证:安装 ~/Downloads/Atd-0.7.12-arm64.dmg(它未公证,首启要
   系统设置→隐私与安全性→仍要打开;GUI 步骤叫我,你来引导)。
   拿 assets/ 那 5 张 1440×900「设计导出图」逐面对照实机,结论按
   现状态写作回写 HANDOVER.md §3;没实测的面不下结论。
4. 提案拍板:把 HANDOVER.md §4 的 8 条提案逐条摆给我裁决,我点头之前
   不动任何规范文件、不写任何代码。获准后按此序做:
   a) #1 机械卡点——扩展 frontend/scripts/check-architecture.mjs:
      CSS/JSX 出现裸 hex 色值、内联 style= 即红;不引入新依赖。
   b) #2③ 玻璃 outset——先按 PITFALLS 流程实证:拿(backdrop blur12 与
      --shadow-pop 同盒)的菜单卡,实测 WebKit 合成层扩域是否真实发生;
      实证通过才立不变式写进 docs/UI-SPEC.md §1.5,失败就只记现象。
   采纳与否、顺序,以我当轮的答复为准。
5. 改动流程:独立任务先 scripts/new-worktree.sh <slug> 开树;简单改动
   (文档/检查脚本)= make check;行为改动 = make test 全绿;主仓收
   merge --no-ff,合并后 make deliver;提交信息中文详述因果。
6. 边界:我没点名的 Atd 其余块(widget、其余分包深潜)
   不擅自扩;铁律 9——不确定就问,禁止猜测性代码;handover-atd 目录
   归宿(提交归档/移入 docs/)等你指示,勿自行处理。
   「个人小应用(My apps)」已单独立文:`APPS.md` + `assets/atd-apps/`
   (时点=上游 main @ 45d4714,release v0.8.1);它的 7 条借鉴提案
   (§8)与两份立项计划(它是照 Raycast Glaze 做的)都在那里,拍板前
   不动任何规范文件。
```
