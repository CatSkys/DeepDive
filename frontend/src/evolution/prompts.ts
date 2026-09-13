// 自进化与 agent 的四份提示词（落库 / 复盘 / 校验 / 撤销）：纯函数，逐条钉在
// `docs/EVOLUTION-POLICY.md` 与技能 `deepdive-evolution` 的契约上。
// 政策与判据不写进代码——这里只负责把"要它干什么"说清楚。

import type { LessonProposal } from "./protocol";

/** 落点 → 目标文件（spec / skill 不唯一，交给 agent 按锚点判断，不猜具体文件）。 */
export const HOME_TARGET: Record<LessonProposal["home"], string> = {
  agents: "AGENTS.md（规则区）",
  pitfalls: "docs/PITFALLS.md",
  spec: "锚点所属的那份 docs/SPEC-*.md",
  skill: "锚点所属的那个引擎技能正文（<DSH_HOME>/skills/<name>/SKILL.md）",
  policy: "docs/EVOLUTION-POLICY.md",
};

/** 复盘批次里的一条被测会话（app 侧只给事实，判断交给 agent）。
 *  turns/failed/corrections 是"当时正看着"时的即时摩擦计数；没看过的会话为
 *  null（复盘改为扫日志后不依赖它，见 SPEC §9.0.6）。 */
export interface ReviewTarget {
  sessionId: string;
  /** 该会话日志的定位提示（agent 自己解析 $DSH_HOME，应用不持家目录）。 */
  logHint: string;
  /** 会话最后更新时间（毫秒）：本批的选取依据，也是 agent 看新鲜度的线索。 */
  updatedAt: number;
  turns: number | null;
  failed: number | null;
  corrections: number | null;
}

export function applyPrompt(p: LessonProposal): string {
  const evidence = p.evidence.map((e) => `- ${e.excerpt}${e.note === undefined ? "" : `（${e.note}）`}`).join("\n");
  const predict = p.predict === null
    ? "（风格类：不设校验）"
    : `${p.predict.metric} · 签名 ${p.predict.signature} · 窗口 ${p.predict.windowDays} 天`;
  return [
    "把下面这条经验落进仓库。先读 docs/EVOLUTION-POLICY.md 与目标文件已有的写法，按那一家的格式落。",
    "",
    `- 落点：${HOME_TARGET[p.home]} 的「${p.anchor}」一节末尾`,
    `- 类别：${p.category}`,
    `- 效果主张：${predict}`,
    "",
    "正文（原样写入，不要改写措辞）：",
    p.content,
    "",
    "证据（逐字，供提交信息引用）：",
    evidence,
    "",
    `要求：只改这一处、不顺手动别的地方；git 提交一次，提交信息写明因果并引用提案 id ${p.id}；完成后回一句：改了哪个文件、提交号是多少。`,
  ].join("\n");
}

/** 后台复盘：把"本批会话 + 已落库的坑签名"交出去。
 *  为什么要给签名清单：政策 §2 的"同一个坑第二次出现必提"要能真的检测到——
 *  没有清单，agent 只能看本批、看不见历史（self-learning-skills 的"重复=最强信号"）。 */
export function reviewPrompt(targets: readonly ReviewTarget[], knownSignatures: readonly string[]): string {
  const list = targets
    .map((t) => {
      const friction = t.turns === null
        ? "（本次未在会话内实时观察，摩擦信号未知）"
        : `本批完成 ${t.turns} 轮｜失败工具调用 ${t.failed ?? 0} 次｜用户纠正 ${t.corrections ?? 0} 次`;
      return `- 会话 ${t.sessionId}（日志 $DSH_HOME/sessions/*/${t.sessionId}/session.v3.jsonl.zstd）｜${friction}`;
    })
    .join("\n");
  const known = knownSignatures.length === 0
    ? "（台账里还没有带签名的经验）"
    : knownSignatures.map((s) => `- ${s}`).join("\n");
  return [
    "后台复盘（DeepDive 自进化）。按 docs/EVOLUTION-POLICY.md 判断这批会话里有没有值得跨会话复用的经验，有就按 deepdive-evolution 技能的协议输出 lesson 块（没有就只回一句「无」）。",
    "",
    "待分析（日志用 zstd -dc <路径> | grep 自行查证）：",
    list,
    "",
    "已落库经验的坑签名（拿本批日志比对：命中即「同一个坑第二次出现」，按政策必提）：",
    known,
    "",
    "重点看：失败或重试过的工具调用、用户纠正过的地方、同一个坑第二次出现。",
    "证据必须逐字来自日志；助手自己的总结不算证据。只读分析，不要修改任何文件。",
    "成本上限：最多 3-5 次工具调用把要点看清楚就够，别把整本日志读完，也别去读这个仓库的源码；判不出值得沉淀的东西就只回一句「无」。",
  ].join("\n");
}

/** 到期校验：让 agent 去日志里数签名，并回一个校验块。窗口锚定采纳时刻（政策 §4：
 *  「落库时把窗口切两半」）——createdAt 是提议时刻，不能当落地基线。 */
export function verifyPrompt(p: LessonProposal): string {
  const predict = p.predict;
  if (predict === null) return "";
  const landedISO = new Date(p.appliedAt ?? p.createdAt).toISOString();
  return [
    `校验一条已落库经验的效果主张（提案 ${p.id}）。`,
    "",
    `- 主张：${predict.metric}｜签名：${predict.signature}｜窗口：${predict.windowDays} 天`,
    `- 落库时间：${landedISO}`,
    `- 落点：${HOME_TARGET[p.home]} 的「${p.anchor}」`,
    "",
    "做法：跑随应用铺好的校验器（它按事件时间把命中归到「落地前 / 落地后」两个等长窗口，并打印末行回执）：",
    `  $DSH_HOME/deepdive/lesson-verify.mjs ${p.id} "${predict.signature}" ${predict.windowDays} ${landedISO} ${predict.metric}`,
    "把末行原样贴进一个围栏块（info string 为 lesson-verify），形如：",
    "```lesson-verify",
    `{"id":"${p.id}","before":12,"after":0}`,
    "```",
    "before/after = 落地前、落地后两个窗口的次数；有效与否由应用按政策阈值判定，你不用下结论。",
    "若脚本跑不起来（缺 node/权限），退回手工：zstd -dc 各会话日志 | grep，按同样口径给出两个窗口的数；数不准就报 0 并在正文里说明理由。",
    "成本上限：最多 2-3 次工具调用（跑一条命令就够），不要展开调查、不要读本仓库源码；不要修改任何文件。",
  ].join("\n");
}

/** 撤销：靠 git 回滚（落库那次提交引用了提案 id），不需要应用侧备份。 */
export function revokePrompt(p: LessonProposal): string {
  return [
    `撤销一条已落库的经验（提案 ${p.id}）。`,
    "",
    `它在 ${HOME_TARGET[p.home]} 的「${p.anchor}」一节里；落库那次提交的信息引用了提案 id ${p.id}，用 git log --grep=${p.id} 能找到。`,
    "",
    "做法：把那次提交的改动撤掉（git revert <sha>，或直接删掉该节里由它引入的内容再提交一次），提交信息写明「撤销提案 <id>」与因果。只改这一处。完成后回一句：改了哪个文件、提交号是多少。",
  ].join("\n");
}
