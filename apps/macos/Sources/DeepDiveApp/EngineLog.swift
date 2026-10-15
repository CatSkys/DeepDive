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

    // 磁盘写入合成批：append 是进程级热路径（每一行引擎 stdout / 每条桥消息都过
    // 这里），逐行走 ns 写盘 = 每行一次 syscall。攒批延后落盘（FLUSH_INTERVAL_MS
    // 或 FLUSH_FLUSH_BYTES 触发），ring（tailText 的内存真值）仍逐行更新——失败面
    // 的日志尾读的是内存那份，不受延迟影响。
    private var pendingWrite = Data()
    private var flushWorkItem: DispatchWorkItem?
    private static let flushIntervalMs = 300
    /// 攒到一个大包就立刻写，不给定时器攒。
    private static let flushBytes = 64 * 1024

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
            pendingWrite.append(data)
            if pendingWrite.count >= Self.flushBytes {
                flushLocked()
            } else {
                scheduleFlushLocked()
            }
        }
    }

    /// 立刻把未落盘的尾巴写出去（应用终止前收口，少这颗会丢最后 300ms）。
    func flushNow() {
        lock.lock()
        defer { lock.unlock() }
        flushWorkItem?.cancel()
        flushWorkItem = nil
        flushLocked()
    }

    /// 持锁调用：把 pendingWrite 落盘（夹带 rotate 检查）。
    private func flushLocked() {
        let data = pendingWrite
        pendingWrite = Data()
        guard !data.isEmpty else { return }
        rotateIfNeeded(adding: data.count)
        try? fileHandle?.write(contentsOf: data)
        fileBytes += data.count
    }

    /// 持锁调用：首个挂起字节出现时排一次定时落盘（后续 append 只续包）。
    private func scheduleFlushLocked() {
        guard pendingWrite.count > 0, flushWorkItem == nil else { return }
        let item = DispatchWorkItem { [weak self] in
            guard let self else { return }
            self.lock.lock()
            self.flushWorkItem = nil
            self.flushLocked()
            self.lock.unlock()
        }
        flushWorkItem = item
        DispatchQueue.global(qos: .utility).asyncAfter(
            deadline: .now() + Double(Self.flushIntervalMs) / 1000.0, execute: item)
    }

    /// 超上限时把文件截成后半：从中点向后找行边界切（开头不留半行乱码），
    /// 原子重写并重开句柄（原子写是 rename，旧句柄已指向被替换的 inode）。
    /// 重写失败则维持原文件继续追加，只丢截断不丢日志。
    /// 持锁调用（flushLocked 内）。
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
