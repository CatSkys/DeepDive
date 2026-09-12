// 「打开方式」候选目录（全屏预览页右上选择器的数据源）：能打开某个文件的
// App 列表 + 默认 App + 各自的图标（PNG dataURL，走桥给前端，前端不碰
// AppKit）。只做「NSWorkspace 的事实 → 可桥接 JSON」这一件事；谁展示、
// 选哪个、选完记不记得住，都由前端决定。

import AppKit

enum OpenWithCatalog {
    /// 单个候选；id = .app 绝对路径（壳侧用它调 NSWorkspace 打开）。
    struct App: Equatable {
        let id: String
        let name: String
        /// `data:image/png;base64,…`
        let icon: String
    }

    struct Listing: Equatable {
        let apps: [App]
        let defaultId: String
    }

    /// 上限：够用且不让一次桥包过大（每个图标 ~4KB base64）。
    static let limit = 24
    /// 图标位图边长（px）：按 24pt @2x 渲染留足，前端显示 15–20pt。
    static let iconSize = 48

    /// 文件不存在/无法枚举（无 App 能打开）时回 nil——调用方按「无候选」降级。
    static func listing(forPath path: String) -> Listing? {
        let fileURL = URL(fileURLWithPath: path)
        guard FileManager.default.fileExists(atPath: fileURL.path) else { return nil }
        let candidates = NSWorkspace.shared.urlsForApplications(toOpen: fileURL)
        guard !candidates.isEmpty else { return nil }
        let apps = candidates.prefix(limit).compactMap { url -> App? in
            guard let icon = iconDataURL(forAppAt: url.path) else { return nil }
            return App(id: url.path, name: displayName(ofAppAt: url, fallback: url), icon: icon)
        }
        guard !apps.isEmpty else { return nil }
        let defaultId = NSWorkspace.shared.urlForApplication(toOpen: fileURL)?.path ?? apps[0].id
        return Listing(apps: apps, defaultId: defaultId)
    }

    /// 桥载荷形状（与 frontend/src/host.ts 的 OpenWithListing 对齐）。
    static func payload(_ listing: Listing, reqId: String) -> [String: Any] {
        [
            "reqId": reqId,
            "defaultId": listing.defaultId,
            "apps": listing.apps.map { ["id": $0.id, "name": $0.name, "icon": $0.icon] },
        ]
    }

    /// App 显示名：本地化名优先，其次包名，最后文件名。
    private static func displayName(ofAppAt url: URL, fallback: URL) -> String {
        let bundle = Bundle(url: url)
        let info = bundle?.infoDictionary
        let localized = (info?["CFBundleDisplayName"] as? String) ?? (info?["CFBundleName"] as? String)
        if let localized, !localized.isEmpty { return localized }
        return fallback.deletingPathExtension().lastPathComponent
    }

    /// App 图标 → 定长 PNG dataURL。渲染失败（无图标/位图上下文不可用）回 nil，
    /// 该候选直接剔除——不拿空图标冒充。
    private static func iconDataURL(forAppAt path: String, size: Int = iconSize) -> String? {
        let image = NSWorkspace.shared.icon(forFile: path)
        guard image.size.width > 0 else { return nil }
        guard let rep = NSBitmapImageRep(
            bitmapDataPlanes: nil, pixelsWide: size, pixelsHigh: size,
            bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false,
            colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0,
        ) else { return nil }
        NSGraphicsContext.saveGraphicsState()
        NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
        image.draw(in: NSRect(x: 0, y: 0, width: size, height: size), from: .zero, operation: .copy, fraction: 1)
        NSGraphicsContext.restoreGraphicsState()
        guard let png = rep.representation(using: .png, properties: [:]) else { return nil }
        return "data:image/png;base64,\(png.base64EncodedString())"
    }
}
