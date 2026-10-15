// 通用子进程执行器（唯一实现）：起进程、两侧管道都排空、可选超时、回收输出与退出码。
//
// 纪律照 PITFALLS §4.11：磁盘/子进程 IO 一律后台队列，且**两侧管道都要排空且不能顺序读**
//（顺序读有互锁面：一侧写满 64KB 缓冲会让子进程阻塞，另一侧 EOF 永不到）。所以两个读
// 线程 + 一个退出信号量，谁都不等谁。
//
// `run` 是**同步阻塞**的：调用点必须在后台队列（gitRun / agentRun / 工作树一族都是）。
// 时间上限到点即 terminate——外部 CLI 卡死不能把整条链路挂住。

import Foundation

enum ProcessRunner {
    struct Result {
        var status: Int32
        /// stdout + stderr（stderr 另起一行接在后面，调用方不需要分辨管道）。
        var output: String
        /// 到点被杀（status 此时无意义）。
        var timedOut: Bool
    }

    static func run(
        executable: String,
        arguments: [String],
        workingDirectory: String? = nil,
        timeout: TimeInterval? = nil,
    ) -> Result {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: executable)
        process.arguments = arguments
        if let workingDirectory { process.currentDirectoryURL = URL(fileURLWithPath: workingDirectory) }
        let outPipe = Pipe()
        let errPipe = Pipe()
        process.standardOutput = outPipe
        process.standardError = errPipe
        do {
            try process.run()
        } catch {
            return Result(status: -1, output: error.localizedDescription, timedOut: false)
        }

        let lock = NSLock()
        var outText = ""
        var errText = ""
        Thread.detachNewThread {
            let data = outPipe.fileHandleForReading.readDataToEndOfFile()
            lock.lock(); outText = String(data: data, encoding: .utf8) ?? ""; lock.unlock()
        }
        Thread.detachNewThread {
            let data = errPipe.fileHandleForReading.readDataToEndOfFile()
            lock.lock(); errText = String(data: data, encoding: .utf8) ?? ""; lock.unlock()
        }

        let exited = DispatchSemaphore(value: 0)
        process.terminationHandler = { _ in exited.signal() }
        var timedOut = false
        if let timeout {
            if exited.wait(timeout: .now() + timeout) == .timedOut {
                timedOut = true
                process.terminate()
                _ = exited.wait(timeout: .now() + 2)
            }
        } else {
            process.waitUntilExit()
        }

        lock.lock()
        var output = outText
        if !errText.isEmpty { output += outText.isEmpty ? errText : "\n\(errText)" }
        lock.unlock()
        return Result(status: process.terminationStatus, output: output, timedOut: timedOut)
    }
}
