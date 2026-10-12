import Cocoa
import SwiftUI

/// 迷你面板窗口（全原生重做，Atd 同构）：nonactivating NSPanel + 玻璃胶囊 +
/// SwiftUI 内容。布局/显式重排/窗口动画/点按 vs 拖动/贴边吸附都收口在这。
/// 药丸 8×44 常驻；展开 = 44 宽玻璃胶囊（玻璃只裁胶囊形——整窗铺玻璃就是
/// "方块"事故的根源），命令卡是条目列旁的自绘浮卡，开卡时窗口向卡侧变宽、
/// 胶囊原地不动（Atd choreography）。视觉件（点/钮/卡）归 `MiniPanelView.swift`。
@MainActor
final class MiniPanelWindow: NSPanel {
    /// 药丸钉在**用户所在的那块屏**（指针处），不是 NSScreen.main——多屏下
    /// main 是主屏（0,0 那块），用户看的不一定是它（实机翻车根因）。
    static func userScreen() -> NSScreen {
        // 优先上次记住的屏（拖过去的归属跨启动保留），没有再退指针屏。
        let saved = UserDefaults.standard.integer(forKey: "deepdive.miniPanel.screenID")
        if saved != 0, let hit = NSScreen.screens.first(where: { displayID(of: $0) == saved }) {
            return hit
        }
        let loc = NSEvent.mouseLocation
        return NSScreen.screens.first { $0.frame.contains(loc) } ?? NSScreen.main ?? NSScreen.screens[0]
    }
    /// NSScreen → CGDirectDisplayID（NSScreen.displayID 在新 SDK 已移除）。
    private static func displayID(of screen: NSScreen) -> Int {
        (screen.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as? NSNumber)?.intValue ?? 0
    }
    /// 收起态窗壳 16×48（比 8×44 胶囊大一圈留拖抓余量，玻璃裁居中胶囊）。
    static let tucked = NSSize(width: 16, height: 48)
    /// 展开态胶囊（Atd：宽 44 = 衬 6 + 钮 32 + 缝 4；高 = 状态槽 32 / 分隔线 / 三钮）。
    static let capsule = NSSize(width: 44, height: 157)
    /// 命令卡（Atd：圆角 18、行高 28）；卡与胶囊之间留 8 缝。
    static let cardWidth: CGFloat = 224
    static let cardRowHeight: CGFloat = 28
    static let cardGap: CGFloat = 8

    let model = MiniPanelModel()
    private let glass = WindowGlassView(frame: .zero)
    private let hosting: NSHostingView<MiniPanelView>
    /// 抓取区：收起态整窗抓（原位松手=点击展开）；展开态交给各钮自己命中。
    private var mouseDownLocation: NSPoint?
    private var clickMonitor: Any?

    init() {
        hosting = NSHostingView(rootView: MiniPanelView(model: model))
        super.init(
            contentRect: NSRect(origin: .zero, size: Self.tucked),
            styleMask: [.borderless, .nonactivatingPanel],
            backing: .buffered,
            defer: false
        )
        isOpaque = false
        backgroundColor = .clear
        hasShadow = false
        level = .floating
        collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
        isMovableByWindowBackground = false // 抓取走显式 mouseDown（点击/拖动要分开）
        isReleasedWhenClosed = false
        setAccessibilityIdentifier("deepdive.miniPanel")

        let content = NSView()
        content.wantsLayer = true
        content.addSubview(glass)
        hosting.frame = content.bounds
        hosting.autoresizingMask = [.width, .height]
        content.addSubview(hosting)
        contentView = content

        // 状态回填（悬浮球 retired 的承接面；SPEC-NOTIFICATIONS §2）
        hosting.rootView = MiniPanelView(model: model)
        // 命令卡开合改变窗口几何 → 回宿主重排（窗口宽/高随卡变，见 applyState）。
        model.onFlyoutChanged = { [weak self] in
            guard let self, self.model.expanded else { return }
            self.applyState(expanded: true)
        }

        // 系统明暗翻转 → 玻璃重定档（appearance=system 时跟拍）
        observe(\.effectiveAppearance, options: [.new]) { [weak self] _, _ in
            self?.syncGlassAppearance()
        }
        // 拖完吸附（Atd 语义）：松手后按所在屏吸附近缘，归属（side/yOffset/屏）存档。
        NotificationCenter.default.addObserver(
            self, selector: #selector(snapAfterMove),
            name: NSWindow.didMoveNotification, object: self
        )
        syncGlassAppearance()
    }

    func showTucked() {
        applyState(expanded: false)
        orderFrontRegardless()
    }

    func setExpanded(_ on: Bool) {
        applyState(expanded: on)
        setOutsideClickCollapse(on)
    }

