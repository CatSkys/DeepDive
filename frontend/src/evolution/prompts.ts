// 自进化与 agent 的三份提示词（落库 / 复盘 / 撤销）+ 整理环提示词：纯函数，逐条钉在
// `docs/EVOLUTION-POLICY.md` 与技能 `deepdive-evolution` 的契约上。
// 到期校验不在里面：校验器是壳侧本机直跑的固化脚本（Ditto selftest 同款——宿主
// 验证，不经模型），提示词层没有"校验"这件事。
// 政策与判据不写进代码——这里只负责把"要它干什么"说清楚。

import { GLOBAL_ANCHOR, homeScope, type LessonProposal } from "./protocol";

/** 落点 → 目标文件（spec / skill 不唯一，交给 agent 按锚点判断，不猜具体文件）。 */
export const HOME_TARGET: Record<LessonProposal["home"], string> = {
  agents: "AGENTS.md（规则区）",
  pitfalls: "docs/PITFALLS.md",
  spec: "锚点所属的那份 docs/SPEC-*.md",
  skill: "锚点所属的那个引擎技能正文（<DSH_HOME>/skills/<name>/SKILL.md）",
  policy: "docs/EVOLUTION-POLICY.md",
  global: "$DSH_HOME/AGENTS.md（全局指令，跨工作区常驻）",
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
  // global 家的锚点固定为 AHE 式追加区（文件可能尚不存在，由本轮负责创建）。
  const anchor = p.home === "global" ? GLOBAL_ANCHOR : p.anchor;
  const scopeLine = homeScope(p.home) === "dsh-home"
    ? "本次只允许写 <DSH_HOME> 下的文件，不要碰任何工作区/仓库文件。"
    : "本次只允许写当前工作区里的文件，不要碰工作区之外的任何路径。";
  const globalPre = p.home === "global"
    ? "目标文件可能尚不存在：不存在就先创建，文件首行为 `# Global Agent Instructions`，再追加目标节。\n"
    : "";
  return [
    p.home === "skill" || p.home === "global"
      ? "把下面这条经验落进引擎目录。先看目标文件已有的写法，按那一家的格式落。"
      : "把下面这条经验落进仓库。先读 docs/EVOLUTION-POLICY.md 与目标文件已有的写法，按那一家的格式落。",
    "",
    `- 落点：${HOME_TARGET[p.home]} 的「${anchor}」一节末尾`,
    `- 类别：${p.category}`,
    `- 效果主张：${predict}`,
    "",
    globalPre,
    "正文（原样写入，不要改写措辞）：",
    p.content,
    "",
    "证据（逐字，供提交信息引用）：",
    evidence,
    "",
    `要求：${scopeLine}只改这一处、不顺手动别的地方。`,
    p.home === "skill" || p.home === "global"
      ? "完成后直接结束，不用提交 git（该目录不是 git 仓库）。"
      : "git 提交一次，提交信息写明因果并引用提案 id " + p.id + "。",
  ].filter((l) => l !== "").join("\n");
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

/** 撤销：仓库家靠 git 回滚（落库那次提交引用了提案 id）；DSH_HOME 家不是 git
 *  仓库，删掉那次写入的小节即可（landing.files 记了文件，正文在提案里）。 */
export function revokePrompt(p: LessonProposal): string {
  if (homeScope(p.home) === "dsh-home") {
    const anchor = p.home === "global" ? GLOBAL_ANCHOR : p.anchor;
    return [
      `撤销一条已落库的经验（提案 ${p.id}）。`,
      "",
      `它在 ${HOME_TARGET[p.home]} 的「${anchor}」一节里。把这一节里由该提案引入的内容删掉（其余内容原样保留），只改这一处。该目录不是 git 仓库，不用提交。完成后直接结束。`,
    ].join("\n");
  }
  return [
    `撤销一条已落库的经验（提案 ${p.id}）。`,
    "",
    `它在 ${HOME_TARGET[p.home]} 的「${p.anchor}」一节里；落库那次提交的信息引用了提案 id ${p.id}，用 git log --grep=${p.id} 能找到。`,
    "",
    "做法：把那次提交的改动撤掉（git revert <sha>，或直接删掉该节里由它引入的内容再提交一次），提交信息写明「撤销提案 <id>」与因果。只改这一处。完成后直接结束。",
  ].join("\n");
}

/** 整理环（MiMo Dream 的等价物，按沙箱作用域拆两轮）：对既有知识做去重、
 *  合并、失效锚点清理与压缩——直接维护性编辑，不走提案协议。 */
export function consolidatePrompt(scope: "repo" | "dsh-home"): string {
  if (scope === "dsh-home") {
    return [
      "后台整理（DeepDive 自进化·整理，只管引擎目录）。",
      "",
      "逐一检查 <DSH_HOME>/skills/*/SKILL.md 与 <DSH_HOME>/AGENTS.md（后者可能不存在，跳过即可）：",
      "- 合并重复讲同一件事的小节；删掉互相矛盾的旧表述（保留新的）；压缩明显膨胀的段落；",
      "- 修正失效的内部引用（指向不存在文件/小节的）；格式向各家已有的写法看齐。",
      "不做内容升级——只维护信噪比。该目录不是 git 仓库，不用提交。改完直接结束；没有任何要改的就原样结束。",
      "成本上限：最多 8-10 次工具调用；不要读工作区/仓库文件，不要改产品代码。",
    ].join("\n");
  }
  return [
    "后台整理（DeepDive 自进化·整理，只管仓库知识文件）。",
    "",
    "逐一检查 AGENTS.md、docs/PITFALLS.md、docs/EVOLUTION-POLICY.md 与 docs/SPEC-*.md 里由自进化追加的条目：",
    "- 合并重复讲同一件事的条目；删掉互相矛盾的旧表述（保留新的）；压缩明显膨胀的段落；",
    "- 修正失效引用（指向不存在文件/小节/命令的）——先验证再改，拿不准的留着不动；",
    "- 每家文件的格式规范以它自己的维护条款为准。",
    "不做内容升级——只维护信噪比。每改一个文件单独 git 提交一次，提交信息写明「自进化·整理」与因果。改完直接结束；没有任何要改的就原样结束。",
    "成本上限：最多 8-10 次工具调用；不要改产品代码。",
  ].join("\n");
}
