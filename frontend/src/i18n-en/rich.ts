// EN 词典 · rich 域（从 i18n-en.ts 按注释段切分，2026-10-12）：中文源串为键、英文为值；
// 只放数据不放逻辑。键的纪律与缺键扫描见 i18n.ts 头注释。
export const ENRich: Record<string, string> = {
  // rich output（正文富输出围栏，见 src/rich/）
  "正在渲染图表…": "Rendering diagram…",
  "正在读取图形…": "Reading figure…",
  "正在读取组件…": "Reading widget…",
  "正在读取嵌入…": "Reading embed…",
  "仅支持 https 链接，已按源码显示": "HTTPS URLs only — showing source",
  "正在生成组件…": "Generating components…",
  "图表渲染失败，已按源码显示": "Diagram failed to render — showing source",
  "SVG 渲染失败，已按源码显示": "SVG failed to render — showing source",
  "内容过大，已按源码显示": "Too large — showing source",
  "无法解析为组件，已按源码显示": "Could not parse as components — showing source",
  "交互组件": "Interactive widget",
  "组件运行报错": "Widget runtime error",
  "告知 AI": "Tell the AI",
};
