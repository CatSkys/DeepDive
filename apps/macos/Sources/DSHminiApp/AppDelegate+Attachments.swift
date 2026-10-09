// AppDelegate 的附件摄入面：＋ 选择器与**拖入**共用同一份载荷构造。
//
// 为什么路径要在壳里取：拖放板上只有壳看得见 file:// URL（文件和文件夹都在），DOM 那侧
// WebKit 只把 `["Files"]` 暴露给页面（PITFALLS §4.38）。所以"拖进来的是什么"由壳读拖放板
// （`TitlebarAwareWebView.performDragOperation`）→ 这里组装 → `hostFilesDropped` 推给 SPA。
//
// 载荷形状与选择器（`pickedAttachments`）完全一致：path/name/isDir，**图片**另附 base64
// （≤ 内联上限）；其余一律只有路径——它们在 SPA 侧是 @ 引用，没有大小上限。
// 投递那条线（`deliverDroppedAttachments`）留在 AppDelegate.swift：它要碰私有控制器。

import Foundation

extension AppDelegate {
    /// 选择器与拖入共用的载荷：路径/名字/是否目录，**图片**另附 base64（≤ 上限）。
    /// 非图片一律不带字节——它们在 SPA 侧是 @ 引用（引擎宿主读盘），没有大小上限，
    /// 也就不该在这里给用户一个"太大"的死路。
    static func attachmentItems(for urls: [URL]) -> [[String: Any]] {
        urls.map { url in
            let isDir = (try? url.resourceValues(forKeys: [.isDirectoryKey]))?.isDirectory ?? false
            var item: [String: Any] = [
                "path": url.path,
                "name": url.lastPathComponent,
                "isDir": isDir,
            ]
            let isImage = !isDir && imageExtensions.contains(url.pathExtension.lowercased())
            if isImage, let data = try? Data(contentsOf: url), data.count <= maxInlineImageBytes {
                item["isImage"] = true
                item["base64"] = data.base64EncodedString()
            }
            return item
        }
    }

    /// 随消息直传的**图片**字节上限：等于桥的单请求上限（`MiniHTTPServer.maxBodyBytes`，
    /// 超了回 413）——超了就不附字节，SPA 会把它当普通文件转 @ 引用（引擎自行读盘），
    /// 所以这里只影响"能不能内联给模型看"，不会让附件发不出去。
    private static let maxInlineImageBytes = 32 * 1024 * 1024

    /// 与引擎 imageLimits 准入的媒体类型对齐（png/jpeg/webp/gif）。
    private static let imageExtensions: Set<String> = ["png", "jpg", "jpeg", "webp", "gif"]
}
