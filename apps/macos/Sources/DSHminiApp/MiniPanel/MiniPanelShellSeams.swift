import AppKit

// 迷你面板移植自 Atd（授权复制）后缺的壳侧缝隙，收口在这一个文件：
// 标签表（Atd 的 ShellStrings 多语言表 → 本项目静态中文表，键名保持一致以零改动
// 消费）、命令卡数据类型、导入失败镜像、闭包菜单项。除这里列出的，移植族不改一行。

/// The mini panel's copy in the shell language（adapted：Atd 的 ShellStrings → 本项目
/// 静态 zh 表；didChange 目前无人发送——单语言，保留通知位以免语言系统接入时再翻契约）。
enum ShellStringKey {
  case miniPanelLabel
  case miniPanelOpen
  case miniPanelHidePanel
  case miniPanelNewTask
  case miniPanelAsk
  case miniPanelScreenshot
  case miniPanelCommands
  case miniPanelDrop
  case miniPanelMoveLeft
  case miniPanelMoveRight
  case miniPanelOpenOnClick
  case miniPanelHide
  case menuSettings
}

final class ShellStrings {
  static let shared = ShellStrings()
  static let didChange = Notification.Name("deepdive.shellStringsDidChange")

  private init() {}

  func text(_ key: ShellStringKey) -> String {
    switch key {
    case .miniPanelLabel: return "DeepDive 快捷面板"
    case .miniPanelOpen: return "打开面板"
    case .miniPanelHidePanel: return "收起面板"
    case .miniPanelNewTask: return "新会话"
    case .miniPanelAsk: return "问选区"
    case .miniPanelScreenshot: return "截图"
    case .miniPanelCommands: return "命令"
    case .miniPanelDrop: return "松手放进会话"
    case .miniPanelMoveLeft: return "移到屏幕左侧"
    case .miniPanelMoveRight: return "移到屏幕右侧"
    case .miniPanelOpenOnClick: return "点击打开"
    case .miniPanelHide: return "隐藏迷你面板"
    case .menuSettings: return "设置…"
    }
  }
}

/// 本应用自产拖拽会话的私有 pasteboard 类型（adapted：Atd DesktopPinDrag.pasteboardType，
/// 拖放监视用来排除自家 pin 的拖拽）。DeepDive 目前没有自产拖拽源——位子先留给
/// 将来的截图/pin 拖拽，自家窗口发起的拖拽将来标这个类型。
enum DeepDiveDrag {
  static let pasteboardType = NSPasteboard.PasteboardType("com.deepdive.desktop-pin-drag")
}

/// 快捷会话命令卡的命令条目（adapted：Atd BridgeCalls2 的 MiniPanelSetCommandsParams.
/// Command，字段形状保持 id/name；DeepDive 不走他们的 BridgeCoding 校验层）。
enum MiniPanelSetCommandsParams {
  struct Command: Equatable, Sendable {
    let id: String
    let name: String
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
