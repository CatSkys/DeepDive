import XCTest
@testable import DeepDive

/// 历史与书签的钉子：去重与顺序、上限、清空、载荷形状。
/// 两份存储读的都是 `.standard` 里固定的键——测试前后要把真机上的那份挪开/放回。
final class BrowserLibraryTests: XCTestCase {
    private let historyKey = "deepdive.browser.history"
    private let bookmarksKey = "deepdive.browser.bookmarks"
    private var savedHistory: String?
    private var savedBookmarks: String?

    override func setUp() {
        super.setUp()
        savedHistory = UserDefaults.standard.string(forKey: historyKey)
        savedBookmarks = UserDefaults.standard.string(forKey: bookmarksKey)
        BrowserHistory.shared.clear()
        BrowserBookmarks.shared.clear()
    }

    override func tearDown() {
        BrowserHistory.shared.clear()
        BrowserBookmarks.shared.clear()
        if let value = savedHistory { UserDefaults.standard.set(value, forKey: historyKey) }
        if let value = savedBookmarks { UserDefaults.standard.set(value, forKey: bookmarksKey) }
        super.tearDown()
    }

    // MARK: - 历史

    func testRecordKeepsNewestFirstAndCountsRepeats() {
        let history = BrowserHistory.shared
        XCTAssertTrue(history.record(url: "https://a.test/1", title: "One"))
        XCTAssertTrue(history.record(url: "https://b.test/2", title: "Two"))
        XCTAssertEqual(history.entries().map(\.url), ["https://b.test/2", "https://a.test/1"])
        // 再访一次：提到最前 + 计数（不新增一条）
        XCTAssertTrue(history.record(url: "https://a.test/1", title: "One again"))
        XCTAssertEqual(history.entries().map(\.url), ["https://a.test/1", "https://b.test/2"])
        XCTAssertEqual(history.total(), 2)
        XCTAssertEqual(history.entries().first?.count, 2)
        XCTAssertEqual(history.entries().first?.title, "One again")
        XCTAssertEqual(history.entries().first?.host, "a.test")
    }

    func testTitleSettlesLater() {
        // didFinish 那一刻标题常常还是空的（记成地址）；真标题到了要补上，且只补那一次
        let history = BrowserHistory.shared
        history.record(url: "https://a.test/1", title: "")
        XCTAssertEqual(history.entries().first?.title, "https://a.test/1", "没标题先用地址顶上")
        XCTAssertTrue(history.updateTitle(url: "https://a.test/1", title: "真标题"))
        XCTAssertEqual(history.entries().first?.title, "真标题")
        XCTAssertFalse(history.updateTitle(url: "https://a.test/1", title: "真标题"), "同一个标题不必再写一次")
        XCTAssertFalse(history.updateTitle(url: "https://nope.test/", title: "x"), "没记过的地址不动")
        XCTAssertFalse(history.updateTitle(url: "https://a.test/1", title: ""), "空标题不写")
    }

    func testRecordRefusesNonWebURLs() {
        let history = BrowserHistory.shared
        XCTAssertFalse(history.record(url: "about:blank", title: "blank"))
        XCTAssertFalse(history.record(url: "file:///etc/passwd", title: "file"))
        XCTAssertFalse(history.record(url: "not a url", title: ""))
        XCTAssertEqual(history.total(), 0)
    }

    func testHistoryIsCappedAndNewestSurvives() {
        let history = BrowserHistory.shared
        for index in 0..<(BrowserHistory.limit + 5) {
            history.record(url: "https://a.test/\(index)", title: "T\(index)")
        }
        XCTAssertEqual(history.total(), BrowserHistory.limit)
        XCTAssertEqual(history.entries().first?.url, "https://a.test/\(BrowserHistory.limit + 4)", "最新的一条必须在")
        XCTAssertEqual(history.entries(limit: 3).count, 3)
    }

    func testRemoveAndClearAndPayloadShape() throws {
        let history = BrowserHistory.shared
        history.record(url: "https://a.test/1", title: "One")
        history.record(url: "https://b.test/2", title: "Two")
        history.remove(url: "https://b.test/2")
        XCTAssertEqual(history.total(), 1)

        let payload = try XCTUnwrap(history.entries().first?.payload)
        XCTAssertTrue(JSONSerialization.isValidJSONObject(payload))
        XCTAssertEqual(payload["url"] as? String, "https://a.test/1")
        XCTAssertEqual(payload["host"] as? String, "a.test")
        XCTAssertNotNil(payload["at"] as? Double)
        XCTAssertEqual(payload["count"] as? Int, 1)

        history.clear()
        XCTAssertEqual(history.total(), 0)
        XCTAssertEqual(history.entries().count, 0)
    }

    // MARK: - 书签

    func testBookmarksAddRemoveAndDeduplicate() {
        let marks = BrowserBookmarks.shared
        marks.add(url: "https://a.test/1", title: "One")
        marks.add(url: "https://a.test/1", title: "One again")   // 重复收藏 = 无操作
        marks.add(url: "https://b.test/2", title: "Two")
        XCTAssertEqual(marks.list().map(\.url), ["https://b.test/2", "https://a.test/1"], "新在前")
        XCTAssertTrue(marks.contains(url: "https://a.test/1"))
        marks.remove(url: "https://a.test/1")
        XCTAssertFalse(marks.contains(url: "https://a.test/1"))
        XCTAssertEqual(marks.list().count, 1)
        marks.clear()
        XCTAssertEqual(marks.list().count, 0)
    }

    func testBookmarkRefusesEmptyURLAndCarriesJSONPayload() throws {
        let marks = BrowserBookmarks.shared
        marks.add(url: "", title: "nothing")
        XCTAssertEqual(marks.list().count, 0)
        marks.add(url: "https://a.test/x", title: "")
        let payload = try XCTUnwrap(marks.list().first?.payload)
        XCTAssertTrue(JSONSerialization.isValidJSONObject(payload))
        XCTAssertEqual(payload["title"] as? String, "https://a.test/x", "没标题就用地址顶上，别给空串")
    }
}