    /// 窗口几何是页面态的函数：收起 = 16×48 药丸；展开 = 44×157 胶囊；开卡再向
    /// 卡侧加宽（卡高按行数算，上限让出工作区）。锚在胶囊中心 Y——卡再高胶囊也不挪位。
    private func applyState(expanded on: Bool) {
        let workArea = (screen ?? Self.userScreen()).visibleFrame
        let side = MiniPanelController.shared.side
        model.side = side
        model.expanded = on
        if !on { model.flyoutOpen = false }
        let flyout = on && model.flyoutOpen
        let height: CGFloat
        let width: CGFloat
        if !on {
            height = Self.tucked.height
            width = Self.tucked.width
        } else if flyout {
            height = max(Self.capsule.height, min(cardHeight(), workArea.height - 16))
            width = Self.cardWidth + Self.cardGap + Self.capsule.width
        } else {
            height = Self.capsule.height
            width = Self.capsule.width
        }
        let yOffset = UserDefaults.standard.double(forKey: "deepdive.miniPanel.yOffset")
        let midY = min(max(workArea.midY + yOffset, workArea.minY + height / 2), workArea.maxY - height / 2)
        let x = side == "left" ? workArea.minX : workArea.maxX - width
        let target = NSRect(origin: NSPoint(x: x, y: midY - height / 2), size: NSSize(width: width, height: height))

        NSAnimationContext.runAnimationGroup { ctx in
            ctx.duration = 0.22
            ctx.timingFunction = CAMediaTimingFunction(name: .easeOut)
            ctx.allowsImplicitAnimation = true
            animator().setFrame(target, display: true)
        }
        // 子视图显式重排（hosting 不跟手 = 图标被裁进 16px 缝，实机三犯同型错误）
        if let content = contentView {
            hosting.frame = content.bounds
        }
        layoutGlass()
        syncGlassAppearance()
    }

    /// 卡内容高（与 CommandFlyout 的衬 6 / 行 28 / 缝 2 一一对应）；无会话或无命令
    /// 时是一行说明文案。
    private func cardHeight() -> CGFloat {
        let rows = (model.quickSessionId == nil || model.commands.isEmpty)
            ? 1 : model.commands.count
        return 12 + CGFloat(rows) * Self.cardRowHeight + CGFloat(max(rows - 1, 0)) * 2
    }

    /// 玻璃形状的唯一事实源：只铺胶囊——收起 = 居中 8×44（r4），展开 = 44×157
    /// 贴卡侧边（r22）；命令卡区域自绘近实色、不铺玻璃。
    private func layoutGlass() {
        guard let content = contentView else { return }
        let bounds = content.bounds
        let rect: NSRect
        if model.expanded {
            let capW = Self.capsule.width
            let x = model.side == "left" ? 0 : bounds.width - capW
            rect = NSRect(x: x, y: (bounds.height - Self.capsule.height) / 2, width: capW, height: Self.capsule.height)
        } else {
            rect = NSRect(x: (bounds.width - 8) / 2, y: (bounds.height - 44) / 2, width: 8, height: 44)
        }
        glass.frame = rect
        glass.setCornerRadius(model.expanded ? Self.capsule.width / 2 : 4)
    }

    /// 玻璃外观与主窗同一解析（材质/tint 随明暗）。
    private func syncGlassAppearance() {
        let mode = DSHAppPrefs.appearance
        let light = mode == "light" || (mode == "system" && NSApp.effectiveAppearance.bestMatch(from: [.aqua, .darkAqua]) == .aqua)
        appearance = mode == "system" ? nil : NSAppearance(named: light ? .aqua : .darkAqua)
        glass.applyAppearance(light: light)
    }

    @objc private func snapAfterMove() {
        guard !model.expanded else { return } // 展开态不吸附（收起态的归属由拖动决定）
        guard let screen else { return }
        let workArea = screen.visibleFrame
        let toLeft = abs(frame.minX - workArea.minX) <= abs(workArea.maxX - frame.maxX)
        let side = toLeft ? "left" : "right"
        UserDefaults.standard.set(side, forKey: "deepdive.miniPanel.side")
        UserDefaults.standard.set(frame.midY - workArea.midY, forKey: "deepdive.miniPanel.yOffset")
        UserDefaults.standard.set(Self.displayID(of: screen), forKey: "deepdive.miniPanel.screenID")
        applyState(expanded: false)
    }

    // MARK: 点击 vs 拖动（Atd 语义：原位松手=点击展开/动作，移动=拖）

    override func mouseDown(with event: NSEvent) {
        mouseDownLocation = NSEvent.mouseLocation
        if !model.expanded {
            // 收起态：移动交给窗口拖拽（isMovableByWindowBackground 已关，手动接管）
            performDrag(with: event)
        }
    }

    override func mouseUp(with event: NSEvent) {
        defer { mouseDownLocation = nil }
        guard !model.expanded, let down = mouseDownLocation else { return }
        let moved = hypot(down.x - NSEvent.mouseLocation.x, down.y - NSEvent.mouseLocation.y)
        if moved < 3 {
            MiniPanelController.shared.setExpanded(true)
        }
    }

    /// 展开期间监听窗口外点击 → 收起；收起即撤（树④ 纪律）。
    private func setOutsideClickCollapse(_ on: Bool) {
        if on, clickMonitor == nil {
            clickMonitor = NSEvent.addGlobalMonitorForEvents(matching: [.leftMouseDown]) { [weak self] _ in
                guard let self, self.model.expanded, !self.frame.contains(NSEvent.mouseLocation) else { return }
                MiniPanelController.shared.setExpanded(false)
            }
        } else if !on, let monitor = clickMonitor {
            NSEvent.removeMonitor(monitor)
            clickMonitor = nil
        }
    }
}
