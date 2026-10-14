import XCTest
@testable import DeepDive

/// 截图聊天输入条的中线（2026-10-14 用户报"这个按钮怎么不居中"）：输入框那格**画出来的文字**
/// 与发送钮要落在胶囊的同一中线上。两处 AppKit 的坑都由这一条钉住——
/// ① 单行 `NSTextField` 把文字画在**框的顶上**（所以量 cell 的 `drawingRect`，不是量 frame）；
/// ② 栈里没有刚性高度时胶囊会塌到文字那点高（所以输入框外面套了一格同按钮高的容器）。
final class AnnotationChatBarTests: XCTestCase {
    /// 子树里第一个该类型的视图：不给生产代码开测试用的口子，量的是真做出来的那几块。
    private func first<T: NSView>(_ type: T.Type, in view: NSView) -> T? {
        if let hit = view as? T { return hit }
        for subview in view.subviews {
            if let hit = first(type, in: subview) { return hit }
        }
        return nil
    }

    func testDrawnTextAndSendButtonShareTheCapsuleCentreline() throws {
        let bar = AnnotationChatBar()
        let size = bar.fittingSize
        XCTAssertGreaterThan(size.height, 0)
        bar.frame = CGRect(origin: .zero, size: size)
        bar.layoutSubtreeIfNeeded()

        let field = try XCTUnwrap(first(NSTextField.self, in: bar))
        let button = try XCTUnwrap(first(AnnotationToolbarButton.self, in: bar))
        let capsule = try XCTUnwrap(first(AnnotationGlassBar.self, in: bar))

        // 胶囊与工具条一样高（按钮那一档 + 内边距），两条并排才嵌得齐。
        XCTAssertEqual(size.height, AnnotationToolbarButton.side + AnnotationGlassBar.padding * 2)
        XCTAssertEqual(capsule.frame.height, size.height, accuracy: 0.5)

        // 中线都在胶囊的坐标系里量：输入框在容器里、容器在栈里、栈在玻璃里，原点各不相同。
        let centre = capsule.bounds.midY
        let drawing = try XCTUnwrap(field.cell).drawingRect(forBounds: field.bounds)
        XCTAssertEqual(
            field.convert(drawing, to: capsule).midY, centre, accuracy: 0.5,
            "输入框画出来的文字偏出了胶囊中线")
        XCTAssertEqual(
            button.convert(button.bounds, to: capsule).midY, centre, accuracy: 0.5,
            "发送钮偏出了胶囊中线")
    }
}
