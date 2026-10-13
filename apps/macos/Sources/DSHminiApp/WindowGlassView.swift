// 窗口的底：只负责"窗口底板玻璃"这一件事，坐在所有内容之下（它是 window.contentView，
// 其他视图都叠在它上面）。布局、命中测试、拖拽都不归它管。
//
// macOS 26+ 用 Liquid Glass（`NSGlassEffectView`）——这是系统给"自定义玻璃表面"的正式
// API，也是本应用唯一拿得到液态玻璃的路径：整个界面画在透明 WKWebView 里，不是标准
// AppKit 控件，走不到"系统自动给标准控件发放"那条路。更早的系统退回 vibrancy 材质
// （`NSVisualEffectView` + 近黑 tint），两边观感不同但职责相同。
//
// 糊度是系统材质的（Raycast 同款，2026-10-13 反编译结论：它的 BlurView 只做着色，
// `layer.backgroundColor = tintColor` + `opacity = 1.0`，没有模糊滤镜；带数值的
// `glowBlurRadius` / `setShadowBlurRadius:` 是辉光与窗口阴影，不是背景糊）。想要
// 比系统材质更强/可调数值的糊，得自己抓面板之下的画面自糊——那是另一条路（需屏幕
// 录制授权），不在这里叠材质绕过。
//
// 表面档由使用方指定：`.window`（主窗）与 `.panel`（迷你面板）。两条分支都上 tint，
// 但档位不同：液态玻璃自带亮度，tint 只往"近黑"拉一档（压死了又回到平色板，
// PITFALLS §4.27）；vibrancy 材质本身更浅，tint 才需要更实。
// `.panel` 只多一样：玻璃圆角对齐窗体自己的裁切档（见 panelCornerRadius）。
// 背景糊**只有玻璃这一层**——"再加一层窗内磨砂"试过两版（.hudWindow 材质、
// 与 Raycast BlurView 同参的默认材质）都被判"太实"（用户 2026-10-13），已删；
// 运行中的那道辉光在网页层（frontend 的 MiniRunningGlow），不必在这叠。

import AppKit

final class WindowGlassView: NSView {
    /// 表面档：同一条玻璃管线按使用方给不同 tint 值。Raycast 面板的配色层就是
    /// 这一条（玻璃之上按表面档上 tintColor）——面板窗整窗压在玻璃上，档位更深。
    enum Surface {
        /// 主窗：内容卡近实色兜底，玻璃只出边栏/边铬。
        case window
        /// 迷你面板：全窗口就是玻璃面（无内容卡兜底），tint 深一档。
        case panel
        /// 浮在迷你面板**页面之上**的原生玻璃件（命令中心卡、右上胶囊、输入框）：一块块
        /// 真的系统材质，由 `QuickPanelController` 按页面上报的矩形铺在 webview 之下。
        /// 这是"内容在 web、材质与铬件在原生"那条架构的落地处——网页那侧这些件不再自己画
        /// 背景/模糊/投影/圆角，圆角与尺寸由页面报数（`setRadius`），进场动画由壳跑
        /// （页面上报 token 时长）。命令中心卡多一层：它的内容在**第二块透明 webview**里，
        /// 玻璃垫在那块之下、面板页之上——同一块 webview 里玻璃只能垫在页面内容之下，
        /// 页面内容会盖在玻璃上（2026-10-13 用户报"面板透明啦"就是这么来的）。
        case floating
    }

    /// macOS 26+ 的液态玻璃底板；更早的系统为 nil（那时走 materialView + tintView）。
    private let glassView: NSView?
    /// vibrancy 底板（只在退回分支挂上来）。
    private let materialView = NSVisualEffectView()
    /// 材质之上的近黑 tint（只在退回分支挂上来）。不透明度对齐 tokens.json
    /// `color.surface.panel`（用途栏写明"面板/侧栏/窗口"，唯一事实源）。
    private let tintView = NSView()
    private let surface: Surface

