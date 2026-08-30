import AppKit

// Single-instance guard: two shells must never own one DSH_HOME (session
// persistence would interleave). A second launch pings the running instance
// through a distributed notification and exits.
_ = AppPaths.supportDir
let lockPath = AppPaths.supportDir.appendingPathComponent("instance.lock").path
let lockFD: Int32 = open(lockPath, O_CREAT | O_RDWR, 0o644)
if lockFD >= 0, flock(lockFD, LOCK_EX | LOCK_NB) != 0 {
    DistributedNotificationCenter.default().post(
        name: Notification.Name("com.dshmini.app.show"),
        object: nil
    )
    exit(0)
}
_ = lockFD // intentionally held for the app's lifetime

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.run()
