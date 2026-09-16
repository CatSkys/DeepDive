// 代码预览卡：头栏（语言 + 复制）+ 行号代码体（官方代码块样式）。正文代码块与
// 富输出（图表 / 内联 SVG / 交互组件）的"渲染不出来"回退共用同一个组件——失败时
// 按同一张卡显示原文，不回退成纯段落。
import { useState } from "react";
import { IconCodeOutline16 } from "./Icons";
import { CodeLines } from "./CodeLines";
import { t } from "../i18n";

export function CodeBlock({ lines, lang }: { lines: string[]; lang: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(lines.join("\n"));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    } catch { /* clipboard unavailable */ }
  };
  return (
    <div className="cb">
      <div className="cbHead">
        <span className="cbFile">
          <IconCodeOutline16 size={15} className="cbIcon" />
          <span className="cbLang">{lang || "code"}</span>
        </span>
        <button className="cbCopy" onClick={() => void copy()}>{copied ? t("已复制") : t("复制")}</button>
      </div>
      <div className="cbBody">
        <CodeLines lines={lines} lang={lang} />
      </div>
    </div>
  );
}
