// 窗口的底：只负责"窗口底板玻璃"这一件事，坐在所有内容之下（它是 window.contentView，
// 其他视图都叠在它上面）。布局、命中测试、拖拽都不归它管。
//
// macOS 26+ 用 Liquid Glass（`NSGlassEffectView`）——这是系统给"自定义玻璃表面"的正式
// API，也是本应用唯一拿得到液态玻璃的路径：整个界面画在透明 WKWebView 里，不是标准
// AppKit 控件，走不到"系统自动给标准控件发放"那条路。更早的系统退回 vibrancy 材质
// （`NSVisualEffectView` + 近黑 tint），两边观感不同但职责相同。
//
// 表面档由使用方指定：`.window`（主窗）与 `.panel`（迷你面板）。两条分支都上 tint，
// 但档位不同：液态玻璃自带亮度，tint 只往"近黑"拉一档（压死了又回到平色板，
// PITFALLS §4.27）；vibrancy 材质本身更浅，tint 才需要更实。

import AppKit

final class WindowGlassView: NSView {
    /// 表面档：同一条玻璃管线按使用方给不同 tint 值。Raycast 面板的配色层就是
    /// 这一条（玻璃之上按表面档上 tintColor）——面板窗整窗压在玻璃上，档位更深。
    enum Surface {
        /// 主窗：内容卡近实色兜底，玻璃只出边栏/边铬。
        case window
        /// 迷你面板：全窗口就是玻璃面（无内容卡兜底），tint 深一档。
        case panel
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
    /// .panel 档（迷你面板）：整窗压在这层上、网页侧只铺半透明卡面，底层要比
    /// 主窗再实一截，壁纸才只留糊开的色块（用户 2026-10-13 "还要暗一些"）。
    private static let darkPanelGlassTint = NSColor(srgbRed: 14/255, green: 14/255, blue: 16/255, alpha: 0.72)
    private static let lightPanelGlassTint = NSColor(srgbRed: 255/255, green: 255/255, blue: 255/255, alpha: 0.66)

    init(surface: Surface = .window) {
        self.surface = surface
        if #available(macOS 26.0, *) {
            glassView = Self.makeLiquidGlass()
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
        }
    }

    /// 退回分支的 tint：面板窗同用主窗两档（该分支只服务 macOS 26 前的旧系统，
    /// 观感已按近黑收口，不另开档）。
    private func fallbackTint(light: Bool) -> NSColor {
        light ? Self.lightTint : Self.darkTint
    }

    /// `NSGlassEffectView` 只有 macOS 26+ 可引用：构造与初始 tint 都收进这一个门。
    @available(macOS 26.0, *)
    private static func makeLiquidGlass() -> NSGlassEffectView {
        let glass = NSGlassEffectView()
        glass.style = .regular
        glass.cornerRadius = 0
        glass.tintColor = darkGlassTint
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
