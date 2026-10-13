import AppKit

// 移植族对 Atd 生成桥件的本地镜像（adapted）：Atd 用 codegen 从 TS 契约生成
// `AICore/Bridge/Generated/*`，本项目不走 codegen，只在用到的少数几个类型上
// 保持字段形状一致（我们的 SPA 直接发 JSON，入口处解析）。命名与 Atd 一致，
// 移植族零改动消费。

/// 壳与前端之间固定的标识符与上限（adapted：Atd `NativeBridgeContract` 的用到的几位）。
enum NativeBridgeContract {
  /// 面板开关在 `shortcuts.set` 里的注册 id。
  static let panelShortcutId = "togglePanel"
  /// 截图在 `shortcuts.set` 里的注册 id。
  static let screenshotShortcutId = "captureScreenshot"
  /// 一次捕获返回的最长文本。
  static let maxCaptureLength = 100_000
}

/// `capture('selection')` / `clipboard.read` 的应答（adapted：Atd `CaptureResult`）。
public enum CaptureResult: Equatable, Sendable {
  case ok(Ok)
  case notOk(NotOk)

  public struct Ok: Equatable, Sendable {
    public let text: String
    public let capturedAt: String
  }

  public struct NotOk: Equatable, Sendable {
    public let reason: Reason
  }

  public enum Reason: String, Equatable, Sendable {
    case notTrusted
    case noSelection
    case tooLong
  }

  var json: [String: Any] {
    switch self {
    case .ok(let value): ["ok": true, "value": ["text": value.text, "capturedAt": value.capturedAt]]
    case .notOk(let value): ["ok": false, "reason": value.reason.rawValue]
    }
  }
}

/// `toolbar.set` 的解码形状（adapted：Atd `ToolbarSetParams`；字段名与前端一致）。
public struct ToolbarSetParams: Equatable, Sendable {
  public typealias Activation = SelectionActivationMode
  public typealias ActivationKey = SelectionActivationKey
  public typealias Command = MiniPanelSetCommandsParams.Command

  public let enabled: Bool
  public let activation: Activation
  public let activationKeys: [ActivationKey]
  public let showHud: Bool
  public let excludedBundleIds: [String]
  public let commands: [Command]

  /// 从桥消息体解析；缺字段按以下默认（与前端默认一致：开、按住 ⌥、显示 HUD）。
  public init(_ body: [String: Any]) {
    enabled = body["enabled"] as? Bool ?? true
    activation = (body["activation"] as? String).flatMap(Activation.init(rawValue:)) ?? .hold
    let keys = body["activationKeys"] as? [String] ?? ["option"]
    activationKeys = keys.compactMap(ActivationKey.init(rawValue:))
    showHud = body["showHud"] as? Bool ?? true
    excludedBundleIds = body["excludedBundleIds"] as? [String] ?? []
    let rawCommands = body["commands"] as? [[String: Any]] ?? []
    commands = rawCommands.compactMap { item in
      guard let id = item["id"] as? String, let name = item["name"] as? String else { return nil }
      return Command(id: id, name: name)
    }
  }
}

/// 选区工具条的激活方式（Atd 契约的 `activation`）。
public enum SelectionActivationMode: String, CaseIterable, Sendable {
  case always
  case hold
  case toggle
}

/// 激活组合里的键（Atd 契约的 `activationKeys`）。
public enum SelectionActivationKey: String, CaseIterable, Sendable {
  case option
  case command
  case shift
}

/// 系统选 App 面板的结果（adapted：Atd `AppsPickResult`）。
struct AppsPickResult: Equatable, Sendable {
  struct App: Equatable, Sendable {
    let bundleId: String
    let name: String
  }

  let apps: [App]
}

/// 壳侧系统面板（adapted：Atd `SystemPanels` 里本移植用得到的一项）。
///
/// Atd 的面板封装还管「同时只开一个系统面板」与窗口层级；本项目此前没有等价面，
/// 这里只补 `apps.pick` 用到的那一项，并保留同一时刻只开一个面板的纪律。
@MainActor
final class SystemPanels {
  private var isOpen = false

  /// 应用包多选（`apps.pick`），起步目录 /Applications；取消或已有面板开着时 nil。
  func chooseApps() async -> [URL]? {
    guard !isOpen else { return nil }
    isOpen = true
    defer { isOpen = false }
    let panel = NSOpenPanel()
    panel.message = ShellStrings.shared.text(.appPickTitle)
    panel.canChooseFiles = true
    panel.canChooseDirectories = false
    panel.allowsMultipleSelection = true
    panel.allowedContentTypes = [.applicationBundle]
    panel.directoryURL = URL(filePath: "/Applications", directoryHint: .isDirectory)
    return await panel.begin() == .OK ? panel.urls : nil
  }
}

/// 打开系统设置里的一格（adapted：Atd `PermissionGuide` 引导窗 → 直接深链；功能等价，
/// 少一个自绘窗。Atd 用自绘「拖滑块允许」引导是因为它的设置是网页、系统弹窗会盖住页面，
/// 本项目没有那个约束）。
enum SystemSettings {
  enum Pane: String {
    case accessibility = "Privacy_Accessibility"
    case screenRecording = "Privacy_ScreenCapture"
  }

  static func open(_ pane: Pane) {
    let url = URL(string: "x-apple.systempreferences:com.apple.preference.security?\(pane.rawValue)")!
    NSWorkspace.shared.open(url)
  }
}

/// 附件选择器挑什么（composer ＋ 菜单的「上传文件」/「添加文件夹…」两项）：
/// 认不出的值按 `any`（老前端/直连调试不该因为少一个字段就挑不了东西）。
enum AttachmentPickKind {
  case files
  case folders
  case any

  init(raw: String?) {
    switch raw {
    case "files": self = .files
    case "folders": self = .folders
    default: self = .any
    }
  }

  var choosesFiles: Bool { self != .folders }
  var choosesDirectories: Bool { self != .files }

  var message: String {
    switch self {
    case .files: "选择要附加的文件"
    case .folders: "选择要附加的文件夹"
    case .any: "选择要附加的文件或文件夹"
    }
  }
}
