import AppKit

/// 壳侧设计常量：圆角阶梯与窗口层级表（原生独有的那些值，唯一一处定义）。
///
/// **圆角阶梯是 `tokens.json` 的镜像**——页面那一侧的权威值在 `frontend/packages/design/
/// tokens.json`（生成 `tokens.css` 的 `--dsh-radius-*`），这里是壳要用的同一套刻度，
/// 改一处必须同时对另一处改（网页侧的 `make test` 架构门会拦字面量，壳侧靠这份文件收口）。
/// 例外：**窗口自身的裁切圆角不在阶梯里**（`WindowGlassView` 的 `panelCornerRadius`
/// 是"迷你面板窗实测 ≈12pt"量出来的，由窗体与 WindowServer 决定，与页内卡片不同轴）。
enum ShellRadius {
  /// 与 tokens.json 的 radius 组逐档对应。
  static let micro: CGFloat = 4
  static let keycap: CGFloat = 6
  static let row: CGFloat = 8
  static let control: CGFloat = 10
  static let card: CGFloat = 14
  static let panel: CGFloat = 18
  static let floating: CGFloat = 20
  static let bubble: CGFloat = 24
}

/// 窗口层级表（顺序即语义，别在中间插值）。
///
/// 页内浮层的层级档在 `theme.css` 的 `--z-*`；原生窗口这一侧此前是散落的值
/// （`.normal` / `.floating+1` / `.floating+2` / `.popUpMenu` / `.statusBar` /
/// `.screenSaver`），谁高谁低只体现在各自的字面量里。收在这里一处。
///
/// 与页内那套的对应：遮挡垫 < 菜单 < 提示 < 最上。原生这一列同理——窗口底（main）
/// 在最下，工具条与选择浮层压在内容之上，注释窗再高一档，截图的整屏覆盖层在最上。
enum ShellWindowLevel {
  /// 主窗与快捷面板：普通窗口层级。
  static let main = NSWindow.Level.normal
  /// 迷你面板（屏缘药丸）：浮在普通窗口之上，注释窗比它再高一档。
  static let miniPanel = NSWindow.Level(rawValue: NSWindow.Level.floating.rawValue + 1)
  /// 悬浮注释窗：比迷你面板再高一档（它要给迷你面板里的东西做注释）。
  static let tooltip = NSWindow.Level(rawValue: NSWindow.Level.floating.rawValue + 2)
  /// 划词工具条与它的菜单：弹出菜单档（要压过被划词的那个应用窗口）。
  static let selectionToolbar = NSWindow.Level.popUpMenu
  /// 玻璃 HUD（复制/截图的结果提示）：状态栏档。
  static let glassHUD = NSWindow.Level.statusBar
  /// 截图 overlay：整屏覆盖，必须压过一切。
  static let captureOverlay = NSWindow.Level.screenSaver
}
