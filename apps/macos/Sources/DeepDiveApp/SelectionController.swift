import AppKit

/// 划词的壳侧编排：辅助功能授权、工具条配置、选区暂存与事件交接。
///
/// 工具条本身（全局监听、AX 探测、玻璃面板、HUD）在 `Selection/`（Atd 移植族）；
/// 这里只管**接线**：把页面推来的设置喂给工具条，把「问 DeepDive / 命令」变成页面
/// 能消费的事件，并在面板抢焦点**之前**把选中文字存进暂存（Atd `Summoner` 的语义：
/// 面板一获得焦点，前台应用就换了，选区也就读不到了）。
final class SelectionController {
  /// 「问 DeepDive」：暂存已写好，页面据此把文字引用进草稿（`guideText` 是欢迎页
  /// 练习区的文字，来自页面自己，非 AX 读取）。
  var onAsk: ((String?) -> Void)?
  /// 工具条上的命令按钮/More 菜单行：id 交给页面跑（划词命令在面板会话里跑，见
  /// AppDelegate 推的 `selectionCommand`）。回调前选中文字已进暂存。
  var onCommand: ((String) -> Void)?
  /// toggle 模式的监听状态变了（状态菜单与设置页据此显示）。
  var onListeningChange: ((Bool) -> Void)?
  /// 辅助功能授权变了。
  var onTrustChange: ((Bool) -> Void)?

  private let trust = AccessibilityTrust()
  private let toolbar: SelectionToolbarController
  private let panels = SystemPanels()
  private var settings: SelectionToolbarSettings?
  /// 上一次召唤读到的选区（`selection-capture` 只答它，绝不现读）。
  private var stash: CapturedText?
  private var publishedListening: Bool?

  init() {
    toolbar = SelectionToolbarController(trust: trust)
    trust.onChange = { [weak self] trusted in
      self?.onTrustChange?(trusted)
      self?.toolbar.update()
    }
    toolbar.onAsk = { [weak self] guideText in self?.ask(guideText: guideText) }
    toolbar.onCommand = { [weak self] id in self?.command(id) }
    trust.start()
  }

  var isTrusted: Bool { trust.isTrusted }
  var isListening: Bool? { toolbar.isListening }

  /// 页面的 `toolbar.set`：整份设置（开关/激活方式/命令表/排除的 App）。
  func apply(_ params: ToolbarSetParams) {
    let next = SelectionToolbarSettings(params)
    settings = next
    toolbar.apply(next)
    // 首启且开着：问一次辅助功能（Atd 的时机——页面首次推送才算用户表了态）。
    if firstApply {
      firstApply = false
      if next.enabled { trust.promptOnFirstLaunch() }
    }
    publishListening()
  }

  /// 状态菜单/设置页开合 toggle 模式的监听。
  func setListening(_ on: Bool) {
    toolbar.setListening(on)
    publishListening()
  }

  /// `accessibility.request`：打开系统设置的辅助功能面板。
  func openAccessibilityPane() { trust.openSystemSettings() }

  /// `apps.pick`：选一批「不显示工具条」的 App。
  func pickExcludedApps() async -> AppsPickResult {
    await ExcludedAppPicker.pick(with: panels)
  }

  /// 已知文字的暂存（迷你面板拖入的文本走这条：文字不是 AX 读来的）。
  func stash(_ text: String) {
    stash = TextCapture.stash(text, at: .now)
  }

  /// `selection-capture`：答上一次召唤的暂存（每次召唤/命令点击都先写过它，见上）。
  func captureResult() -> CaptureResult {
    TextCapture.captureResult(stash: stash, trusted: SelectionReader.isTrusted)
  }

  /// 菜单/迷你面板「就所选文字询问」：此刻前台还是那个 App，现读一次并写进暂存。
  func captureCurrentSelection() async -> CaptureResult {
    stash = TextCapture.stash(await readSelection(), at: .now)
    return TextCapture.captureResult(stash: stash, trusted: SelectionReader.isTrusted)
  }

  // MARK: - Ask 与命令

  /// 工具条的 Ask：先存选区（此刻前台还是被选中的那个 App），再让页面亮面板。
  private func ask(guideText: String?) {
    if let guideText {
      stash = TextCapture.stash(guideText, at: .now)
      onAsk?(guideText)
      return
    }
    Task { @MainActor in
      stash = TextCapture.stash(await readSelection(), at: .now)
      onAsk?(nil)
    }
  }

  /// 工具条上的命令按钮 / More 菜单行：与 Ask 同一条——先把选区存进暂存（面板一获得
  /// 焦点前台应用就换了，那时再读读不到），页面拿到 id 再自己去暂存取文字。
  /// 练习区的工具条不会走到这里（`SelectionToolbarController` 已挡下：点了会真跑）。
  private func command(_ id: String) {
    Task { @MainActor in
      stash = TextCapture.stash(await readSelection(), at: .now)
      onCommand?(id)
    }
  }

  /// 前台 App 的选区；未授权时每 launch 问一次，答 nil。
  private func readSelection() async -> String? {
    guard SelectionReader.isTrusted else {
      trust.promptForSummon()
      return nil
    }
    let pid = NSWorkspace.shared.frontmostApplication?.processIdentifier
    return await SelectionReader.readBounded(frontmostPID: pid).text
  }

  private var firstApply = true

  private func publishListening() {
    guard let listening = toolbar.isListening, listening != publishedListening else { return }
    publishedListening = listening
    onListeningChange?(listening)
  }
}
