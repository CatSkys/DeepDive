// 空闲休眠断言：自动化页「运行会话时保持电脑唤醒」的壳侧落点——有会话在跑时
// 别让 Mac 睡过去，否则到点的任务只能等下次唤醒。只管空闲休眠，合盖与手动
// 休眠不拦（那是用户明示）。前端按「开关 ∧ 有会话在跑」推 on/off，本类幂等。

import Foundation

enum KeepAwake {
    private static var token: NSObjectProtocol?

    /// 幂等：true 按住（已按住不重复申请），false 释放。
    static func set(_ on: Bool) {
        if on, token == nil {
            token = ProcessInfo.processInfo.beginActivity(
                options: [.idleSystemSleepDisabled, .userInitiated],
                reason: "DeepDive: session running (keep awake enabled)",
            )
        } else if !on, let held = token {
            ProcessInfo.processInfo.endActivity(held)
            token = nil
        }
    }
}
