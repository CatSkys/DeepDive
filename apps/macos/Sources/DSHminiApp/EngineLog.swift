import Foundation

/// Ring buffer of engine stdout/stderr plus an append-only log file.
final class EngineLog {
    static let shared = EngineLog()

    private let lock = NSLock()
    private var lines: [String] = []
    private let maxLines = 400
    private var fileHandle: FileHandle?

    private init() {
        let path = AppPaths.logURL.path
        if !FileManager.default.fileExists(atPath: path) {
            FileManager.default.createFile(atPath: path, contents: nil)
        }
        fileHandle = try? FileHandle(forWritingTo: AppPaths.logURL)
        fileHandle?.seekToEndOfFile()
    }

    func append(_ line: String) {
        lock.lock()
        defer { lock.unlock() }
        lines.append(line)
        if lines.count > maxLines {
            lines.removeFirst(lines.count - maxLines)
        }
        if let data = (line + "\n").data(using: .utf8) {
            try? fileHandle?.write(contentsOf: data)
        }
    }

    var tailText: String {
        lock.lock()
        defer { lock.unlock() }
        return lines.joined(separator: "\n")
    }
}
