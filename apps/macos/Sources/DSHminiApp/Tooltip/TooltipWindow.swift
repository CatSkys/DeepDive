// 悬浮注释的宿主窗口：一块贴着注释大小的透明无边框面板，底是系统液态玻璃
// （`WindowGlassView(surface: .floating)`，与命令中心卡同一档配方），上面铺一块透明
// webview 渲注释本体（`?tooltip=1` 那一页）。**材质与位置归这里，内容归那一页**。
//
// 为什么是一块独立窗口，而不是主窗里的一个子视图：原生玻璃只能糊到它身后的东西，
// 而"要糊的东西"与"要显示的东西"同处一块 webview 时怎么垫都是错的（PITFALLS §4.38：
// 垫在下面糊不到正文，垫在上面把自己的字压住）。独立窗口天生没有这个二难——玻璃糊的是
// 窗口背后的画面（本应用其余窗口 + 桌面），注释内容在它自己之上的一块 webview 里。
// Raycast 的 tooltip 也是这个形制（`RaycastDesktopApp/TooltipWindow.swift` +
// `NSGlassEffectView`）。
//
// 只做"一块贴着内容、能弹进弹出的玻璃面"这一件事：注释什么时候来、内容是什么、
// 摆在哪，都归 TooltipController。

import AppKit
import WebKit

final class TooltipWindow: NSPanel {
  /// 注释**自己的 CSS 外投影**要的余量：`.tip` 的 `--shadow-pop`（向下 12 / 半径 28）由
  /// 那一页自己画，窗口会把它裁掉——所以窗口四周留出这一圈透明边，那一页内缩同一个值。
  /// 改 `--shadow-pop` 就要跟着改这里。
  static let shadowInset: CGFloat = 40
  /// 开场尺寸（第一次 `place()` 之前那两块的大小）：够放下 300 上限的注释，别让第一帧
  /// 就被窗口裁掉。**注释有多宽不靠它决定**——那一页的量尺宽度是 CSS 里那格 `.tip-page`
  /// （312），所以尺寸与窗口当前多大无关。
  static let initialSize = NSSize(width: 320, height: 56)
  /// 高于迷你面板那一档（`MiniPanelWindow.level` = floating + 1）：注释要浮在它上面。
  static let level = NSWindow.Level(rawValue: NSWindow.Level.floating.rawValue + 2)

  /// 注释那一页：透明，**连材质一起画**——`[data-liquid-glass-backdrop]` 那一层是全站的
  /// 系统液态玻璃档（与输入胶囊同一份规则），所以窗口这里不再垫原生 `NSGlassEffectView`：
  /// 两层玻璃叠着会发灰（theme.css 那条注释里的同一件事）。窗口只管位置、层级与进出场。
  let web: WKWebView
  /// 那一页的父层：动效（缩放 + 透明度）跑在它身上。
  private let stack = NSView()

  /// 入场：Raycast popover 的曲线——0.25s、cubic-bezier(.3, .7, 0, 1.26)（尾端一点过冲），
  /// 从 opacity .6 / scale .97 到 1。离场 0.15s ease-out 到 opacity 0 / scale .97
  /// （关闭比打开快——"快出慢入"）。页内那份跑的是同名 keyframes（theme.css 的 tip-in/tip-out）。
  private static let enterDuration: CFTimeInterval = 0.25
  private static let exitDuration: CFTimeInterval = 0.15

