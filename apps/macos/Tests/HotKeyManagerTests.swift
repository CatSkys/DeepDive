import XCTest
import Carbon.HIToolbox
@testable import DeepDive

/// 全局热键 spec 解析与录制器词汇的一致性（R-002）。注意：a–z/数字键名走
/// "序号式"映射（parse 与 hotkeySpec 两端一致），不是 Carbon 真实键码表；
/// 这里锁的功能性契约是"录制器产出的 spec 能注册回同一物理键"。
final class HotKeyManagerTests: XCTestCase {
    func testParseSpecialKeys() throws {
        let r = try XCTUnwrap(HotKeyManager.parse("option+space"))
        XCTAssertEqual(r.modifiers, Int(optionKey))
        XCTAssertEqual(r.keyCode, UInt32(kVK_Space))
        XCTAssertEqual(HotKeyManager.parse("return")?.keyCode, UInt32(kVK_Return))
        XCTAssertEqual(HotKeyManager.parse("enter")?.keyCode, UInt32(kVK_Return))
        XCTAssertEqual(HotKeyManager.parse("esc")?.keyCode, UInt32(kVK_Escape))
        XCTAssertEqual(HotKeyManager.parse("escape")?.keyCode, UInt32(kVK_Escape))
        XCTAssertEqual(HotKeyManager.parse("tab")?.keyCode, UInt32(kVK_Tab))
        XCTAssertEqual(HotKeyManager.parse("backspace")?.keyCode, UInt32(kVK_Delete))
    }

    func testParseModifierAliasesAndCase() {
        XCTAssertEqual(HotKeyManager.parse("alt+space")?.modifiers, Int(optionKey))
        XCTAssertEqual(HotKeyManager.parse("CTRL+space")?.modifiers, Int(controlKey))
        XCTAssertEqual(HotKeyManager.parse("Shift+Space")?.modifiers, Int(shiftKey))
        XCTAssertEqual(HotKeyManager.parse("command+shift+a")?.modifiers, cmdKey | shiftKey)
        XCTAssertEqual(HotKeyManager.parse("meta+a")?.modifiers, Int(cmdKey))
    }

    func testParseRejectsUnknown() {
        XCTAssertNil(HotKeyManager.parse("hyper+space"))  // 未知修饰键
        XCTAssertNil(HotKeyManager.parse("option+"))      // 空键名
        XCTAssertNil(HotKeyManager.parse("option"))       // 修饰键当键名
        XCTAssertNil(HotKeyManager.parse(""))
    }

    func testRecorderRoundTripPreservesKeyCode() {
        let flags: NSEvent.ModifierFlags = .option
        // 覆盖字母序号段/数字序号段/特殊键：录制 spec → parse 必须回到同一 keyCode
        let codes: [UInt16] = [0, 5, 17, 18, 25, 29, 33, 38, UInt16(kVK_Space), UInt16(kVK_Return)]
        for code in codes {
            guard let spec = HotkeyRecorderWindow.hotkeySpec(keyCode: code, flags: flags) else {
                return XCTFail("no spec for keyCode \(code)")
            }
            let back = HotKeyManager.parse(spec)
            XCTAssertEqual(back?.keyCode, UInt32(code), "spec \"\(spec)\" must re-register keyCode \(code)")
            XCTAssertEqual(back?.modifiers, Int(optionKey))
        }
    }

    func testRecorderRequiresModifier() {
        XCTAssertNil(HotkeyRecorderWindow.hotkeySpec(keyCode: UInt16(kVK_Space), flags: []))
        XCTAssertNil(HotkeyRecorderWindow.hotkeySpec(keyCode: 39, flags: .command))  // 序号段外的键
    }
}
