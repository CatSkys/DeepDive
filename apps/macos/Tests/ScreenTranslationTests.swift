import XCTest
@testable import DeepDive

/// 提取文字那条「翻译」的目标语言（`ScreenTranslation.target`）：翻进应用自己那门语言，
/// 除非原文已经是那门——那就翻到另一门。中文按**字形**比：繁体不是简体，所以简体界面会把
/// 繁体文字翻成简体（那是用得着的方向），而不是翻去英文。
final class ScreenTranslationTests: XCTestCase {
    func testTranslatesIntoTheAppsOwnLanguage() {
        XCTAssertEqual(target("en-US", app: "zh"), ScreenTranslation.chinese)
        XCTAssertEqual(target("ja", app: "en"), ScreenTranslation.english)
        XCTAssertEqual(target("ko", app: "zh"), ScreenTranslation.chinese)
    }

    func testFlipsToTheOtherLanguageWhenTheTextIsAlreadyTheApps() {
        XCTAssertEqual(target("en-US", app: "en"), ScreenTranslation.chinese)
        XCTAssertEqual(target("en", app: "en"), ScreenTranslation.chinese)
        XCTAssertEqual(target("zh-Hans", app: "zh"), ScreenTranslation.english)
    }

    func testTraditionalTextIsNotSimplified() {
        XCTAssertEqual(target("zh-Hant", app: "zh"), ScreenTranslation.chinese)
    }

    func testAnUnknownAppLanguageIsChinese() {
        XCTAssertEqual(target("en-US", app: ""), ScreenTranslation.chinese)
    }

    private func target(_ detected: String, app appLanguage: String) -> Locale.Language {
        ScreenTranslation.target(
            detected: Locale.Language(identifier: detected), appLanguage: appLanguage)
    }
}