  init(configuration: WKWebViewConfiguration) {
    let web = WKWebView(frame: .zero, configuration: configuration)
    self.web = web
    // 初值不是 0/1px：第一帧就得有地方画（零尺寸的 webview 什么都排不出来）。
    super.init(
      contentRect: NSRect(origin: .zero, size: Self.initialSize)
        .insetBy(dx: -Self.shadowInset, dy: -Self.shadowInset),
      styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
    level = Self.level
    collectionBehavior = [.canJoinAllSpaces, .stationary, .ignoresCycle, .fullScreenAuxiliary]
    isOpaque = false
    backgroundColor = .clear
    // 影子归那一页的 CSS（`--shadow-pop`）；窗口再画一份就是两层影子。
    hasShadow = false
    hidesOnDeactivate = false
    becomesKeyOnlyIfNeeded = true
    isMovable = false
    isExcludedFromWindowsMenu = true
    isReleasedWhenClosed = false
    animationBehavior = .none
    // 注释永远不吃事件：它只是浮在指针旁边的一块说明（页内那份是 pointer-events: none）。
    ignoresMouseEvents = true

    stack.wantsLayer = true
    stack.autoresizingMask = [.width, .height]
    contentView = stack
    stack.addSubview(web)

    // 与其它几块 webview 同一套透明做法（`drawsBackground` 走 KVC 是公开 API 之外
    // 唯一能关掉网页自身底色的口）。
    web.setValue(false, forKey: "drawsBackground")
    web.underPageBackgroundColor = .clear
    web.allowsMagnification = false
    web.autoresizingMask = []
    // 先摆到开场尺寸：`place()` 之前它还是零尺寸，那一页第一次量尺寸就落在一个塌掉的
    // 视口里（见 Tooltip/ 与 PITFALLS §4.45）。
    web.frame = NSRect(origin: NSPoint(x: Self.shadowInset, y: Self.shadowInset), size: Self.initialSize)
  }

  override var canBecomeKey: Bool { false }
  override var canBecomeMain: Bool { false }

  /// 浮到给定窗口层级之上（每一条注释都重算）。截图/标注工具条住在 `CaptureOverlayPanel`
  /// ——`.screenSaver` 那一档，比注释窗口默认那档高得多，不抬上去整块会被它盖住，而且**不
  /// 报错、只是看不见**。普通窗口（层级 0）就落回默认档。
  func raise(above level: NSWindow.Level) {
    let needed = NSWindow.Level(rawValue: level.rawValue + 1)
    self.level = needed.rawValue > Self.level.rawValue ? needed : Self.level
  }

  /// 贴着注释摆：`origin` 是**注释内容**的屏幕原点（左下），窗口自己往外让出投影余量
  /// ——那一圈是留给注释自己的 CSS 外投影的，窗口把它裁掉就没有影子了。
  func place(size: NSSize, origin: NSPoint) {
    let inset = Self.shadowInset
    setFrame(
      NSRect(
        x: origin.x - inset, y: origin.y - inset,
        width: size.width + inset * 2, height: size.height + inset * 2),
      display: false)
    // 圆角不归这里：注释的圆角与材质都在 CSS 上（材质层 `border-radius: inherit`）。
    web.frame = NSRect(origin: NSPoint(x: inset, y: inset), size: size)
  }

  /// 弹入（每一条注释只跑一次；换内容不重播）。
  func animateIn() {
    guard let layer = stack.layer else { return }
    layer.opacity = 1
    layer.transform = CATransform3DIdentity
    layer.add(scaleFade(from: 0.97, to: 1, opacityFrom: 0.6, opacityTo: 1, duration: Self.enterDuration,
                        curve: CAMediaTimingFunction(controlPoints: 0.3, 0.7, 0, 1.26)),
               forKey: Self.animationKey)
  }

  /// 收场：跑完离场再 `orderOut`（`completion` 里做）。中途又被叫出来时由调用方丢弃这次收尾。
  func animateOut(completion: @escaping () -> Void) {
    guard let layer = stack.layer else { return completion() }
    layer.add(scaleFade(from: 1, to: 0.97, opacityFrom: 1, opacityTo: 0, duration: Self.exitDuration,
                        curve: CAMediaTimingFunction(name: .easeOut)),
              forKey: Self.animationKey)
    // 模型值同步落到终态：动画只改呈现值，不收尾的话下一次 orderFront 会闪一帧原样。
    CATransaction.begin()
    CATransaction.setDisableActions(true)
    layer.opacity = 0
    layer.transform = CATransform3DMakeScale(0.97, 0.97, 1)
    CATransaction.commit()
    DispatchQueue.main.asyncAfter(deadline: .now() + Self.exitDuration, execute: completion)
  }

  private static let animationKey = "deepdive.tooltip"

  private func scaleFade(
    from: CGFloat, to: CGFloat, opacityFrom: Float, opacityTo: Float,
    duration: CFTimeInterval, curve: CAMediaTimingFunction
  ) -> CAAnimationGroup {
    let scale = CABasicAnimation(keyPath: "transform.scale")
    scale.fromValue = from
    scale.toValue = to
    let alpha = CABasicAnimation(keyPath: "opacity")
    alpha.fromValue = opacityFrom
    alpha.toValue = opacityTo
    let group = CAAnimationGroup()
    group.animations = [scale, alpha]
    group.duration = duration
    group.timingFunction = curve
    return group
  }
}
