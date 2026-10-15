import Foundation
import Carbon.HIToolbox

/// Global hotkeys registered through Carbon (consume-capable, unlike an
/// NSEvent local monitor). Several named slots share one event handler;
/// spec strings are "option+space" style, one key.
final class HotKeyManager {
    /// 一条全局热键的槽位：面板显隐、截图。签名固定 'DSMI'，id 即槽位。
    enum Slot: UInt32 {
        case panel = 1
        case screenshot = 2
    }

    var onPanelHotKey: (() -> Void)?
    var onScreenshotHotKey: (() -> Void)?

    private var refs: [Slot: EventHotKeyRef] = [:]
    private var eventHandler: EventHandlerRef?

    /// 注册槽位，覆盖该槽位原有绑定；false = 组合非法或系统拒绝（已被占用）。
    @discardableResult
    func register(_ slot: Slot, spec: String) -> Bool {
        unregister(slot)
        guard let (modifiers, keyCode) = Self.parse(spec) else { return false }
        guard installHandlerIfNeeded() else { return false }

        var ref: EventHotKeyRef?
        let hotKeyID = EventHotKeyID(signature: OSType(0x44534D49), id: slot.rawValue) // 'DSMI'
        let status = RegisterEventHotKey(
            UInt32(keyCode),
            UInt32(modifiers),
            hotKeyID,
            GetApplicationEventTarget(),
            0,
            &ref
        )
        guard status == noErr, let ref else { return false }
        refs[slot] = ref
        return true
    }

    func unregister(_ slot: Slot) {
        if let ref = refs.removeValue(forKey: slot) { UnregisterEventHotKey(ref) }
    }

    /// 全部注销并摘掉事件处理器（退出前用）。
    func unregisterAll() {
        for ref in refs.values { UnregisterEventHotKey(ref) }
        refs.removeAll()
        if let eventHandler {
            RemoveEventHandler(eventHandler)
            self.eventHandler = nil
        }
    }

    /// 装一次事件处理器；按按下热键的 id 分发到对应槽位的回调。
    private func installHandlerIfNeeded() -> Bool {
        if eventHandler != nil { return true }
        var eventType = EventTypeSpec(
            eventClass: OSType(kEventClassKeyboard),
            eventKind: UInt32(kEventHotKeyPressed)
        )
        let handler: EventHandlerUPP = { _, event, userData -> OSStatus in
            guard let userData, let event else { return noErr }
            var hotKeyID = EventHotKeyID()
            let status = GetEventParameter(
                event,
                EventParamName(kEventParamDirectObject),
                EventParamType(typeEventHotKeyID),
                nil,
                MemoryLayout<EventHotKeyID>.size,
                nil,
                &hotKeyID
            )
            guard status == noErr else { return noErr }
            let manager = Unmanaged<HotKeyManager>.fromOpaque(userData).takeUnretainedValue()
            manager.fire(Slot(rawValue: hotKeyID.id))
            return noErr
        }
        let status = InstallEventHandler(
            GetApplicationEventTarget(),
            handler,
            1,
            &eventType,
            Unmanaged.passUnretained(self).toOpaque(),
            &eventHandler
        )
        return status == noErr
    }

    private func fire(_ slot: Slot?) {
        switch slot {
        case .panel: onPanelHotKey?()
        case .screenshot: onScreenshotHotKey?()
        case nil: break
        }
    }

    // MARK: - spec parsing ("option+space", "control+shift+r", …)
    // internal for unit tests (@testable)

    static func parse(_ spec: String) -> (modifiers: Int, keyCode: UInt32)? {
        let parts = spec.lowercased().split(separator: "+").map(String.init)
        guard !parts.isEmpty else { return nil }
        var modifiers = 0
        for part in parts.dropLast() {
            switch part {
            case "option", "alt": modifiers |= optionKey
            case "control", "ctrl": modifiers |= controlKey
            case "shift": modifiers |= shiftKey
            case "command", "cmd", "meta": modifiers |= cmdKey
            default: return nil
            }
        }
        let key = parts.last!
        guard let keyCode = keyCode(for: key) else { return nil }
        return (modifiers, keyCode)
    }

    // MARK: - ANSI key table (real Carbon keycodes)

    /// Key name ↔ real kVK_ANSI_* keycode. Carbon letter/digit codes are NOT
    /// ordinal (kVK_ANSI_E=14 but kVK_ANSI_R=15, kVK_ANSI_1=18 while
    /// kVK_ANSI_0=29); an ordinal mapping silently registers the wrong
    /// physical key. parse (register) and HotkeyRecorderWindow.hotkeySpec
    /// (record) share this table so a spec string always names the physical
    /// key it was recorded from. Canonical names only — aliases normalize in
    /// keyCode(for:) so the reverse map stays deterministic.
    static let ansiKeys: [String: UInt32] = [
        "a": UInt32(kVK_ANSI_A), "s": UInt32(kVK_ANSI_S), "d": UInt32(kVK_ANSI_D),
        "f": UInt32(kVK_ANSI_F), "h": UInt32(kVK_ANSI_H), "g": UInt32(kVK_ANSI_G),
        "z": UInt32(kVK_ANSI_Z), "x": UInt32(kVK_ANSI_X), "c": UInt32(kVK_ANSI_C),
        "v": UInt32(kVK_ANSI_V), "b": UInt32(kVK_ANSI_B), "q": UInt32(kVK_ANSI_Q),
        "w": UInt32(kVK_ANSI_W), "e": UInt32(kVK_ANSI_E), "r": UInt32(kVK_ANSI_R),
        "y": UInt32(kVK_ANSI_Y), "t": UInt32(kVK_ANSI_T), "o": UInt32(kVK_ANSI_O),
        "u": UInt32(kVK_ANSI_U), "i": UInt32(kVK_ANSI_I), "p": UInt32(kVK_ANSI_P),
        "l": UInt32(kVK_ANSI_L), "j": UInt32(kVK_ANSI_J), "k": UInt32(kVK_ANSI_K),
        "n": UInt32(kVK_ANSI_N), "m": UInt32(kVK_ANSI_M),
        "0": UInt32(kVK_ANSI_0), "1": UInt32(kVK_ANSI_1), "2": UInt32(kVK_ANSI_2),
        "3": UInt32(kVK_ANSI_3), "4": UInt32(kVK_ANSI_4), "5": UInt32(kVK_ANSI_5),
        "6": UInt32(kVK_ANSI_6), "7": UInt32(kVK_ANSI_7), "8": UInt32(kVK_ANSI_8),
        "9": UInt32(kVK_ANSI_9),
        "space": UInt32(kVK_Space), "return": UInt32(kVK_Return), "esc": UInt32(kVK_Escape),
        "tab": UInt32(kVK_Tab), "backspace": UInt32(kVK_Delete),
    ]
    static let keyNameByCode: [UInt32: String] = Dictionary(uniqueKeysWithValues: ansiKeys.map { ($0.value, $0.key) })

    private static func keyCode(for key: String) -> UInt32? {
        let normalized: String
        switch key {
        case "enter": normalized = "return"
        case "escape": normalized = "esc"
        default: normalized = key
        }
        return ansiKeys[normalized]
    }
}
