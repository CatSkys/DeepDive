// 读取/编辑/搜索族折叠态的三段式摘要（2026-10-12 定稿：动词开头，徽标跟在
// 动词后面——路径是宾语；搜索词/目录不是修饰对象文件时不带徽标）。单条工具行
// 与组头共用这一段拼法（summaryClass 区分两个面的样式），别处不再自行拼。
import { Fragment } from "react";
import { FileIcon } from "./FileIcon";
import { t } from "../i18n";
import { relativizePath } from "./format";
import { toolDisplayName } from "./toolKind";

export function VerbPath({ toolName, verb, text, badgePath, cwd, summaryClass = "tool-summary" }: {
  /** 工具名：verb 缺省时按它取对外动词。 */
  toolName?: string;
  /** 组头等场合的动词直给（如更改组的家族动词「编辑」），不走 toolName 词典。 */
  verb?: string;
  /** 宾语文本（路径或查询词），空串时只落动词。 */
  text: string;
  /** 真实文件路径才有的语言徽标；查询词不画。 */
  badgePath?: string;
  cwd?: string;
  summaryClass?: string;
}) {
  const verbText = verb ?? (toolName ? toolDisplayName(toolName, t) : "");
  const shown = relativizePath(text, cwd);
  if (!verbText) return <span className={summaryClass}>{shown}</span>;
  if (!shown) return <span className={summaryClass}>{verbText}</span>;
  if (!badgePath) return <span className={summaryClass}>{`${verbText} ${shown}`}</span>;
  return (
    <Fragment>
      <span className={summaryClass}>{verbText}</span>
      <FileIcon file={relativizePath(badgePath, cwd)} />
      <span className={summaryClass}>{shown}</span>
    </Fragment>
  );
}
