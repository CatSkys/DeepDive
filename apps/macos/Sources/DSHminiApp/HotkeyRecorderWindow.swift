import AppKit
import Carbon.HIToolbox

/// Tiny modal-less window for rebinding the global hotkey from the built-in
/// settings page: while visible it captures the next local key combo (the
/// settings page lives in the WebView, whose key events a local monitor
/// would never see), then hands the spec string back. Esc cancels.
final class HotkeyRecorderWindow {
    private let window: NSWindow
    private let label: NSTextField
    private var monitor: Any?
    /// Receives the new "option+space" style spec, or nil on cancel.
    var onResult: ((String?) -> Void)?

    init() {
        let window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 300, height: 90),
            styleMask: [.titled, .closable],
            backing: .buffered,
            defer: false
        )
        window.title = "录制全局热键"
        window.isReleasedWhenClosed = false
        window.center()
        self.window = window

        label = NSTextField(labelWithString: "按下新的组合键（Esc 取消）")
        label.font = .systemFont(ofSize: 13)
        label.translatesAutoresizingMaskIntoConstraints = false
        window.contentView?.addSubview(label)
        NSLayoutConstraint.activate([
            label.centerXAnchor.constraint(equalTo: window.contentView!.centerXAnchor),
            label.centerYAnchor.constraint(equalTo: window.contentView!.centerYAnchor),
        ])
    }

    func showRecorder() {
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
        monitor = NSEvent.addLocalMonitorForEvents(matching: .keyDown) { [weak self] event in
            guard let self, event.window === self.window else { return event }
            if let m = self.monitor { NSEvent.removeMonitor(m) }
            self.monitor = nil
            let flags = event.modifierFlags.intersection(.deviceIndependentFlagsMask)
            if event.keyCode == UInt16(kVK_Escape) {
                self.onResult?(nil)
                self.window.orderOut(nil)
                return nil
            }
            guard let spec = Self.hotkeySpec(keyCode: event.keyCode, flags: flags) else {
                self.label.stringValue = "该组合键不可用，请重试（Esc 取消）"
                // Keep recording: re-arm a fresh monitor.
                self.rearm()
                return nil
            }
            self.onResult?(spec)
            self.window.orderOut(nil)
            return nil
        }
    }

    private func rearm() {
        monitor = NSEvent.addLocalMonitorForEvents(matching: .keyDown) { [weak self] event in
            guard let self, event.window === self.window else { return event }
            if let m = self.monitor { NSEvent.removeMonitor(m) }
            self.monitor = nil
            let flags = event.modifierFlags.intersection(.deviceIndependentFlagsMask)
            if event.keyCode == UInt16(kVK_Escape) {
                self.onResult?(nil)
                self.window.orderOut(nil)
                return nil
            }
            guard let spec = Self.hotkeySpec(keyCode: event.keyCode, flags: flags) else {
                self.label.stringValue = "该组合键不可用，请重试（Esc 取消）"
                self.rearm()
                return nil
            }
            self.onResult?(spec)
            self.window.orderOut(nil)
            return nil
        }
    }

    /// NSEvent → "option+space" style spec (HotKeyManager.parse vocabulary:
    /// option/alt, control/ctrl, shift, command/cmd/meta + space/return/esc/
    /// tab/backspace or single alphanumerics).
    static func hotkeySpec(keyCode: UInt16, flags: NSEvent.ModifierFlags) -> String? {
        var key: String?
        switch Int(keyCode) {
        case kVK_Space: key = "space"
        case kVK_Return: key = "return"
        case kVK_Escape: key = "esc"
        case kVK_Tab: key = "tab"
        case kVK_Delete: key = "backspace"
        default: break
        }
        if key == nil {
            if (0 <= Int(keyCode) && Int(keyCode) <= 25) { key = String(UnicodeScalar(UInt8(97 + Int(keyCode)))) }
            else if (29 <= Int(keyCode) && Int(keyCode) <= 38) { key = String(UnicodeScalar(UInt8(48 + Int(keyCode) - 29))) }
        }
        guard let k = key else { return nil }
        var parts: [String] = []
        if flags.contains(.command) { parts.append("command") }
        if flags.contains(.control) { parts.append("control") }
        if flags.contains(.option) { parts.append("option") }
        if flags.contains(.shift) { parts.append("shift") }
        guard !parts.isEmpty else { return nil }
        return (parts + [k]).joined(separator: "+")
    }
}