    /// 退回分支（主窗档）：叠在 vibrancy 材质上的近黑 tint。
    private static let darkTint = NSColor(srgbRed: 14/255, green: 14/255, blue: 16/255, alpha: 0.62)
    private static let lightTint = NSColor(srgbRed: 255/255, green: 255/255, blue: 255/255, alpha: 0.72)
    /// 液态玻璃分支（主窗档）：玻璃自带亮度，tint 只往近黑拉。
    /// **调边栏深浅就动这里的 alpha**（0.35 → 0.50：用户 2026-09-29 两轮"还是有点透"，加了一档）。
    private static let darkGlassTint = NSColor(srgbRed: 14/255, green: 14/255, blue: 16/255, alpha: 0.50)
    private static let lightGlassTint = NSColor(srgbRed: 255/255, green: 255/255, blue: 255/255, alpha: 0.45)
    /// .panel 档的玻璃圆角：**必须等于窗体自己的裁切半径**。面板窗不在主窗那个
    /// 26pt 工具栏大圆角类里——实测（2026-10-13：截图 + 红绿灯 12pt/20pt 标准当
    /// 标尺，角部高光曲线最小二乘拟合 27.5px ÷ 2.30px/pt）面板可见圆角 ≈ 12pt。
    /// 给大了（曾设 26）玻璃高光会在角上被窗体裁断、留一道断线（用户："圆角修一下，
    /// 它现在有一个线"）；对齐后高光与边界重合，一圈干净。**改这个值前先重量一遍**
    /// （窗口类变了大圆角才会变）。
    /// 窗口自身的裁切档，**不在页内阶梯里**（量出来的 12pt，见 ShellDesign 的说明）。
    private static let panelCornerRadius: CGFloat = 12
    /// .panel 档（迷你面板）：整窗压在这层上、网页侧只铺半透明卡面，底层比
    /// 主窗实一截。α 落点：0.50 浅（用户"差一档"）→ 0.72 深（用户"颜色深了"
    /// 2026-10-13）→ 0.62 中间档；亮色同距回落。
    private static let darkPanelGlassTint = NSColor(srgbRed: 14/255, green: 14/255, blue: 16/255, alpha: 0.62)
    private static let lightPanelGlassTint = NSColor(srgbRed: 255/255, green: 255/255, blue: 255/255, alpha: 0.58)
    /// .floating 档：这些件浮在面板页面之上，比面板底**浅一档**（用户 2026-10-13 定稿"比桌面
    /// 板浅一点，至少浅一档"）。**调这类件的深浅就动这两个 alpha**：面板档 0.62 之下再压同样
    /// 的近黑就等于又一块面板，浮层感全没了；压太浅则页面正文透上来压不住（浮层正后是会话
    /// 正文，不是纯色底）。
    private static let darkCardGlassTint = NSColor(srgbRed: 14/255, green: 14/255, blue: 16/255, alpha: 0.46)
    private static let lightCardGlassTint = NSColor(srgbRed: 255/255, green: 255/255, blue: 255/255, alpha: 0.42)
    /// .floating 档的默认圆角（= theme.css 的 `radius.floating`/`--dsh-radius-floating` 20px）。
    /// 运行时由页面按实际渲染值覆盖（`setRadius`），这里只是构造那一刻的占位。
    private static let cardCornerRadius = ShellRadius.floating

