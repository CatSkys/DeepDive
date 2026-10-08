import SwiftUI
import AppKit

/// Floating bubble state, derived entirely from the native event observer
/// (SPEC-NOTIFICATIONS §2.2): no fields are pushed in from the frontend.
final class FloatingBubbleManager: ObservableObject {
    static let shared = FloatingBubbleManager()

    @Published var unseenCompletion = false
    @Published var running = false
    @Published var attention = false

    /// Persisted toggle; default on (§2.2). Settings「通知」分区 + status-bar
    /// surface flip this through setEnabled(_:).
    var enabled: Bool {
        UserDefaults.standard.object(forKey: "deepdive.bubble.enabled") == nil
            ? true
            : UserDefaults.standard.bool(forKey: "deepdive.bubble.enabled")
    }

    /// The session the next bubble click should focus (last attention or last
    /// finished turn); routed through the §3.1 shell→frontend bridge.
    private(set) var focusSessionId: String?

    private var panel: FloatingBubblePanel?

    private init() {
        Self.migrateLegacyBubbleKeys()
        // §2.2: app becoming active clears the unseen-completion marker.
        NotificationCenter.default.addObserver(
            self, selector: #selector(appBecameActive),
            name: NSApplication.didBecomeActiveNotification, object: nil
        )
    }

    func setEnabled(_ on: Bool) {
        UserDefaults.standard.set(on, forKey: "deepdive.bubble.enabled")
        if on { show() } else { hide() }
    }

    func toggle() {
        setEnabled(!enabled)
    }

    // MARK: - observer feed

    func sync(running: Bool, attention: Bool) {
        self.running = running
        self.attention = attention
        ensurePanelState()
    }

    func noteRunningStarted(sessionId: String) {
        unseenCompletion = false
    }

    func noteTurnFinished(sessionId: String, appInactive: Bool) {
        if appInactive { unseenCompletion = true }
        // 点击要去的是"最近完成的那个"：旧实现只在 nil 时设一次，此后永远指向
        // 本次运行里第一个完成（往往早就看过了）的会话。
        focusSessionId = sessionId
    }

    func noteNeedsAttention() {
        attention = true
    }

    @objc private func appBecameActive() {
        unseenCompletion = false
    }

    // MARK: - prefs key migration (AUD-029)

    /// 键名 dsh.bubble.* → deepdive.bubble.* 的一次性迁移。旧键写在新偏好
    /// 域里（改名后引入的特性），LegacyPrefsMigration 的跨域一次性开关已
    /// 消费过，管不到这批——用独立开关搬值：新键未写则搬，旧键一律删除。
    private static func migrateLegacyBubbleKeys() {
        let defaults = UserDefaults.standard
        guard !defaults.bool(forKey: "deepdive.bubbleMigratedFromDsh") else { return }
        for (oldKey, newKey) in [
            ("dsh.bubble.enabled", "deepdive.bubble.enabled"),
            ("dsh.bubble.frame", "deepdive.bubble.frame"),
        ] {
            if let value = defaults.object(forKey: oldKey) {
                if defaults.object(forKey: newKey) == nil {
                    defaults.set(value, forKey: newKey)
                }
                defaults.removeObject(forKey: oldKey)
            }
        }
        defaults.set(true, forKey: "deepdive.bubbleMigratedFromDsh")
    }

    // MARK: - interaction (§2.3)

    func bubbleClicked() {
        unseenCompletion = false
        NSApp.activate(ignoringOtherApps: true)
        AppDelegate.shared?.showMainWindow()
        if let focus = focusSessionId {
            AppDelegate.shared?.pushNavigateToSession(focus)
        }
    }

    // MARK: - panel

    private func ensurePanelState() {
        if enabled {
            show()
        } else {
            hide()
        }
    }

    func show() {
        guard enabled else { return }
        if panel == nil {
            panel = FloatingBubblePanel()
        }
        panel?.showBubble()
    }

    func hide() {
        panel?.orderOut(nil)
    }
}

/// Borderless non-activating floating panel (SPEC §2.1): clear background, no
/// window shadow (SwiftUI paints its own), joins all spaces, draggable by the
/// window background — SwiftUI gestures must NOT be added for dragging (they
/// swallow mouseDown); hover uses onHover which consumes nothing.
final class FloatingBubblePanel: NSPanel {
    static let canvas: CGFloat = 84

