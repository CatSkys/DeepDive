import AppKit

// 三块 Atd 移植（迷你面板 / 截图标注 / 选区工具条）共用的壳侧缝隙，收口在这一个文件：
// 文案表、桥 DTO 镜像、壳侧错误类型。除这里列出的，移植族不改一行（Atd 授权复制）。

/// 壳侧文案的语言（Atd `ShellLanguage` 的本地化版：本项目前端语言偏好是 "zh"/"en"）。
enum ShellLanguage: String, CaseIterable, Sendable {
  case english = "en"
  case simplifiedChinese = "zh"

  /// 前端语言偏好（`DSHAppPrefs.language`）映射；认不出的值按中文（本应用默认）。
  init(appLanguage: String) {
    self = appLanguage == "en" ? .english : .simplifiedChinese
  }
}

/// Every native string, by the Atd catalog key（adapted：Atd 的 ShellStrings 多语言表 →
/// 本项目静态 zh/en 表，键名保持 Atd 原样以零改动消费移植族；文案取自 Atd 目录的
/// zh-Hans/en 两条，产品名换成 DeepDive）。
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
  case appPickTitle
  case cancel
  case captureColorBlack
  case captureColorBlue
  case captureColorGreen
  case captureColorWhite
  case captureColorYellow
  case captureConfirm
  case captureCopy
  case captureRedactionBlur
  case captureRedactionSolid
  case captureRedo
  case captureToolArrow
  case captureToolEllipse
  case captureToolHighlighter
  case captureToolLine
  case captureToolMosaic
  case captureToolPen
  case captureToolRectangle
  case captureToolSelect
  case captureToolSpotlight
  case captureToolStep
  case captureToolText

  case selectionToolbar
  case selectionToolbarAsk
  case selectionToolbarAskTooltip
  case selectionToolbarMore
  case selectionToolbarMoreTooltip
  case selectionHudOn
  case selectionHudOff
  case selectionHudHint
  case selectionHudHide

  case captureToolbar
  case captureToolbarMove
  case captureStyleBar
  case captureSize
  case captureSizeTooltip
  case captureTextBackground
  case captureUndo
  case captureRedactionPixelate
  case captureColorRed
  case captureTooltipShortcut
  case captureHintIdle
  case captureHintAccessibility
  case captureHintWindowsOnly
  case captureHintRecall
  case captureHintSelected
  case screenshotTooLarge
  case screenshotUnwritable
  case screenshotUnencodable
  case screenshotNotPrepared
  case screenshotAttachFailed
  case screenshotOpenFailed
  case screenshotImageOnly
  case screenshotNoDisplay
  case screenshotOnlyImages
  case screenshotAlreadyRunning
  case screenshotPanelOpening
  case screenshotCloseDialog
  case screenshotPermissionStale
  case screenshotNeedsPermission
}

final class ShellStrings {
  static let shared = ShellStrings()
  static let didChange = Notification.Name("deepdive.shellStringsDidChange")

  private(set) var language: ShellLanguage

  private init() {
    language = ShellLanguage(appLanguage: DSHAppPrefs.language)
  }

  /// 前端推来的语言偏好（"zh"/"en"）；变了就发通知，长寿命面重建。
  @discardableResult
  func apply(appLanguage: String) -> Bool {
    let next = ShellLanguage(appLanguage: appLanguage)
    guard next != language else { return true }
    language = next
    NotificationCenter.default.post(name: Self.didChange, object: nil)
    return true
  }

