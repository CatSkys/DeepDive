import AppKit

// 品牌标记（实心 D 剪影）：悬浮球中央图形与菜单栏状态图共用。管什么：剪影 path、
// SVG→NSImage 渲染、菜单栏模板图（含状态点）；不管什么：状态推导（FloatingBubbleManager）
// 与状态环的绘制。path 逐字取自 design/logo/（`?path=1`），改配方时同步。
/// The DeepDive mark — solid D: rounded handle + semicircular bowl, original
/// geometry. Silhouette path and its square box come from `design/logo/`
/// (`?path=1`); re-paste both when the recipe changes.
/// NSImage renders SVG natively (macOS 11+); the fill is forced white so the
/// mark reads as a monochrome silhouette on the dark circle.
enum BrandMark {
    static let markPath = "M 82.21 0 L 360.16 0 A 368.64 368.64 0 0 1 360.16 737.28 L 82.21 737.28 A 73.73 73.73 0 0 1 8.48 663.55 L 8.48 73.73 A 73.73 73.73 0 0 1 82.21 0 Z"

    static var image: NSImage {
        if let cached = cached { return cached }
        let svg = """
        <svg xmlns="http://www.w3.org/2000/svg" width="737.28" height="737.28" \
        viewBox="0 0 737.28 737.28" fill="none"><path fill="#FFFFFF" d="\(markPath)"/></svg>
        """
        let img = NSImage(data: Data(svg.utf8)) ?? NSImage()
        cached = img
        return img
    }

    private static var cached: NSImage?

    /// Menu-bar glyph (user decision: same mark as the bubble, not sparkles).
    /// Template image — the system recolors it for light/dark menu bars via
    /// the alpha channel. State rides as a small top-right marker:
    /// attention = filled dot (wins), running = hollow dot, idle = mark only.
    static func statusIcon(running: Bool, attention: Bool) -> NSImage {
        let side: CGFloat = 18
        let glyph: CGFloat = 14      // 字形 14pt 居中：满 18pt 时实心 D 比旁边的线性图标显得重
        let img = NSImage(size: NSSize(width: side + 4, height: side))
        img.lockFocus()
        let inset = 1 + (side - glyph) / 2
        image.draw(in: NSRect(x: inset, y: inset, width: glyph, height: glyph),
                   from: .zero, operation: .sourceOver, fraction: 1)
        let marker = NSBezierPath(ovalIn: NSRect(x: side - 1, y: side - 4, width: 5, height: 5))
        if attention {
            NSColor.black.setFill()
            marker.fill()
        } else if running {
            NSColor.black.setStroke()
            marker.lineWidth = 1.2
            marker.stroke()
        }
        img.unlockFocus()
        img.isTemplate = true
        return img
    }
}
