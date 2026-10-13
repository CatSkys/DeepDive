import Foundation
import QuartzCore

/// 壳侧动效值（原生独有的那几条，唯一一处定义）。
///
/// 网页侧的动效词汇在 `theme.css` 的 `:root`（`--dur-fast/-med/-slow` + 两条曲线），
/// 页面把用到的那档报给壳（`QuickPanelController.cardMotion` 收的就是 `--dur-fast` 口径）。
/// 但**原生自己的窗口显隐与浮窗进出场**在网页侧没有对应变量——此前这些数散在两个控制器
/// 与 `TooltipWindow` 里各写一份（主窗与快捷面板的 0.12/0.10 就是一式两份）。归到这里一处，
/// 节奏与网页同一套：**进场慢、退场快**（快出慢入）。
enum ShellMotion {
  /// 窗口显隐（主窗 / 快捷面板）。
  static let windowShow: TimeInterval = 0.12
  static let windowHide: TimeInterval = 0.10

  /// 浮窗进出场（悬浮注释窗）。入场尾端一点过冲，退场更快。
  static let popupEnter: TimeInterval = 0.25
  static let popupExit: TimeInterval = 0.15

  /// 入场过冲曲线：ease-out-back，与网页 `--ease-spring` 同形（`UI-SPEC §1.7` 的两条招牌曲线之一）。
  static var popupCurve: CAMediaTimingFunction {
    CAMediaTimingFunction(controlPoints: 0.34, 1.56, 0.64, 1)
  }
}