    init(surface: Surface = .window) {
        self.surface = surface
        if #available(macOS 26.0, *) {
            glassView = Self.makeLiquidGlass(surface: surface)
        } else {
            glassView = nil
        }
        super.init(frame: .zero)
        if let glass = glassView {
            addFilling(glass)
        } else {
            materialView.material = .sidebar
            materialView.blendingMode = .behindWindow
            materialView.state = .active
            addFilling(materialView)
            tintView.wantsLayer = true
            addFilling(tintView)
            applyAppearance(light: false)
        }
        if surface == .floating { applyCardShadow() }
    }

    /// 浮层档的浮起投影，画在**玻璃那一层**上。数值对齐 theme.css 的 `--shadow-pop`
    /// （浮层那档），壳里不另立一套。
    ///
    /// 必须显式给 `shadowPath`：CALayer 的阴影只按本层**自己的内容**算形状，子层不计入，
    /// 而系统玻璃是画在它自己的内部层上的——不给路径就是"设了阴影但什么都没有"（这类
    /// 静默失效在 FrostSurface 的圆角注释里记过同型事故）。路径随尺寸/圆角走，见 `layout()`。
    private func applyCardShadow() {
        let target = (glassView ?? materialView) as NSView
        target.wantsLayer = true
        guard let layer = target.layer else { return }
        layer.shadowColor = NSColor.black.cgColor
        layer.shadowOpacity = 0.28
        layer.shadowRadius = 18
        layer.shadowOffset = CGSize(width: 0, height: -8)  // y-up：负值 = 向屏幕下方投
        refreshCardShadowPath()
    }

    /// 阴影路径 = 自己的圆角矩形（尺寸变了要跟着重算，否则影子还停在旧尺寸上）。
    private func refreshCardShadowPath() {
        guard surface == .floating, let layer = (glassView ?? materialView).layer else { return }
        let radius = (glassView as? NSGlassEffectView)?.cornerRadius ?? layer.cornerRadius
        layer.shadowPath = CGPath(
            roundedRect: bounds, cornerWidth: radius, cornerHeight: radius, transform: nil)
    }

    /// 浮层档：圆角由页面按**实际渲染的** border-radius 报来（`FrostSurface.setRadius` 同款
    /// 口径）——CSS 是那个值的事实源，壳里不写第二份（写死就会在改 token 时两边漂移）。
    func setRadius(_ radius: CGFloat) {
        // CSS 那边胶囊/输入框的圆角是 999px（"整圆"的写法），CALayer / CGPath 要的是真实
        // 半径：超过半个短边是退化值（玻璃可能整个不渲染、阴影路径也画不出来）。收敛到半短边。
        let limit = min(bounds.width, bounds.height) / 2
        let radius = limit > 0 ? min(radius, limit) : radius
        if #available(macOS 26.0, *), let glass = glassView as? NSGlassEffectView {
            glass.cornerRadius = radius
        } else {
            wantsLayer = true
            layer?.cornerRadius = radius
        }
        refreshCardShadowPath()
    }

    /// 尺寸由壳的放置逻辑改（卡片跟着页面报来的矩形走）：阴影路径必须跟着重算。
    override func layout() {
        super.layout()
        refreshCardShadowPath()
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    /// 亮/暗切换：液态玻璃换 `tintColor`，退回分支换叠在材质上的 tint。
    /// （材质 `.sidebar` 与液态玻璃本身都随 `window.appearance` 自适应，不手动分档。）
    func applyAppearance(light: Bool) {
        if #available(macOS 26.0, *), let glass = glassView as? NSGlassEffectView {
            glass.tintColor = glassTint(light: light)
        } else {
            tintView.layer?.backgroundColor = fallbackTint(light: light).cgColor
        }
    }

    /// 液态玻璃分支的 tint：窗档沿用 2026-09-29 验收档；面板档深一档。
    private func glassTint(light: Bool) -> NSColor {
        switch surface {
        case .window: return light ? Self.lightGlassTint : Self.darkGlassTint
        case .panel:  return light ? Self.lightPanelGlassTint : Self.darkPanelGlassTint
        case .floating: return light ? Self.lightCardGlassTint : Self.darkCardGlassTint
        }
    }

    /// 退回分支的 tint：面板窗同用主窗两档（该分支只服务 macOS 26 前的旧系统，
    /// 观感已按近黑收口，不另开档）。
    private func fallbackTint(light: Bool) -> NSColor {
        light ? Self.lightTint : Self.darkTint
    }

    /// 一块**浮动玻璃面**（标注工具条 / 选区工具条 / 状态 HUD / 工具条菜单共用）：
    /// 与 `.floating` 档同配方——`style = .regular` + 深色 tint（46%），不是往内容层刷
    /// 一层近乎不透明的底色（那样看着就是块实心板）。圆角由调用方按面的形状设。
    /// 本工程的部署目标就是 macOS 26，这条不设退回分支（沿用其它档的 `#available` 只是
    /// 历史遗留，不动它）。
    static func makeFloatingGlass() -> NSGlassEffectView {
        if #available(macOS 26.0, *) { return makeLiquidGlass(surface: .floating) }
        return NSGlassEffectView()
    }

    /// `NSGlassEffectView` 只有 macOS 26+ 可引用：构造与初始 tint 都收进这一个门。
    @available(macOS 26.0, *)
    private static func makeLiquidGlass(surface: Surface) -> NSGlassEffectView {
        let glass = NSGlassEffectView()
        glass.style = .regular
        // 圆角必须与窗体裁切同档：主窗是工具栏类大圆角（tokens.json v5 锚 26pt，
        // 玻璃给 0 由窗体裁）；迷你面板窗实测 ≈12pt（见 panelCornerRadius），
        // 玻璃对齐同值——给大了玻璃高光会被窗体裁断成一道线。
        switch surface {
        case .panel:
            glass.cornerRadius = panelCornerRadius
            glass.tintColor = darkPanelGlassTint
        case .floating:
            glass.cornerRadius = cardCornerRadius
            glass.tintColor = darkCardGlassTint
        case .window:
            glass.cornerRadius = 0   // 由窗体裁
            glass.tintColor = darkGlassTint
        }
        return glass
    }

    /// 铺满自己。autoresizingMask 让它在 AppKit 改 contentView 尺寸时跟上——本视图是
    /// 零 frame 构造后再交给 window.contentView 的，初始 bounds 为空，靠这个长满。
    private func addFilling(_ view: NSView) {
        view.frame = bounds
        view.autoresizingMask = [.width, .height]
        addSubview(view)
    }
}
