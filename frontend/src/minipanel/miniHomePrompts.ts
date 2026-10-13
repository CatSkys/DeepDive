// 迷你面板首页（草稿脸）的提示词胶囊清单：每颗 = 一个短标签 + 一段预填进输入框的
// 提示词。管清单本身；不管怎么渲染（MiniDraft 的事）也不管预填通道（Composer 的
// composerPrefill 事件）。
// 只放**提示词**：/ 命令不进这里——命令目录由壳侧药丸的命令卡承担（store.quickCommands
// 推壳那条腿），两者不是一件事。
// 文案两语并排（tt 的 zh/en 一对），组件里不写裸中文；标签是动作短语，提示词是整句，
// 光标落在句尾，用户接着补自己的内容（贴代码、贴报错、写需求）。

export type MiniHomePrompt = {
  /** 胶囊上的短标签（动作短语） */
  label: string;
  labelEn: string;
  /** 点选后整段预填进输入框的提示词 */
  text: string;
  textEn: string;
};

export const MINI_HOME_PROMPTS: MiniHomePrompt[] = [
  {
    label: "解释代码",
    labelEn: "Explain code",
    text: "解释下面这段代码做了什么，指出关键步骤和潜在问题：",
    textEn: "Explain what the following code does, calling out the key steps and any pitfalls:",
  },
  {
    label: "修报错",
    labelEn: "Fix an error",
    text: "下面是我的报错信息，帮我定位原因并给出修复方案：",
    textEn: "Here is my error output — help me find the cause and a fix:",
  },
  {
    label: "写脚本",
    labelEn: "Write a script",
    text: "帮我写一个脚本，需求是：",
    textEn: "Write a script for me, doing the following:",
  },
  {
    label: "总结内容",
    labelEn: "Summarize",
    text: "把下面的内容总结成要点：",
    textEn: "Summarize the following into key points:",
  },
  {
    label: "润色文字",
    labelEn: "Polish text",
    text: "把下面这段文字改得更通顺、更简洁，保持原意：",
    textEn: "Rewrite the following to be clearer and more concise, keeping the meaning:",
  },
];
