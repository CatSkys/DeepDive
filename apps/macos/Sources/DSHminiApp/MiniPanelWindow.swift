import Cocoa
import SwiftUI

/// 迷你面板窗口（全原生重做，Atd 同构）：nonactivating NSPanel + NSGlassEffectView
/// 玻璃 + SwiftUI 内容。布局/显式重排/窗口动画/点按 vs 拖动/贴边吸附都收口在这。
/// 药丸 8×44 常驻；条目列由页面态（expanded）驱动、玻璃随窗口整铺（Atd 同款：
/// 玻璃形状=窗口圆角，内容居中缩放）。
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
    static let tucked = NSSize(width: 16, height: 48)
    static let expanded = NSSize(width: 300, height: 260)

    let model = MiniPanelModel()
    private let glass = WindowGlassView(frame: .zero)
    private let hosting: NSHostingView<MiniPanelView>
    /// 抓取区：收起态整窗抓（原位松手=点击展开）；展开态整窗可拖。
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
        glass.frame = NSRect(origin: .zero, size: Self.tucked)
        content.addSubview(glass)
        hosting.frame = content.bounds
        content.addSubview(hosting)
        contentView = content

        // 状态回填（悬浮球 retired 的承接面；SPEC-NOTIFICATIONS §2）
        hosting.rootView = MiniPanelView(model: model)

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

        if let base = BridgeServer.shared.url { /* no web: 全原生无页面 */ }
    }

    func showTucked() {
        applyState(expanded: false)
        orderFrontRegardless()
    }

    func setExpanded(_ on: Bool) {
        applyState(expanded: on)
        setOutsideClickCollapse(on)
    }

    private func applyState(expanded on: Bool) {
        let workArea = (screen ?? MiniPanelWindow.userScreen()).visibleFrame
        let size = on ? Self.expanded : Self.tucked
        let side = MiniPanelController.shared.side
        let yOffset = UserDefaults.standard.double(forKey: "deepdive.miniPanel.yOffset")
        let y = min(max(workArea.midY + yOffset - size.height / 2, workArea.minY), workArea.maxY - size.height)
        let x = side == "left" ? workArea.minX : workArea.maxX - size.width
        let target = NSRect(origin: NSPoint(x: x, y: y), size: size)

        model.side = side
        model.expanded = on
        NSAnimationContext.runAnimationGroup { ctx in
            ctx.duration = 0.22
            ctx.timingFunction = CAMediaTimingFunction(name: .easeOut)
            ctx.allowsImplicitAnimation = true
            animator().setFrame(target, display: true)
        }
        syncGlassAppearance()
    }

    /// 玻璃 = 窗口圆角整铺（Atd：玻璃形状与窗口同圆角；收起态同理 8×44 全铺——
    /// 此前"只铺 8px 饼"的做法废掉）。外观与主窗同源解析。
    private func syncGlassAppearance() {
        let mode = DSHAppPrefs.appearance
        let light = mode == "light" || (mode == "system" && NSApp.effectiveAppearance.bestMatch(from: [.aqua, .darkAqua]) == .aqua)
        appearance = mode == "system" ? nil : NSAppearance(named: light ? .aqua : .darkAqua)
        glass.applyAppearance(light: light)
        glass.frame = contentView?.bounds ?? .zero
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
