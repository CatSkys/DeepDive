// 原生控件挂注释的接线：把"哪个控件 + 文案 + 键帽"变成"注释窗口该摆在哪、能不能盖住它"。
//
// 与网页那半边是**同一块注释窗口**（`TooltipController` 的单例那份：系统液态玻璃 + 注释
// 那一页），区别只在锚点来源——网页报上来的是 CSS 视口矩形（要按那块页面换算），原生控件
// 直接给**屏幕**矩形。
//
// 为什么要带窗口层级：注释窗口默认那一档（`TooltipWindow.level`）只在普通窗口之上。截图/
// 标注工具条住在 `CaptureOverlayPanel`（`.screenSaver`，全屏冻结层）里，不把它抬上去就是
// "整块被盖住、什么也看不见"——而且这一条不会报错，只会静默不出现。
import AppKit

/// 会报"指针进出"的原生控件（注释与 hover 洗色共用同一个信号）。
protocol HoverReporting: NSView {
  /// `true` 指针进来、`false` 出去。
  var onHover: ((Bool) -> Void)? { get set }
}

extension HoverReporting {
  /// 悬停就弹全站那套注释（UI-SPEC §1.11）：文案与键帽直接给，锚点与窗口层级现算。
  /// 同一控件再挂一次就换文案（`applyStrings()` 换语言时会重挂）。
  func attachTooltip(text: String, caps: [String]) {
    onHover = { [weak self] hovered in
      guard let self else { return }
      if hovered {
        NativeTooltip.show(self, text: text, caps: caps)
      } else {
        NativeTooltip.hide()
      }
    }
  }
}

enum NativeTooltip {
  /// 悬停一个原生控件：它在屏幕上的矩形就是锚点，它所在的窗口决定注释的可待范围与层级。
  static func show(_ view: NSView, text: String, caps: [String]) {
    guard let window = view.window, !text.isEmpty else { return }
    let anchor = window.convertToScreen(view.convert(view.bounds, to: nil))
    AppDelegate.shared?.tooltip.show(text: text, caps: caps, anchor: anchor, in: window)
  }

  static func hide() {
    AppDelegate.shared?.tooltip.hide()
  }

  /// 快捷键显示串 → 键帽：修饰符逐字成块（`⌘Z` → [⌘][Z]），单词键整块不拆
  /// （`Esc` → [Esc]；同 UI-SPEC §1.8 的"Enter 整块不拆"）。空串=没有键帽。
  static func caps(_ shortcut: String) -> [String] {
    guard !shortcut.isEmpty else { return [] }
    return shortcut.contains(where: { "⌘⌥⌃⇧".contains($0) }) ? shortcut.map(String.init) : [shortcut]
  }
}
