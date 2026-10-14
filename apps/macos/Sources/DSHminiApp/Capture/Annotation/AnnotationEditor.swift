import AppKit

/// The annotation step of a capture session (``AnnotationEditing``): a canvas over the
/// committed selection, a glass toolbar beside it and, in the slot next to the toolbar, the style
/// bar while there is something to style or the chat bar while a message is being typed
/// (``AnnotationChatBar``, opened by the toolbar's ask button), plus the extract card
/// (``AnnotationExtractCard``, opened by its extract button) anchored under the toolbar; all are
/// subviews of the host overlay view. Annotations are in the host's view points, so they stay on
/// the screen while the selection moves or resizes; the canvas and the bars follow the selection,
/// and the export takes what lies inside it. Focus and key routing between the canvas and the host
/// are described on ``AnnotationCanvasView``.
///
/// The model, hit-testing and geometry are AICore's (`Annotation*.swift`); this type wires the
/// store, the pointer state machine, the text editor, the renderer, the element picker and the
/// bars together, and remembers the styles across sessions (``AnnotationStyleMemory``, E8).
/// Written for this app on platform APIs only (D5); no third-party annotation code is used.
final class AnnotationEditor: AnnotationEditing {
  var onConfirm: (() -> Void)?
  var onCancel: (() -> Void)?
  var onCopy: (() -> Void)?
  var onAsk: ((String) -> Void)?
  var onInteriorClaimChange: ((Bool) -> Void)?

  private let store = AnnotationStore()
  private let renderer = AnnotationRenderer()
  private let picker = AnnotationElementPicker()
  private let defaults: UserDefaults
  private let interaction: AnnotationInteraction
  private let textEditor: AnnotationTextEditor
  private let canvas: AnnotationCanvasView
  private let toolbar = AnnotationToolbar()
  private let styleBar = AnnotationStyleBar()
  private let chatBar = AnnotationChatBar()
  private let extractCard = AnnotationExtractCard()

  private var display: FrozenDisplay?
  private var selection = CGRect.zero
  /// Where the user dragged the toolbar to, in the host's points: it stays there for the rest
  /// of the session, whatever the selection does. Nil while the bars follow the selection.
  private var movedOrigin: CGPoint?
  /// The run of wheel ticks in progress (``scroll(_:)``) and when its last tick came.
  private var wheelBurst = UUID()
  private var lastWheel: TimeInterval = 0
  /// The toolbar's origin when the drag in progress began.
  private var dragOrigin = CGPoint.zero
  /// 在途的那一次提取文字：识别与翻译都认这个记号，卡一关就作废（``beginExtractRun()``）。
  private var extractRun: UUID?

  /// `defaults` keeps the remembered styles.
  init(defaults: UserDefaults = .standard) {
    self.defaults = defaults
    interaction = AnnotationInteraction(store: store)
    textEditor = AnnotationTextEditor(store: store)
    canvas = AnnotationCanvasView(
      store: store, interaction: interaction, textEditor: textEditor, renderer: renderer,
      picker: picker)
    store.onChange = { [weak self] in self?.refresh() }
    picker.onChange = { [weak self] in self?.canvas.needsDisplay = true }
    interaction.elementBox = { [weak self] point in
      guard let self else { return nil }
      return picker.box(at: point, within: selection)
    }
    interaction.onStylesChange = { [weak self] styles in
      guard let self else { return }
      AnnotationStyleMemory.save(styles, to: self.defaults)
    }
    interaction.onEditText = { [weak self] point, existing in self?.editText(at: point, existing) }
    interaction.onConfirm = { [weak self] in self?.confirm() }
    textEditor.onEnd = { [weak self] in self?.focusCanvas() }
    canvas.onConfirm = { [weak self] in self?.confirm() }
    canvas.onCopy = { [weak self] in self?.copy() }
    canvas.onChooseTool = { [weak self] in self?.choose($0) }
    canvas.onEscape = { [weak self] in self?.stepBack() ?? false }
    canvas.onStepStroke = { [weak self] in self?.stepStroke($0) ?? false }
    canvas.onClearAll = { [weak self] in self?.clearAll() ?? false }
    toolbar.onTool = { [weak self] in self?.choose($0) }
    toolbar.onExtract = { [weak self] in self?.extractText() }
    extractCard.onCopy = { [weak self] in self?.copyExtracted($0) }
    extractCard.onTranslate = { [weak self] in self?.translateExtracted($0) }
    extractCard.onClose = { [weak self] in self?.closeExtract() }
    styleBar.onChange = { [weak self] in self?.restyle($0, burst: $1) }
    toolbar.onUndo = { [weak self] in self?.store.undo() }
    toolbar.onRedo = { [weak self] in self?.store.redo() }
    toolbar.onChat = { [weak self] in self?.toggleChat() }
    toolbar.onCancel = { [weak self] in self?.onCancel?() }
    toolbar.onConfirm = { [weak self] in self?.confirm() }
    toolbar.onCopy = { [weak self] in self?.copy() }
    toolbar.onDrag = { [weak self] in self?.moveBars($0) }
    styleBar.onDrag = { [weak self] in self?.moveBars($0) }
    chatBar.onDrag = { [weak self] in self?.moveBars($0) }
    chatBar.onSend = { [weak self] in self?.ask($0) }
    chatBar.onClose = { [weak self] in self?.closeChat() }
  }

