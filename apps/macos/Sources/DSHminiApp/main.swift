import AppKit

// Single-instance guard: two shells must never own one DSH_HOME (session
// persistence would interleave). A second launch pings the running instance
// through a distributed notification and exits.
LegacyPrefsMigration.run()
_ = AppPaths.supportDir
let lockPath = AppPaths.supportDir.appendingPathComponent("instance.lock").path
// O_CLOEXEC：锁不泄给引擎/git 子进程——壳退出后残留的子进程会占住单实例锁
let lockFD: Int32 = open(lockPath, O_CREAT | O_RDWR | O_CLOEXEC, 0o644)

/// 取锁：上一实例退出要等引擎收尾（stop() 的宽限期），这段时间锁还握着——
/// 旧的"一次 LOCK_NB 失败就 exit(0)"会把"刚退出就想再开"的启动静默吃掉
///（用户看到的是"点了没反应"）。所以先等一小会儿，再放弃。
func acquireLock(fd: Int32, timeout: TimeInterval) -> Bool {
    let deadline = Date().addingTimeInterval(timeout)
    repeat {
        if flock(fd, LOCK_EX | LOCK_NB) == 0 { return true }
        if errno != EWOULDBLOCK { return false }
        usleep(100_000)
    } while Date() < deadline
    return false
}

if lockFD < 0 {
    // 守卫失效必须可见（AUD-039）：静默放行第二实例会共用 DSH_HOME，会话写入交错
    fputs("DeepDive: cannot open instance lock \(lockPath): \(String(cString: strerror(errno)))\n", stderr)
} else if !acquireLock(fd: lockFD, timeout: 5) {
    // 已有实例在跑：请它显身（它自己处理"置前主窗"），本次启动到此为止。
    DistributedNotificationCenter.default().post(
        name: Notification.Name("com.deepdive.app.show"),
        object: nil
    )
    exit(0)
}
_ = lockFD // intentionally held for the app's lifetime

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.run()
