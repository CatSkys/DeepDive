import AppKit

/// 浮动工具面的玻璃（标注工具条、选区工具条、状态 HUD、工具条菜单共用）。
///
/// 配方是**本仓自己的那一份**：`WindowGlassView(surface: .floating)` 同款
/// （`NSGlassEffectView` + `style = .regular` + 46% 深色 tint），加上把外观钉死在深色、
/// 关掉自适应——`NSGlassEffectView` 默认按身后亮度选外观，冷启动头一帧按外观画、
/// 200–650ms 后才切换（再动画 ~750ms）：白底窗口上就是"先黑后白"，也就是工具条看着发白
/// 的原因。`_adaptiveAppearance` 是私有键（0 自动 / 1 关 / 2 开，写别的值 AppKit 会 trap），
/// 只在 AppKit 还认这个 setter 时写 1。
///
/// 与 Atd 的差别（2026-10-13 用户实机反馈后改）：Atd `GlassSurface` 在**内容层刷一层
/// 80% 不透明的底色**当"面板基色"，隔着玻璃看就是一块实心板；本仓验证过的观感是
/// 玻璃自己带 46% tint，内容层不加底色。`.floating` 档的 tint 值仍只有 WindowGlassView
/// 持有（单一事实源），这里只调它。
enum GlassSurface {
  /// 这类面固定钉的外观（与 `.floating` 档的深色玻璃同源）。
  static let appearance = NSAppearance(named: .darkAqua)

  /// 钉深色外观并关掉自适应（见文件头；符号不在时只降级，不崩）。
  static func disableAdaptation(_ glass: NSGlassEffectView) {
    glass.appearance = appearance
    guard glass.responds(to: NSSelectorFromString("set_adaptiveAppearance:")) else { return }
    glass.setValue(1, forKey: "_adaptiveAppearance")
  }

  /// 把 `content` 装成 `glass` 的内容并钉深色。内容层**不加底色**（见文件头）。
  static func attach(_ glass: NSGlassEffectView, content: NSView) {
    content.wantsLayer = true
    glass.contentView = content
    disableAdaptation(glass)
  }

  /// 玻璃与内容同半径；布局每轮调用（圆角随形状变时也要再调）。
  static func shape(_ glass: NSGlassEffectView, content: NSView, cornerRadius: CGFloat) {
    glass.cornerRadius = cornerRadius
    content.layer?.cornerRadius = cornerRadius
    content.layer?.cornerCurve = .continuous
  }
}
