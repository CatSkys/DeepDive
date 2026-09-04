import XCTest
@testable import DeepDive

/// 引擎 stdout 的字节级行切分（AUD-018 修复钉）：完整行逐条出、撕裂的多字节
/// 序列留在缓冲等下一片——整段缓冲解码失败丢全部行的旧病不再复发。
final class EngineSupervisorTests: XCTestCase {
    func testDrainsCompleteLinesAndKeepsTornTail() {
        var buf = Data("dsh web: http://127.0.0.1:5173\n第一行".utf8)
        XCTAssertEqual(EngineSupervisor.drainLines(&buf), ["dsh web: http://127.0.0.1:5173"])
        XCTAssertEqual(buf, Data("第一行".utf8)) // 无换行的尾巴整段保留

        // 撕裂的多字节序列（🎯 4 字节只到前 2 字节）：只保尾部，不丢已完整行
        var torn = Data("就绪\n".utf8)
        let emoji = Data("🎯".utf8)
        torn.append(emoji.prefix(2))
        XCTAssertEqual(EngineSupervisor.drainLines(&torn), ["就绪"])
        XCTAssertEqual(torn, emoji.prefix(2))

        // 后半片到达后整行恢复
        torn.append(emoji.suffix(2))
        torn.append(Data("\n完成\n".utf8))
        XCTAssertEqual(EngineSupervisor.drainLines(&torn), ["🎯", "完成"])
        XCTAssertTrue(torn.isEmpty)
    }

    func testEmptyLinesPreservedAndCarriageReturnsKept() {
        var buf = Data("a\r\n\nb\n".utf8)
        XCTAssertEqual(EngineSupervisor.drainLines(&buf), ["a\r", "", "b"])
        XCTAssertTrue(buf.isEmpty)
    }
}