  func text(_ key: ShellStringKey) -> String {
    let zh = language == .simplifiedChinese
    switch key {
    case .miniPanelLabel: return zh ? "DeepDive 快捷面板" : "DeepDive Mini Panel"
    case .miniPanelOpen: return zh ? "打开面板" : "Open the panel"
    case .miniPanelHidePanel: return zh ? "收起面板" : "Hide the panel"
    case .miniPanelNewTask: return zh ? "新会话" : "New session"
    case .miniPanelAsk: return zh ? "就所选文字询问" : "Ask about the selected text"
    case .miniPanelScreenshot: return zh ? "截图" : "Take a screenshot"
    case .miniPanelCommands: return zh ? "命令" : "Commands"
    case .miniPanelDrop: return zh ? "松手放进会话" : "Drop to add to the session"
    case .miniPanelMoveLeft: return zh ? "移到屏幕左侧" : "Move to the left edge"
    case .miniPanelMoveRight: return zh ? "移到屏幕右侧" : "Move to the right edge"
    case .miniPanelOpenOnClick: return zh ? "点击打开" : "Open on click"
    case .miniPanelHide: return zh ? "隐藏迷你面板" : "Hide the mini panel"
    case .menuSettings: return zh ? "设置…" : "Settings…"
    case .appPickTitle: return zh ? "选择不显示选择文字工具栏的 App" : "Choose apps where the selection toolbar stays hidden"
    case .cancel: return zh ? "取消" : "Cancel"
    case .captureColorBlack: return zh ? "黑色" : "Black"
    case .captureColorBlue: return zh ? "蓝色" : "Blue"
    case .captureColorGreen: return zh ? "绿色" : "Green"
    case .captureColorWhite: return zh ? "白色" : "White"
    case .captureColorYellow: return zh ? "黄色" : "Yellow"
    case .captureConfirm: return zh ? "完成" : "Done"
    case .captureCopy: return zh ? "复制" : "Copy"
    case .captureRedactionBlur: return zh ? "模糊" : "Blur"
    case .captureRedactionSolid: return zh ? "遮盖" : "Cover"
    case .captureRedo: return zh ? "重做" : "Redo"
    case .captureToolArrow: return zh ? "箭头" : "Arrow"
    case .captureToolEllipse: return zh ? "椭圆" : "Ellipse"
    case .captureToolHighlighter: return zh ? "荧光笔" : "Highlighter"
    case .captureToolLine: return zh ? "直线" : "Line"
    case .captureToolMosaic: return zh ? "马赛克" : "Mosaic"
    case .captureToolPen: return zh ? "画笔" : "Pen"
    case .captureToolRectangle: return zh ? "矩形" : "Rectangle"
    case .captureToolSelect: return zh ? "选择" : "Select"
    case .captureToolSpotlight: return zh ? "聚光灯" : "Spotlight"
    case .captureToolStep: return zh ? "序号" : "Step Number"
    case .captureToolText: return zh ? "文字" : "Text"

    case .selectionToolbar: return zh ? "选择文字工具栏" : "Selection toolbar"
    case .selectionToolbarAsk: return zh ? "问 DeepDive" : "Ask DeepDive"
    case .selectionToolbarAskTooltip: return zh ? "就所选文字询问 DeepDive" : "Ask DeepDive about the selected text"
    case .selectionToolbarMore: return zh ? "更多" : "More"
    case .selectionToolbarMoreTooltip: return zh ? "更多命令" : "More commands"
    case .selectionHudOn: return zh ? "选区工具栏已开启" : "Selection toolbar on"
    case .selectionHudOff: return zh ? "选区工具栏已关闭" : "Selection toolbar off"
    case .selectionHudHint: return zh ? "连按两次 %@ 关闭" : "Press %@ twice to turn off"
    case .selectionHudHide: return zh ? "隐藏到下次开启" : "Hide until next time"

    case .captureToolbar: return zh ? "标注工具" : "Annotation Tools"
    case .captureToolbarMove: return zh ? "拖动以移动 · 双击放回原位" : "Drag to move · Double-click to put back"
    case .captureStyleBar: return zh ? "标注样式" : "Annotation Style"
    case .captureSize: return zh ? "大小" : "Size"
    case .captureSizeTooltip: return zh ? "大小：在任意位置滚动滚轮，或按 - 和 =" : "Size — scroll anywhere, or press - and ="
    case .captureTextBackground: return zh ? "文字背景" : "Text background"
    case .captureUndo: return zh ? "撤销" : "Undo"
    case .captureRedactionPixelate: return zh ? "马赛克" : "Mosaic"
    case .captureColorRed: return zh ? "红色" : "Red"
    case .captureTooltipShortcut: return zh ? "%@（%@）" : "%@ (%@)"
    case .captureHintIdle:
      return zh
        ? "点击高亮区域或拖动选择 · 滚动切换更大区域 · ⌘A 选择整个屏幕 · Esc 取消"
        : "Click a highlighted area or drag to select · Scroll for a larger area · ⌘A for the whole screen · Esc to cancel"
    case .captureHintAccessibility: return zh ? "允许辅助功能以识别界面元素" : "Allow Accessibility to detect interface elements"
    case .captureHintWindowsOnly: return zh ? "仅识别窗口 · 按 W 恢复识别元素" : "Windows only · W to detect elements again"
    case .captureHintRecall: return zh ? "R 复用上次区域" : "R to reuse the last area"
    case .captureHintSelected: return zh ? "拖动边缘调整大小 · 回车确认 · Esc 返回" : "Drag the edges to resize · Return to confirm · Esc to go back"

    case .screenshotTooLarge: return zh ? "截图过大，无法附加。" : "The screenshot is too large to attach."
    case .screenshotUnwritable: return zh ? "截图保存失败。" : "The screenshot could not be saved."
    case .screenshotUnencodable: return zh ? "截图编码失败。" : "The screenshot could not be encoded."
    case .screenshotNotPrepared: return zh ? "截图准备失败。" : "The screenshot could not be prepared."
    case .screenshotAttachFailed: return zh ? "截图未能附加。" : "The screenshot could not be attached."
    case .screenshotOpenFailed: return zh ? "截图打开失败，无法继续编辑。" : "The screenshot could not be opened for editing."
    case .screenshotImageOnly: return zh ? "只有图片可以编辑。" : "Only images can be edited."
    case .screenshotNoDisplay: return zh ? "没有可截取的屏幕。" : "No display could be captured."
    case .screenshotOnlyImages: return zh ? "只有图片可以附加。" : "Only images can be attached."
    case .screenshotAlreadyRunning: return zh ? "正在截图，请稍候。" : "A screenshot is already being taken."
    case .screenshotPanelOpening: return zh ? "面板正在打开，请稍后再试。" : "The panel is still opening; try again."
    case .screenshotCloseDialog: return zh ? "请先关闭打开的对话框，再截图。" : "Close the open dialog before taking a screenshot."
    case .screenshotNeedsPermission:
      return zh
        ? "需要「屏幕录制」权限才能截图：设置 → 划词与截图 里有直达系统设置的按钮（授权后请退出并重开本应用）。"
        : "Screen Recording permission is needed — Settings → 划词与截图 links straight to it (quit and reopen the app after granting)."
    case .screenshotPermissionStale:
      return zh
        ? "截图没能启动：如果刚在系统设置里授权，请退出并重新打开本应用（macOS 只对重启后的应用生效）。"
        : "The capture could not start. If you just granted Screen Recording, quit and reopen this app — macOS applies new grants only to a relaunched process."
    }
  }

  /// 带一个参数的整句（Atd 目录里有 `%lld` / `%@` 的键用）。
  func text(_ key: ShellStringKey, _ argument: String) -> String {
    text(key).replacingOccurrences(of: "%@", with: argument)
  }
}

/// 壳侧操作失败的统一错误（adapted：Atd `BridgeError`；文案已是成品，直接回给前端）。
struct BridgeError: Error, LocalizedError {
  let message: String

  init(_ message: String) { self.message = message }

  var errorDescription: String? { message }

  /// 包一层前缀（Atd 同名静态法的本地化版）。
  static func message(_ error: any Error, _ fallback: String) -> BridgeError {
    BridgeError((error as? LocalizedError)?.errorDescription ?? fallback)
  }
}
