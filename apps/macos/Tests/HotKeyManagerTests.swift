import XCTest
import Carbon.HIToolbox
@testable import DeepDive

/// 全局热键 spec 解析、录制与共享键码表的一致性（R-002）。parse 与
/// hotkeySpec 共用 HotKeyManager.ansiKeys（真实 Carbon kVK_ANSI_* 键码，
/// 字母/数字并非连续序号）：录出的 spec 命名真实物理键，parse 必须注册回
/// 同一键。
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

    func testParseUsesRealCarbonKeycodes() {
        // Carbon 字母/数字键码不连续，钉住几个易错点（曾按序号映射错键）
        XCTAssertEqual(HotKeyManager.parse("option+o")?.keyCode, UInt32(kVK_ANSI_O)) // 0x1F，序号法会得 14
        XCTAssertEqual(HotKeyManager.parse("option+r")?.keyCode, UInt32(kVK_ANSI_R))
        XCTAssertEqual(HotKeyManager.parse("option+2")?.keyCode, UInt32(kVK_ANSI_2)) // 0x13，序号法会得 30
        XCTAssertEqual(HotKeyManager.parse("option+0")?.keyCode, UInt32(kVK_ANSI_0))
    }

    func testRecorderRoundTripPreservesKeyCode() {
        // 遍历整张表：录制 spec → 必须回到同一 keyCode，且字符串命名该键
        for (name, code) in HotKeyManager.ansiKeys {
            guard let spec = HotkeyRecorderWindow.hotkeySpec(keyCode: UInt16(code), flags: .option) else {
                return XCTFail("no spec for \(name)")
            }
            XCTAssertEqual(spec, "option+\(name)")
            XCTAssertEqual(HotKeyManager.parse(spec)?.keyCode, code, "spec \"\(spec)\" must re-register keyCode \(code)")
        }
    }

    func testRecorderRequiresModifier() {
        XCTAssertNil(HotkeyRecorderWindow.hotkeySpec(keyCode: UInt16(kVK_Space), flags: []))
        XCTAssertNil(HotkeyRecorderWindow.hotkeySpec(keyCode: 39, flags: .command))  // 表外键（' 键）
    }
}
