import AppKit

/// 浮动工具面的玻璃配方（adapted：Atd `AIShell/Windows/GlassSurface.swift` 的 AppKit 半边）。
///
/// 与 `WindowGlassView` 分工：后者是**窗口**玻璃（主窗/面板窗/迷你面板整面，带各档 tint）；
/// 这里是**浮在屏幕上的工具面**（标注工具条、选区工具条、状态 HUD、工具条菜单）共用的
/// 一块玻璃——固定深色、不随背景自适应，底色是面板基色，圆整与内容同半径。
///
/// 为什么必须关自适应：`NSGlassEffectView` 默认按身后亮度选外观，冷启动头一帧按外观画、
/// 200–650ms 后才切换（再动画 ~750ms）——白底窗口上表现为"先黑后白"，也就是工具条看上去
/// 是白色的。`_adaptiveAppearance` 是私有键（0 自动 / 1 关 / 2 开，写别的值 AppKit 会 trap），
/// 只在 AppKit 还认这个 setter 时写 1；不认的版本保持原样继续自适应。
enum GlassSurface {
  /// 这类面固定钉的外观（与 `WindowGlassView` 的玻璃分支同款）。
  static let appearance = NSAppearance(named: .darkAqua)

  /// 面板基色 `rgb(24 24 24 / 80%)`：降透明度时用不透明档。
  static func fill(reduceTransparency: Bool) -> NSColor {
    NSColor(srgbRed: 24 / 255, green: 24 / 255, blue: 24 / 255, alpha: reduceTransparency ? 1 : 0.8)
  }

  /// 钉深色外观并关掉自适应（见文件头；符号不在时只降级，不崩）。
  static func disableAdaptation(_ glass: NSGlassEffectView) {
    glass.appearance = appearance
    guard glass.responds(to: NSSelectorFromString("set_adaptiveAppearance:")) else { return }
    glass.setValue(1, forKey: "_adaptiveAppearance")
  }

  /// 把 `content` 装成 `glass` 的内容并钉深色。玻璃不裁内容，所以底色与圆角画在 `content`
  /// 自己的层上（见 `shape`）——因此 `content` 不能自己带底色（滚动视图就带，得先包一层）。
  static func attach(_ glass: NSGlassEffectView, content: NSView) {
    content.wantsLayer = true
    glass.contentView = content
    disableAdaptation(glass)
  }

  /// 玻璃与内容同半径，底色按当前「降低透明度」重画；布局每轮调用（改任一项也要再调）。
  static func shape(_ glass: NSGlassEffectView, content: NSView, cornerRadius: CGFloat) {
    glass.cornerRadius = cornerRadius
    content.layer?.cornerRadius = cornerRadius
    content.layer?.cornerCurve = .continuous
    content.layer?.backgroundColor =
      fill(reduceTransparency: NSWorkspace.shared.accessibilityDisplayShouldReduceTransparency)
        .cgColor
  }
}
