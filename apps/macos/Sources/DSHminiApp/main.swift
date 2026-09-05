import AppKit

// Single-instance guard: two shells must never own one DSH_HOME (session
// persistence would interleave). A second launch pings the running instance
// through a distributed notification and exits.
LegacyPrefsMigration.run()
_ = AppPaths.supportDir
let lockPath = AppPaths.supportDir.appendingPathComponent("instance.lock").path
// O_CLOEXEC：锁不泄给引擎/git 子进程——壳退出后残留的子进程会占住单实例锁
let lockFD: Int32 = open(lockPath, O_CREAT | O_RDWR | O_CLOEXEC, 0o644)
if lockFD < 0 {
    // 守卫失效必须可见（AUD-039）：静默放行第二实例会共用 DSH_HOME，会话写入交错
    fputs("DeepDive: cannot open instance lock \(lockPath): \(String(cString: strerror(errno)))\n", stderr)
} else if flock(lockFD, LOCK_EX | LOCK_NB) != 0 {
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