  func show(in host: NSView, selection: CGRect, display: FrozenDisplay) {
    hide()
    self.display = display
    interaction.styles = AnnotationStyleMemory.load(from: defaults)
    canvas.pixelScale = display.pixelScale
    canvas.backdrop = display.image
    toolbar.applyStrings()
    styleBar.applyStrings()
    chatBar.applyStrings()
    extractCard.applyStrings()
    host.addSubview(canvas)
    host.addSubview(toolbar)
    host.addSubview(styleBar)
    host.addSubview(chatBar)
    host.addSubview(extractCard)
    selectionDidChange(selection)
    refresh()
    focusCanvas()
    // 识别器的冷启动现在就付掉（后台、整进程一次）：用户可能马上要按那颗扫描钮，而首次识别
    // 最坏要等系统那份识别服务就位几十秒（PITFALLS §11.9）——那时候他正在看选区，是在等自己。
    Task.detached(priority: .utility) { await ScreenText.warmUp() }
  }

  var hasAnnotations: Bool { !store.document.isEmpty || textEditor.isEditing }

  /// Selection-local: the origin is the selection's top-left, whatever it is on the screen now.
  var document: AnnotationDocument {
    store.document.translated(by: CGVector(dx: -selection.minX, dy: -selection.minY))
  }

  func restore(_ document: AnnotationDocument) {
    textEditor.cancel()
    interaction.cancelGesture()
    store.load(document.translated(by: CGVector(dx: selection.minX, dy: selection.minY)))
    canvas.refreshPointer()
  }

  var elementTargets: ((CGPoint) async -> [CGRect])? {
    didSet { picker.targets = elementTargets }
  }

  func selectionDidChange(_ selection: CGRect) {
    self.selection = selection
    canvas.place(over: selection)
    textEditor.selectionDidChange()
    placeToolbar()
  }

  func hide() {
    interaction.cancelGesture()
    textEditor.cancel()
    chatBar.close()
    extractCard.close()
    canvas.removeFromSuperview()
    toolbar.removeFromSuperview()
    styleBar.removeFromSuperview()
    chatBar.removeFromSuperview()
    extractCard.removeFromSuperview()
    canvas.backdrop = nil
    interaction.tool = nil
    picker.reset()
    store.reset()
    display = nil
    movedOrigin = nil
    extractRun = nil
  }

  /// Annotations are in view points: they are moved into the crop's pixels and clipped to the
  /// selection. Mosaics sample the frozen display image rather than `backdrop`, so one reaching
  /// past the selection pixelates exactly as on the canvas. Nothing is drawn once hidden.
  func render(into context: CGContext, scale: CGFloat) {
    guard let display else { return }
    context.saveGState()
    context.concatenate(CaptureCoordinates.cropTransform(selection: selection, scale: scale))
    context.clip(to: selection)
    renderer.draw(store.document, in: context, backdrop: display.image, scale: display.pixelScale)
    context.restoreGState()
  }

  // MARK: Actions

  /// Picks a tool, or drops it (nil). Having a tool claims the selection's interior from the
  /// session (D14), which still owns the handles and the edge band; dropping it hands the
  /// interior back.
  private func choose(_ tool: AnnotationTool?) {
    textEditor.end()
    interaction.cancelGesture()
    let claimed = interaction.tool != nil
    interaction.tool = tool
    if claimed != (tool != nil) { onInteriorClaimChange?(tool != nil) }
    canvas.refreshPointer()
    refresh()
    focusCanvas()
  }

