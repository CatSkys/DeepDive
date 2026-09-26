// 空白标签页：整屏空白，中间一块大输入框（参考 `Omnibox.swift` 的 field + `Welcome` 的空态）。
//
// 它不是"另一个地址栏"——就是同一份 `AddressField` 的大号排法，所以补全列表的行、
// 键盘操作、搜索那条放大镜在两种尺寸下一模一样。页面一有地址这块就换成网页（见 BrowserPane）。
import { AddressField } from "./BrowserAddressField";
import type { PaneFace } from "./useIframeBrowser";

export function BrowserBlankPage({ face, focusTick, onPick }: {
  face: PaneFace;
  focusTick?: number;
  onPick: (url: string) => void;
}) {
  return (
    <div className="panel-browser-blank">
      <AddressField face={face} big focusTick={focusTick} onPick={onPick} />
    </div>
  );
}