    init() {
        super.init(
            contentRect: NSRect(x: 0, y: 0, width: FloatingBubblePanel.canvas, height: FloatingBubblePanel.canvas),
            styleMask: [.borderless, .nonactivatingPanel],
            backing: .buffered,
            defer: false
        )
        isOpaque = false
        backgroundColor = .clear
        hasShadow = false // transparent-window shadow freezes on first frame
        level = .floating
        collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
        isMovableByWindowBackground = true
        isReleasedWhenClosed = false
        contentView = NSHostingView(rootView: FloatingBubbleView())
        setAccessibilityIdentifier("deepdive.floatingBubble")
    }

    func showBubble() {
        let saved = UserDefaults.standard.string(forKey: "deepdive.bubble.frame")
        if let saved, !isVisible {
            setFrameOrigin(saved.pointValue ?? defaultOrigin())
        } else if !isVisible {
            setFrameOrigin(defaultOrigin())
        }
        makeKeyAndOrderFront(nil)
    }

    private func defaultOrigin() -> NSPoint {
        // Default: top-right of the main screen, below the menu bar.
        guard let screen = NSScreen.main else { return NSPoint(x: 40, y: 40) }
        let visible = screen.visibleFrame
        return NSPoint(
            x: visible.maxX - FloatingBubblePanel.canvas - 16,
            y: visible.maxY - FloatingBubblePanel.canvas - 8
        )
    }

    override func setFrameOrigin(_ point: NSPoint) {
        super.setFrameOrigin(point)
        UserDefaults.standard.set("\(point.x),\(point.y)", forKey: "deepdive.bubble.frame")
    }
}

extension String {
    var pointValue: NSPoint? {
        let parts = split(separator: ",").compactMap { Double($0) }
        guard parts.count == 2 else { return nil }
        return NSPoint(x: parts[0], y: parts[1])
    }
}

/// Monochrome bubble (UI-SPEC discipline): black/white circle, DeepDive mark in
/// currentColor, status expressed by symbol + brightness only — no red dots.
/// 运行=亮环呼吸；后台完成未读=白点呼吸；需注意=亮环静止+实心点。
struct FloatingBubbleView: View {
    @ObservedObject var manager = FloatingBubbleManager.shared
    @State private var pulse = false
    @State private var hovered = false

    private let circleSize: CGFloat = 44
    private let scale: CGFloat = FloatingBubblePanel.canvas / 50.0

    var body: some View {
        ZStack {
            // Status ring / dot zone (the 84pt canvas around the 44pt circle).
            if manager.running {
                Circle()
                    .stroke(Color.white.opacity(0.7), lineWidth: 1.5)
                    .frame(width: circleSize + 10, height: circleSize + 10)
                Circle()
                    .stroke(Color.white.opacity(0.25), lineWidth: 1)
                    .frame(width: circleSize + 22, height: circleSize + 22)
                    .opacity(0.5)
            } else if manager.unseenCompletion {
                Circle()
                    .fill(Color.white)
                    .frame(width: 8, height: 8)
                    .offset(x: 18, y: -18)
                Circle()
                    .stroke(Color.white.opacity(0.5), lineWidth: 1)
                    .frame(width: circleSize + 10, height: circleSize + 10)
                    .opacity(0.35)
            } else if manager.attention {
                Circle()
                    .fill(Color.white)
                    .frame(width: 8, height: 8)
                    .offset(x: 18, y: -18)
                Circle()
                    .stroke(Color.white.opacity(0.7), lineWidth: 1.5)
                    .frame(width: circleSize + 10, height: circleSize + 10)
            }

            // Central 44pt circle + mark silhouette.
            Circle()
                .fill(Color.black.opacity(0.55))
                .frame(width: circleSize, height: circleSize)
                .overlay(
                    Circle()
                        .stroke(Color.white.opacity(0.35), lineWidth: 1)
                )
                .overlay(
                    Image(nsImage: BrandMark.image)
                        .resizable()
                        .aspectRatio(contentMode: .fit)
                        .frame(width: 26, height: 26)
                        .colorMultiply(.white)
                )
        }
        .frame(width: FloatingBubblePanel.canvas, height: FloatingBubblePanel.canvas)
        .scaleEffect(hovered ? 1.06 : 1.0)
        .animation(.easeInOut(duration: 0.12), value: hovered)
        .onHover { hovering in
            hovered = hovering
        }
        .onTapGesture {
            manager.bubbleClicked()
        }
        .accessibilityLabel("DeepDive 悬浮球")
        .accessibilityHint("单击打开主窗口")
    }
}