  /// Esc steps back one level (E6): ends open text, else drops a gesture in progress, else
  /// deselects, else drops the tool. False when none applied, so the key goes on to the
  /// session, which cancels.
  private func stepBack() -> Bool {
    if chatBar.isOpen {
      closeChat()
    } else if extractCard.isOpen {
      closeExtract()
    } else if textEditor.isEditing {
      textEditor.end()
    } else if interaction.isGesturing {
      interaction.cancelGesture()
    } else if store.selectedID != nil {
      store.selectedID = nil
    } else if interaction.tool != nil {
      choose(nil)
    } else {
      return false
    }
    canvas.refreshPointer()
    return true
  }

  /// A style bar change: it restyles the open text, else the selected annotation, and becomes
  /// the style of the next new annotation of the same slot. Only the part picked changes.
  /// Changes sharing a `burst` (a size slider drag, a run of wheel ticks) are one undo step.
  private func restyle(_ change: AnnotationStyleChange, burst: UUID? = nil) {
    if let editing = textEditor.style {
      interaction.styles.shared = change.applied(to: interaction.styles.shared)
      textEditor.setStyle(change.applied(to: editing))
    } else {
      interaction.apply(change, burst: burst)
      focusCanvas()
    }
    refresh()
  }

  /// `[` `-` and `]` `=`: one wheel notch smaller or larger (PixPin's keys for a wheel), one undo
  /// step each, for whatever the style bar targets; none at either end. False when the bar
  /// shows no size.
  private func stepStroke(_ direction: Int) -> Bool {
    resize(by: Double(direction), burst: nil)
  }

  /// The scroll wheel anywhere over the overlay while the style bar shows a size, as in PixPin:
  /// the same as dragging the size slider, one ``AnnotationStroke/stepped(by:)`` step per wheel
  /// notch (or per 20 pt of trackpad travel), up for larger. A run of ticks no more than half a second apart, or one trackpad
  /// gesture, is one undo step; momentum after a flick is ignored, so the size stops where the
  /// fingers did. False when there is no size to change, so the session keeps the wheel.
  func scroll(_ event: NSEvent) -> Bool {
    guard styleTarget?.controls.contains(.strokes) == true else { return false }
    guard event.momentumPhase.isEmpty else { return true }
    if event.phase == .began || (event.phase.isEmpty && event.timestamp - lastWheel > 0.5) {
      wheelBurst = UUID()
    }
    lastWheel = event.timestamp
    // Physical direction: up is larger whether or not scrolling is natural.
    let delta = event.isDirectionInvertedFromDevice ? -event.scrollingDeltaY : event.scrollingDeltaY
    let steps = event.hasPreciseScrollingDeltas ? delta / 20 : delta
    if steps != 0 { resize(by: Double(steps), burst: wheelBurst) }
    return true
  }

  /// Moves the size `steps` steps (``AnnotationStroke/stepped(by:)``).
  private func resize(by steps: Double, burst: UUID?) -> Bool {
    guard let target = styleTarget, target.controls.contains(.strokes) else { return false }
    let stroke = target.style.stroke.stepped(by: steps)
    if stroke != target.style.stroke {
      restyle(AnnotationStyleChange(stroke: stroke), burst: burst)
    }
    return true
  }

  /// ⌘Delete: open text is committed first, then the whole document goes as one undo step.
  /// False when there was neither text nor an annotation.
  private func clearAll() -> Bool {
    let wasEditing = textEditor.isEditing
    textEditor.end()
    let cleared = interaction.clearAll()
    canvas.refreshPointer()
    return wasEditing || cleared
  }

  /// Either bar dragged: both move as one block, led by the toolbar.
  private func moveBars(_ drag: AnnotationGlassBar.Drag) {
    switch drag {
    case .began: dragOrigin = toolbar.frame.origin
    case .moved(let travel):
      movedOrigin = CGPoint(x: dragOrigin.x + travel.dx, y: dragOrigin.y + travel.dy)
    case .reset: movedOrigin = nil
    }
    placeToolbar()
  }

