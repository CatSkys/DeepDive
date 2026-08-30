import Foundation
import Carbon.HIToolbox

/// Global hotkey registered through Carbon (consume-capable, unlike an
/// NSEvent local monitor). v1 spec: "option+space" style strings, one key.
final class HotKeyManager {
    var onHotKey: (() -> Void)?

    private(set) var registered = false
    private var hotKeyRef: EventHotKeyRef?
    private var eventHandler: EventHandlerRef?

    @discardableResult
    func register(spec: String) -> Bool {
        unregister()
        guard let (modifiers, keyCode) = Self.parse(spec) else { return false }

        var eventType = EventTypeSpec(
            eventClass: OSType(kEventClassKeyboard),
            eventKind: UInt32(kEventHotKeyPressed)
        )
        let handler: EventHandlerUPP = { _, event, userData -> OSStatus in
            guard let userData else { return noErr }
            let manager = Unmanaged<HotKeyManager>.fromOpaque(userData).takeUnretainedValue()
            manager.onHotKey?()
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
        guard status == noErr else { return false }

        let hotKeyID = EventHotKeyID(signature: OSType(0x44534D49), id: 1) // 'DSMI'
        let regStatus = RegisterEventHotKey(
            UInt32(keyCode),
            UInt32(modifiers),
            hotKeyID,
            GetApplicationEventTarget(),
            0,
            &hotKeyRef
        )
        registered = regStatus == noErr
        return registered
    }

    func unregister() {
        if let ref = hotKeyRef {
            UnregisterEventHotKey(ref)
            hotKeyRef = nil
        }
        if let handler = eventHandler {
            RemoveEventHandler(handler)
            eventHandler = nil
        }
        registered = false
    }

    // MARK: - spec parsing ("option+space", "control+shift+r", …)

    private static func parse(_ spec: String) -> (modifiers: Int, keyCode: UInt32)? {
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

    private static func keyCode(for key: String) -> UInt32? {
        switch key {
        case "space": return UInt32(kVK_Space)
        case "return", "enter": return UInt32(kVK_Return)
        case "esc", "escape": return UInt32(kVK_Escape)
        case "tab": return UInt32(kVK_Tab)
        case "backspace": return UInt32(kVK_Delete)
        default:
            break
        }
        let scalars = key.unicodeScalars
        guard scalars.count == 1, let c = scalars.first?.value else { return nil }
        if c >= 97 && c <= 122 { return UInt32(c - 97) }       // a-z → kVK_ANSI_A..Z
        if c >= 48 && c <= 57 { return UInt32(c - 48 + 29) }   // 0-9 → kVK_ANSI_0=29
        if c >= 65 && c <= 90 { return UInt32(c - 65) }        // A-Z (lowered first)
        return nil
    }
}
