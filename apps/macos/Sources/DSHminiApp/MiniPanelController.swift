import Cocoa
import SwiftUI

/// 迷你面板窗口（`SPEC-SEMANTICS §6.1`）：贴屏缘的 nonactivating NSPanel，
/// 全局热键显隐（§4.1，2026-10-12 重绑：主窗口不再占全局热键）。
/// 本文件只管窗口本体、显隐与位置记忆——药丸与展开卡渲染走 SPA 薄入口（树②）、
/// 拖动吸附（树④）、状态点（树⑤ 承接悬浮球）逐树替换；占位胶囊届时由 web 内容接管。
final class MiniPanelController {
    static let shared = MiniPanelController()

    /// 树① 占位药丸尺寸；树② 起内容由 web 薄入口接管。
    static let pillSize = NSSize(width: 44, height: 96)

    private var panel: MiniPanelWindow?
    private var visible = false

    /// 「迷你面板」开关（偏好位；设置行在树⑤ 随悬浮球退役一起接）。
    var enabled: Bool {
        UserDefaults.standard.object(forKey: "deepdive.miniPanel.enabled") == nil
            ? true
            : UserDefaults.standard.bool(forKey: "deepdive.miniPanel.enabled")
    }

    func toggle() {
        if visible { hide() } else { show() }
    }

    func show() {
        guard enabled else { return }
        if panel == nil { panel = MiniPanelWindow() }
        panel?.place()
        // 不抢前台：nonactivating 面板显形，前台应用保持原样。
        panel?.orderFrontRegardless()
        visible = true
    }

    func hide() {
        panel?.orderOut(nil)
        visible = false
    }
}

/// 窗口配方沿用悬浮球前例（`SPEC-NOTIFICATIONS §2.4`）：borderless + nonactivating、
/// 透明底无影（透明窗自带阴影首帧冻结）、跨 Space 常驻。贴主屏可视区右缘，
/// 垂直偏移记进偏好（树④ 拖动时写）。
final class MiniPanelWindow: NSPanel {
    init() {
        super.init(
            contentRect: NSRect(origin: .zero, size: MiniPanelController.pillSize),
            styleMask: [.borderless, .nonactivatingPanel],
            backing: .buffered,
            defer: false
        )
        isOpaque = false
        backgroundColor = .clear
        hasShadow = false
        level = .floating
        collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
        isReleasedWhenClosed = false
        contentView = NSHostingView(rootView: MiniPillPlaceholderView())
        setAccessibilityIdentifier("deepdive.miniPanel")
    }

    func place() {
        let workArea = (NSScreen.main ?? NSScreen.screens[0]).visibleFrame
        let size = MiniPanelController.pillSize
        let yOffset = UserDefaults.standard.double(forKey: "deepdive.miniPanel.yOffset")
        let y = min(
            max(workArea.midY + yOffset - size.height / 2, workArea.minY),
            workArea.maxY - size.height
        )
        setFrameOrigin(NSPoint(x: workArea.maxX - size.width, y: y))
    }
}

/// 树① 占位胶囊：黑白玻璃、品牌剪影居中（与菜单栏/悬浮球同一 `BrandMark` 源）。
private struct MiniPillPlaceholderView: View {
    var body: some View {
        Capsule()
            .fill(Color.black.opacity(0.55))
            .overlay(Capsule().stroke(Color.white.opacity(0.22), lineWidth: 1))
            .frame(width: MiniPanelController.pillSize.width, height: MiniPanelController.pillSize.height)
            .overlay(
                Image(nsImage: BrandMark.image)
                    .resizable()
                    .aspectRatio(contentMode: .fit)
                    .frame(width: 18, height: 18)
            )
    }
}