  private func editText(at point: CGPoint, _ existing: Annotation?) {
    textEditor.begin(at: point, editing: existing, style: interaction.styles.shared, in: canvas)
  }

  /// Open text is committed first, so the export includes it.
  private func confirm() {
    textEditor.end()
    onConfirm?()
  }

  /// The same export as ``confirm()``, for the clipboard.
  private func copy() {
    textEditor.end()
    onCopy?()
  }

  /// The toolbar's ask button: opens or closes the chat bar. Only one bar sits in the slot beside
  /// the toolbar at a time (the style bar steps aside), so the toolbar keeps its place as the chat
  /// bar comes and goes (``placeToolbar()``).
  private func toggleChat() {
    if chatBar.isOpen {
      closeChat()
    } else {
      textEditor.end()
      chatBar.open()
      refresh()
    }
  }

  /// Closes the chat bar: the style bar comes back and the keyboard returns to the canvas, so the
  /// next Esc (the ladder in ``stepBack()``) cancels the capture as usual.
  private func closeChat() {
    guard chatBar.isOpen else { return }
    chatBar.close()
    refresh()
    focusCanvas()
  }

  /// Sends the message with this capture; text still being typed as an annotation is committed
  /// first, so the export includes it.
  private func ask(_ text: String) {
    textEditor.end()
    onAsk?(text)
  }

  // MARK: 提取文字（工具条那颗扫描钮）

  /// 提取文字：按选区裁**原图**像素去识别（标注不进识别——那只会给读出来的字添噪），结果
  /// 开在卡里。识别是用户按出来的那一下才跑的（``ScreenText``），识别期间卡先开出来报"识别中"；
  /// 识别没有死线，识别器本身已在编辑器出现时预热过（见 ``show(in:selection:display:)``）。
  ///
  /// 喂给识别的是**导出那条路径上的无标注位图**（`CaptureExport.render` 的 `raw`，也是旧管道
  /// 喂给识别器的同一份）：直接 `cropping` 冻屏图看着等价，端出去的却是它原样的像素格式。
  private func extractText() {
    textEditor.end()
    guard let display,
      let image = CaptureExport.render(selection: selection, display: display, editor: nil)?.raw
    else { return report(.captureExtractFailed) }
    extractCard.openBusy()
    placeExtractCard()
    let run = beginExtractRun()
    Task { [weak self] in
      let started = Date()
      do {
        let lines = try await ScreenText.lines(in: image)
        let text = lines.joined(separator: "\n")
        // 探一次模型在不在：不在就**不摆**翻译钮（按了必然失败的那种钮，比没有更糟）。
        var canTranslate = false
        if !text.isEmpty,
          let plan = ScreenTranslation.plan(for: text, appLanguage: DSHAppPrefs.language) {
          canTranslate = await ScreenTranslation.isInstalled(plan)
        }
        guard let self, self.extractRun == run else { return }
        EngineLog.shared.append(
          "[capture] extract text: \(lines.count) lines in \(Self.seconds(since: started))")
        guard !text.isEmpty else { return self.report(.captureExtractEmpty) }
        self.extractCard.show(text: text, canTranslate: canTranslate)
        self.placeExtractCard()
      } catch {
        guard let self, self.extractRun == run else { return }
        // 失败要留第一现场：卡上只给一句"请重试"，原始错误（Vision 报的那个）进日志。
        EngineLog.shared.append(
          "[capture] extract text failed after \(Self.seconds(since: started)): \(error)")
        self.report(.captureExtractFailed)
      }
    }
  }

  /// 卡上的「翻译」：按识别结果的语种翻进应用自己那门语言（``ScreenTranslation``），译文替身
  /// 卡里的正文；系统里没有这对模型时不摆那颗钮。
  private func translateExtracted(_ text: String) {
    guard let plan = ScreenTranslation.plan(for: text, appLanguage: DSHAppPrefs.language) else {
      return extractCard.translationUnavailable()
    }
    let run = extractRun
    Task { [weak self] in
      do {
        let translated = try await ScreenTranslation.translate(text, plan)
        guard let self, self.extractRun == run else { return }
        self.extractCard.showTranslation(translated)
      } catch {
        guard let self, self.extractRun == run else { return }
        EngineLog.shared.append("[capture] translate failed: \(error)")
        self.extractCard.translationUnavailable()
      }
    }
  }

