import Foundation

/// Ring buffer of engine stdout/stderr plus a size-capped log file.
final class EngineLog {
    static let shared = EngineLog()

    private let lock = NSLock()
    private var lines: [String] = []
    private let maxLines = 400
    /// 追加前检查的文件上限；超限截断保留后半（AUD-078，自管不引依赖）。
    private static let maxFileBytes = 2 * 1024 * 1024
    private var fileHandle: FileHandle?
    /// 当前文件字节数（追加累计；初始化为已有文件的尾部偏移）。
    private var fileBytes = 0

    private init() {
        let path = AppPaths.logURL.path
        if !FileManager.default.fileExists(atPath: path) {
            FileManager.default.createFile(atPath: path, contents: nil)
        }
        fileHandle = try? FileHandle(forWritingTo: AppPaths.logURL)
        fileBytes = Int(fileHandle?.seekToEndOfFile() ?? 0)
    }

    func append(_ line: String) {
        lock.lock()
        defer { lock.unlock() }
        lines.append(line)
        if lines.count > maxLines {
            lines.removeFirst(lines.count - maxLines)
        }
        if let data = (line + "\n").data(using: .utf8) {
            rotateIfNeeded(adding: data.count)
            try? fileHandle?.write(contentsOf: data)
            fileBytes += data.count
        }
    }

    /// 超上限时把文件截成后半：从中点向后找行边界切（开头不留半行乱码），
    /// 原子重写并重开句柄（原子写是 rename，旧句柄已指向被替换的 inode）。
    /// 重写失败则维持原文件继续追加，只丢截断不丢日志。
    private func rotateIfNeeded(adding: Int) {
        guard fileBytes + adding > Self.maxFileBytes,
              let full = try? Data(contentsOf: AppPaths.logURL) else { return }
        let bytes = [UInt8](full)
        var split = bytes.count / 2
        while split < bytes.count, bytes[split] != 0x0A { split += 1 }
        if split < bytes.count { split += 1 } // 跳过切点换行，从下一行行首保留
        let tail = Data(bytes[split...])
        try? tail.write(to: AppPaths.logURL, options: .atomic)
        fileHandle = try? FileHandle(forWritingTo: AppPaths.logURL)
        fileHandle?.seekToEndOfFile()
        fileBytes = tail.count
    }

    var tailText: String {
        lock.lock()
        defer { lock.unlock() }
        return lines.joined(separator: "\n")
    }
}
