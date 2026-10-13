// 划词命令目录：内置命令的名字与提示词模板、用户自定义命令、提示词渲染。
// 只这一份——胶囊按钮（壳按 {id,name} 画）、设置页编辑、点击后运行都读它。
// 与引擎的 commands/list 无关：那是本地工具命令（/compact 这类），这是提示词模板。

import { tt } from "../i18n";

/** 一条划词命令。`prompt` 里 `{{input}}` 处填入选中的文字。 */
export interface SelectionCommand {
  /** 稳定标识：壳按它回传点中的是哪条，改名不影响。 */
  id: string;
  /** 胶囊按钮上的名字。种子之后即用户数据，不随界面语言变（Atd 同款语义）。 */
  name: string;
  /** 提示词模板；没写 `{{input}}` 就把正文接在末尾。 */
  prompt: string;
  /** 关掉即不在胶囊上出现。 */
  enabled: boolean;
}

/** 命令条数上限（工具条实际能摆下的远少于此，留足给 More 菜单）。 */
export const MAX_SELECTION_COMMANDS = 32;

/** 模板里唯一认得的变量；其余花括号原样发给模型，不猜、不兜底。 */
export const INPUT_PLACEHOLDER = "{{input}}";

/**
 * 内置命令（Atd 的 starter 同源：名字与提示词照搬，参数先取默认值——翻译目标语言、
 * 总结形态、待办分组；参数化菜单见 docs/atd-research/SELECTION-CAPTURE.md 提案③）。
 * Atd 另两条 starter（总结文件 / 就截图提问）的输入是附件与截图，划词给不了，不收。
 */
export function builtinSelectionCommands(): SelectionCommand[] {
  return [
    {
      id: "translate",
      name: tt("翻译", "Translate"),
      prompt: `Translate the text below into Simplified Chinese. Preserve its meaning, tone and formatting, including Markdown, line breaks, code, links and names. Return only the translation.

${INPUT_PLACEHOLDER}`,
      enabled: true,
    },
    {
      id: "polish",
      name: tt("润色文字", "Polish writing"),
      prompt: `Improve the clarity, grammar and flow of the text below while keeping its meaning, voice, language and formatting. Return only the revised text.

${INPUT_PLACEHOLDER}`,
      enabled: true,
    },
    {
      id: "summarize",
      name: tt("总结", "Summarize"),
      prompt: `Summarize the text below as bullet points. Keep the facts, decisions and numbers that matter, and write in the same language as the text.

${INPUT_PLACEHOLDER}`,
      enabled: true,
    },
    {
      id: "explain",
      name: tt("解释", "Explain"),
      prompt: `Explain the text below in plain language: what it means, the key terms, and any context needed to understand it. If it is code, explain what it does step by step and point out anything surprising. Answer in the same language as the text.

${INPUT_PLACEHOLDER}`,
      enabled: true,
    },
    {
      id: "action-items",
      name: tt("提取待办事项", "Extract action items"),
      prompt: `Extract the action items from the text below as a checklist grouped by owner. Keep named owners and dates, and mark missing ones as unspecified. Write in the same language as the text.

${INPUT_PLACEHOLDER}`,
      enabled: true,
    },
    {
      id: "review-code",
      name: tt("审查代码", "Review code"),
      prompt: `Review the code below. List concrete problems, most severe first: bugs, unhandled edge cases, security risks and misleading names. Give each a one-line reason and a short fix. If you find none, say so plainly. Do not rewrite the whole code.

${INPUT_PLACEHOLDER}`,
      enabled: true,
    },
  ];
}

/**
 * 壳推来的 JSON 串 → 命令目录。**没存过**（空串 / 坏 JSON / 不是数组）才回内置种子；
 * 存过就照存的说——空数组是用户把命令全删了，不拿内置悄悄补回来。
 */
export function parseSelectionCommands(raw: string | null | undefined): SelectionCommand[] {
  if (!raw) return builtinSelectionCommands();
  let value: unknown;
  try { value = JSON.parse(raw); } catch { return builtinSelectionCommands(); }
  if (!Array.isArray(value)) return builtinSelectionCommands();
  const out: SelectionCommand[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (typeof item !== "object" || item === null) continue;
    const c = item as { id?: unknown; name?: unknown; prompt?: unknown; enabled?: unknown };
    if (typeof c.id !== "string" || c.id === "" || seen.has(c.id)) continue;
    if (typeof c.name !== "string" || typeof c.prompt !== "string") continue;
    seen.add(c.id);
    out.push({ id: c.id, name: c.name, prompt: c.prompt, enabled: c.enabled !== false });
    if (out.length >= MAX_SELECTION_COMMANDS) break;
  }
  return out;
}

/** 模板 → 真正发出去的提示词：`{{input}}` 处填入选中的文字；模板没写就接在末尾。 */
export function renderSelectionPrompt(command: SelectionCommand, input: string): string {
  const text = input.trim();
  if (command.prompt.includes(INPUT_PLACEHOLDER)) {
    return command.prompt.replaceAll(INPUT_PLACEHOLDER, text);
  }
  return `${command.prompt.trimEnd()}\n\n${text}`;
}