  /// 卡上的「复制」：识别出来的那一段进通用剪贴板（同整图复制那个剪贴板）。
  private func copyExtracted(_ text: String) {
    let pasteboard = NSPasteboard.general
    pasteboard.clearContents()
    pasteboard.setString(text, forType: .string)
  }

  /// 关掉结果卡（关闭钮或 Esc）；键盘交回画布，下一次 Esc 才回到会话那架阶梯。
  /// 在途的识别/翻译随这一关作废——迟到的结果不该把卡再顶回来。
  private func closeExtract() {
    guard extractCard.isOpen else { return }
    extractRun = nil
    extractCard.close()
    focusCanvas()
  }

  /// 一次识别的记号（``extractRun``）：每按一次换一个，卡一关就作废，迟到的结果按记号丢掉。
  private func beginExtractRun() -> UUID {
    let run = UUID()
    extractRun = run
    return run
  }

  private static func seconds(since start: Date) -> String {
    String(format: "%.2fs", Date().timeIntervalSince(start))
  }

  /// 卡里一句说明（没认到字 / 识别失败）：没有可复制的东西，动作也一并收起来。
  private func report(_ key: ShellStringKey) {
    extractCard.show(note: ShellStrings.shared.text(key))
    placeExtractCard()
  }

  private func focusCanvas() {
    guard !textEditor.isEditing, canvas.superview != nil else { return }
    canvas.window?.makeFirstResponder(canvas)
  }

  private func refresh() {
    canvas.needsDisplay = true
    toolbar.update(
      tool: interaction.tool, canUndo: store.undoManager.canUndo,
      canRedo: store.undoManager.canRedo)
    // The chat bar takes the style bar's slot while it is open; closing it brings the style back.
    if let target = styleTarget, !chatBar.isOpen {
      styleBar.update(style: target.style, controls: target.controls)
      styleBar.isHidden = false
    } else {
      styleBar.isHidden = true
    }
    placeToolbar()
  }

  /// What the style bar restyles: the open text, else the selected annotation, else the next one
  /// the active drawing tool makes; nil when there is nothing to style (no tool, the select tool
  /// with nothing selected, or a spotlight), which hides the bar.
  private var styleTarget: (style: AnnotationStyle, controls: AnnotationStyleControls)? {
    let target: (style: AnnotationStyle, controls: AnnotationStyleControls)
    if let style = textEditor.style {
      target = (style, AnnotationTool.text.styleControls)
    } else if let selected = store.selected {
      target = (selected.style, selected.shape.styleControls)
    } else if let tool = interaction.tool {
      target = (interaction.styles[tool.styleSlot], tool.styleControls)
    } else {
      return nil
    }
    let controls = target.controls.shown(for: target.style)
    return controls.isEmpty ? nil : (target.style, controls)
  }

  /// The two bars as one block (``AnnotationToolbarLayout``), beside the selection or where the
  /// user dragged them, with room kept for the style bar's widest form so the toolbar stays put
  /// while the style bar comes and goes or narrows. The open chat bar takes that second slot (one
  /// bar at a time).
  private func placeToolbar() {
    guard let host = toolbar.superview else { return }
    let second = chatBar.isOpen ? chatBar.fittingSize : styleBar.fullSize
    let frames =
      if let movedOrigin {
        AnnotationToolbarLayout.frames(
          toolbar: toolbar.fittingSize, styleBar: second, at: movedOrigin, within: host.bounds)
      } else {
        AnnotationToolbarLayout.frames(
          toolbar: toolbar.fittingSize, styleBar: second, beside: selection,
          within: host.bounds)
      }
    toolbar.frame = frames.toolbar
    let secondBar: NSView = chatBar.isOpen ? chatBar : styleBar
    secondBar.frame = CGRect(origin: frames.styleBar.origin, size: secondBar.fittingSize)
    placeExtractCard()
  }

  /// The extract card hangs under the toolbar and follows it (``AnnotationToolbarLayout/card``):
  /// it is a reading surface, so it goes where the toolbar the user just pressed is.
  private func placeExtractCard() {
    guard extractCard.isOpen, let host = extractCard.superview else { return }
    extractCard.frame = AnnotationToolbarLayout.card(
      extractCard.fittingSize, under: toolbar.frame, within: host.bounds)
  }
}
