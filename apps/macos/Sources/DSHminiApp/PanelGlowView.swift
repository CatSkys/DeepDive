// 迷你面板的边缘内辉光（Raycast `glowBlurRadius` 的对应物，一版实现）：贴着面板
// 内缘画一道向内渐隐的柔光。只管画这一件事；由 WindowGlassView 挂在玻璃之上、
// WebView 之下。宽度与强度是下面两个常量（Raycast 那边的具体取值与落点还在挖，
// 这两个数先按观感给起始档，改一处即可调）。
//
// 画法：同心圆角矩形描边、逐层降透明度叠加——等价于对描边做一次高斯模糊，但不引
// 滤镜、开销固定、而且"模糊半径"就是光带宽度这个可直接读的数。

import AppKit

final class PanelGlowView: NSView {
    /// 光带宽度（pt）——辉光的"模糊半径"。
    static let radius: CGFloat = 14
    /// 贴边最亮处的透明度：辉光只提边缘、不抬整体，给得很轻。
    static let peakAlpha: CGFloat = 0.09

    /// 与窗体裁切同档的圆角（构造时由 WindowGlassView 传入，见 panelCornerRadius）。
    private let cornerRadius: CGFloat

    init(cornerRadius: CGFloat) {
        self.cornerRadius = cornerRadius
        super.init(frame: .zero)
        // 尺寸变化时要重画：光带是按 bounds 现算的，不重画会残留旧宽度的环。
        wantsLayer = true
        layer?.needsDisplayOnBoundsChange = true
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    // 不接事件：玻璃与 WebView 都叠在它上面，辉光只出像素。
    override func hitTest(_ point: NSPoint) -> NSView? { nil }

    override func draw(_ dirtyRect: NSRect) {
        guard let ctx = NSGraphicsContext.current?.cgContext else { return }
        let steps = max(1, Int(Self.radius))
        ctx.setLineWidth(1.5)
        for step in 0..<steps {
            let t = CGFloat(step) / CGFloat(steps)          // 0 = 贴边，1 = 光带内缘
            let inset = t * Self.radius + 0.75
            let rect = bounds.insetBy(dx: inset, dy: inset)
            guard rect.width > 1, rect.height > 1 else { return }
            // 二次衰减：贴边最亮、向内迅速柔和收掉（线性衰减会看出"环"）。
            let alpha = Self.peakAlpha * pow(1 - t, 2)
            ctx.setStrokeColor(NSColor.white.withAlphaComponent(alpha).cgColor)
            let radius = max(0, cornerRadius - inset)
            ctx.addPath(CGPath(roundedRect: rect, cornerWidth: radius, cornerHeight: radius, transform: nil))
            ctx.strokePath()
        }
    }
}
