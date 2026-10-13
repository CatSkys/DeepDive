// 迷你面板窗底的"实景底图"层（Raycast 第 1 层 WallpaperImageView 的移植）：
// 读所在屏的壁纸文件，按窗体在屏上的位置裁出对应区域，高斯模糊后铺在玻璃之下
// ——玻璃采样这层图而不是锐利桌面，模糊半径由我们自己定（系统 NSGlassEffectView
// 的模糊量没有旋钮，Raycast 的 BlurView/glowBlurRadius 也是它自家封装）。
// 只管出图与铺图；何时刷新（召唤/换屏/改尺寸）由 QuickPanelController 调。
// 壁纸读不到（纯色桌面/异向屏）→ 留空：玻璃直接采样桌面，等于无底图档——
// 显式降级，不铺兜底色。

import AppKit
import CoreImage

final class PanelWallpaperView: NSImageView {
    /// 模糊半径（pt）：120（Raycast 大环境三档顶档）仍不够（用户 2026-10-13
    /// 对照后），上到 160。颜色落点已定稿勿动（只动这一个常量）。
    private static let blurRadius: CGFloat = 160
    /// 出图位图密度（pt→px）：2× 让 retina 下糊斑仍有细腻过渡。
    private static let bitmapScale: CGFloat = 2
    private static let ciContext = CIContext(options: [.cacheIntermediates: false])

    /// 指纹（屏 | 壁纸文件 | 窗框）：全同就复用上次的图，不重糊。
    private var fingerprint = ""
    private let workQueue = DispatchQueue(label: "deepdive.panel-wallpaper", qos: .utility)

    override init(frame frameRect: NSRect) {
        super.init(frame: frameRect)
        imageScaling = .scaleProportionallyUpOrDown
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    // 不接事件：玻璃和 WebView 都叠在它上面，底图只出像素。
    override func hitTest(_ point: NSPoint) -> NSView? { nil }

    /// 按窗框在屏上的位置重出底图：异步出图回主线程换；等待期间指纹再变
    /// （新一次 refresh 已排上）就作废旧结果。
    func refresh(for window: NSWindow, screen: NSScreen) {
        let wallpaperURL = NSWorkspace.shared.desktopImageURL(for: screen)
        let frame = window.frame
        let newFingerprint = [
            screen.localizedName,
            wallpaperURL?.absoluteString ?? "no-wallpaper",
            "\(Int(frame.minX))", "\(Int(frame.minY))",
            "\(Int(frame.width))", "\(Int(frame.height))",
        ].joined(separator: "|")
        guard newFingerprint != fingerprint else { return }
        fingerprint = newFingerprint
        workQueue.async { [weak self] in
            let image = Self.makeBlurredWallpaper(screen: screen, windowFrame: frame)
            DispatchQueue.main.async {
                guard let self, self.fingerprint == newFingerprint else { return }
                self.image = image
            }
        }
    }

    /// 壁纸 → 裁窗区 → 高斯模糊。任何一步不可得返回 nil（上层留空）。
    // 裁切按 cover 撑满居中近似（macOS 桌面默认填充档）；"适合屏幕"档或异向屏
    // 色场会偏一截，糊开一层后不可辨，不另适配。
    private static func makeBlurredWallpaper(screen: NSScreen, windowFrame: NSRect) -> NSImage? {
        guard let wallpaperURL = NSWorkspace.shared.desktopImageURL(for: screen),
              let wallpaper = NSImage(contentsOf: wallpaperURL),
              let cg = wallpaper.cgImage(forProposedRect: nil, context: nil, hints: nil)
        else { return nil }
        let imageW = CGFloat(cg.width), imageH = CGFloat(cg.height)
        // 壁纸按 cover 撑满居中：cover = 每屏 pt 对应的图 px；据此把窗框换算成图内裁剪区。
        let cover = max(screen.frame.width / imageW, screen.frame.height / imageH)
        let shownOriginX = screen.frame.midX - imageW * cover / 2
        let shownOriginY = screen.frame.midY - imageH * cover / 2
        var crop = CGRect(
            x: (windowFrame.minX - shownOriginX) / cover,
            y: (windowFrame.minY - shownOriginY) / cover,
            width: windowFrame.width / cover,
            height: windowFrame.height / cover
        ).intersection(CGRect(x: 0, y: 0, width: imageW, height: imageH))
        guard !crop.isNull, crop.width >= 1, crop.height >= 1 else { return nil }

        var ci = CIImage(cgImage: cg).cropped(to: crop)
            .transformed(by: CGAffineTransform(translationX: -crop.minX, y: -crop.minY))
        // 出图压到窗尺寸 × 位图密度再糊——全尺寸壁纸上做百 px 级高斯太贵。
        let outW = windowFrame.width * bitmapScale
        let outH = windowFrame.height * bitmapScale
        if let scaleFilter = CIFilter(name: "CILanczosScaleTransform") {
            scaleFilter.setValue(ci, forKey: kCIInputImageKey)
            scaleFilter.setValue(outW / crop.width, forKey: kCIInputScaleKey)
            if let scaled = scaleFilter.outputImage { ci = scaled }
        }
        // 先钳边再糊：高斯会把裁剪缘外的透明卷进来、四周发黑边；糊完裁回目标矩形。
        var out = ci.clampedToExtent()
        if let blurFilter = CIFilter(name: "CIGaussianBlur") {
            blurFilter.setValue(out, forKey: kCIInputImageKey)
            blurFilter.setValue(blurRadius * bitmapScale, forKey: kCIInputRadiusKey)
            if let blurred = blurFilter.outputImage { out = blurred }
        }
        out = out.cropped(to: CGRect(x: 0, y: 0, width: outW, height: outH))
        guard let rendered = ciContext.createCGImage(out, from: out.extent) else { return nil }
        return NSImage(cgImage: rendered, size: NSSize(width: windowFrame.width, height: windowFrame.height))
    }
}
