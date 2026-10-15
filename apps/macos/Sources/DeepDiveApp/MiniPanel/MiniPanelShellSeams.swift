import AppKit

// 迷你面板移植自 Atd（授权复制）后缺的壳侧缝隙：命令卡数据类型、拖拽类型、
// 导入失败镜像、闭包菜单项。文案表与通用缝隙在 Support/ShellSeams.swift（三者共用）。

/// 本应用自产拖拽会话的私有 pasteboard 类型（adapted：Atd DesktopPinDrag.pasteboardType，
/// 拖放监视用来排除自家 pin 的拖拽）。DeepDive 目前没有自产拖拽源——位子先留给
/// 将来的截图/pin 拖拽，自家窗口发起的拖拽将来标这个类型。
enum DeepDiveDrag {
  static let pasteboardType = NSPasteboard.PasteboardType("com.deepdive.desktop-pin-drag")
}

/// 快捷会话命令卡的命令条目（adapted：Atd BridgeCalls2 的 MiniPanelSetCommandsParams.
/// Command，字段形状保持 id/name；DeepDive 不走他们的 BridgeCoding 校验层）。
public enum MiniPanelSetCommandsParams {
  public struct Command: Equatable, Sendable {
    public let id: String
    public let name: String
  }
}

/// 导入失败报告的最小镜像（adapted：AICore BridgeEvents1 的 ResourcesImportedEvent.Failure，
/// 字段形状保持 name/reason；拖放管线尚未接线，类型仅供 Actions 签名）。
enum ResourcesImportedEvent {
  struct Failure: Equatable, Sendable {
    let name: String
    let reason: Reason

    init(name: String, reason: Reason) {
      self.name = name
      self.reason = reason
    }

    enum Reason: String, Equatable, Sendable {
      case unreadable
      case unsupported
      case tooLarge
      case notDirectory
      case forbidden
    }
  }
}

/// A menu item that runs a closure（移植自 Atd AppMenus.swift）。A checkable one (`isOn`)
/// reads its check mark again whenever its menu updates, since a mark set only at build
/// time would go stale.
final class ActionMenuItem: NSMenuItem, NSMenuItemValidation {
  private let handler: () -> Void
  private let isOn: (() -> Bool)?

  init(
    _ title: String, key: String = "", isOn: (() -> Bool)? = nil,
    _ handler: @escaping () -> Void
  ) {
    self.handler = handler
    self.isOn = isOn
    super.init(title: title, action: #selector(run), keyEquivalent: key)
    target = self
    refreshState()
  }

  /// Always enabled, as an item whose target answers its action is.
  func validateMenuItem(_ menuItem: NSMenuItem) -> Bool {
    refreshState()
    return true
  }

  private func refreshState() {
    if let isOn { state = isOn() ? .on : .off }
  }

  // NSMenuItem's initializers are nonisolated; under the target's main-actor default the
  // overrides Swift would otherwise synthesize for them conflict, so they are spelled out.
  @available(*, unavailable)
  nonisolated override init(title: String, action: Selector?, keyEquivalent: String) {
    fatalError("init(title:action:keyEquivalent:) is not supported")
  }

  @available(*, unavailable)
  nonisolated required init(coder: NSCoder) { fatalError("init(coder:) is not supported") }

  @objc private func run() { handler() }
}
