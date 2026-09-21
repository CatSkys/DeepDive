import XCTest
@testable import DeepDive

/// 识别语言的钉子。这一条出过真实事故：默认构造 `SFSpeechRecognizer()` 取
/// `Locale.current`，而 macOS 上那是"用户偏好 ∩ App 自身本地化"——本 app 未声明任何
/// 本地化（开发语言 en），于是中文系统下也一直识别成英文。
final class DictationControllerTests: XCTestCase {
    /// 实测的识别器支持集（这台机器 `supportedLocales()` 的 zh 三族 + 几个常见语言）。
    /// 用固定集合而不是现取，测试才是确定的。
    private let supported = ["de-DE", "en-GB", "en-US", "ja-JP", "zh-CN", "zh-HK", "zh-TW"]

    private func resolve(_ preferred: [String]) -> String? {
        DictationController.resolveLocale(preferred: preferred, supported: supported)?.identifier
    }

    /// 事故本身：中文偏好必须落到中文，**不能**是英文。
    func testSimplifiedChinesePreferenceDoesNotFallBackToEnglish() {
        XCTAssertEqual(resolve(["zh-Hans-CN"]), "zh-CN")
        XCTAssertNotEqual(resolve(["zh-Hans-CN"]), "en-US", "这正是用户报的『一直是英文』")
    }

    /// 偏好是脚本形式、识别器支持的是区域形式——朴素前缀匹配在这里必然失败。
    func testScriptFormMatchesRegionForm() {
        XCTAssertEqual(resolve(["zh-Hant-TW"]), "zh-TW")
        XCTAssertEqual(resolve(["zh-Hant-HK"]), "zh-HK")
    }

    func testExactAndOtherLanguagesPassThrough() {
        XCTAssertEqual(resolve(["en-US"]), "en-US")
        XCTAssertEqual(resolve(["en-GB"]), "en-GB")
        XCTAssertEqual(resolve(["ja-JP"]), "ja-JP")
        XCTAssertEqual(resolve(["de-DE"]), "de-DE")
    }

    /// 偏好列表按序取第一个能对上的：中文在前就选中文，而不是"随便挑一个支持的语言"。
    func testFirstMatchingPreferenceWins() {
        XCTAssertEqual(resolve(["zh-Hans-CN", "en-US"]), "zh-CN")
        XCTAssertEqual(resolve(["en-US", "zh-Hans-CN"]), "en-US")
    }

    /// 语言完全不受支持时也只回**支持集里的**标识——绝不把识别器认不出的标识递出去。
    func testUnsupportedLanguageStillYieldsASupportedIdentifier() {
        let resolved = resolve(["xx-YY"])
        XCTAssertNotNil(resolved)
        XCTAssertTrue(supported.contains(resolved!), "回给识别器的必须是它自己的支持集成员")
    }

    /// 支持集为空（理论上不会）时 Foundation 回的是 **bundle 的开发语言**（我们是 `en`），
    /// **不是** nil——这是 `Bundle.preferredLocalizations` 的既定行为，写下来免得下一个
    /// 人以为这里会拿到 nil。真走到这一步，`SFSpeechRecognizer(locale:)` 会因标识不在
    /// 支持集里返回 nil，由调用方走"找不到可用的识别语言"。
    func testEmptySupportedSetFallsBackToTheDevelopmentLanguage() {
        XCTAssertEqual(DictationController.resolveLocale(preferred: ["zh-Hans-CN"], supported: [])?.identifier, "en")
    }
}
