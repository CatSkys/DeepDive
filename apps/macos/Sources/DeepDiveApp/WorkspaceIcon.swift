import Foundation

// 工作空间图标探测（侧栏底部空间格缩略图，用户需求）：按约定文件名在项目
// 根目录找图标/标志图。只扫根目录一层、只认常见命名——不做递归猜测，避免
// 误读无关大图。找不到/空文件/超限返回 nil，前端回落项目首字母。

enum WorkspaceIcon {
    /// 探测顺序即优先级：icon.* > logo.* > favicon.*。
    static let candidates: [(name: String, mime: String)] = [
        ("icon.png", "image/png"),
        ("logo.png", "image/png"),
        ("favicon.png", "image/png"),
        ("icon.svg", "image/svg+xml"),
        ("logo.svg", "image/svg+xml"),
        ("favicon.ico", "image/x-icon"),
        ("icon.jpg", "image/jpeg"),
        ("logo.jpg", "image/jpeg"),
    ]
    /// 单文件读取上限：空间格只有 ~18px，超限视为误放的大图不读。
    static let maxBytes = 512 * 1024

    static func probe(in directory: URL) -> (data: Data, mime: String)? {
        for candidate in candidates {
            let url = directory.appendingPathComponent(candidate.name)
            guard let data = try? Data(contentsOf: url), !data.isEmpty, data.count <= maxBytes else { continue }
            return (data, candidate.mime)
        }
        return nil
    }
}
