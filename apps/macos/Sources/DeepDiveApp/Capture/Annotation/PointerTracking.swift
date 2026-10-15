import AppKit

/// 一块"指针进出"跟踪区的统一做法（悬停注释要的那个信号）。
///
/// 两条口径：
/// ① **`.activeAlways`**：截图/标注工具条住在非激活面板（`CaptureOverlayPanel`）里，
///    不给这一项，悬停要等窗口成为 key 才来——那时人已经点下去了。
/// ② `.inVisibleRect`：矩形跟着自己的 frame 走，移动/重排后不必手工重算，只需在
///    `updateTrackingAreas()` 里重装一次。
///
/// 为什么做成对象而不是让视图自己实现 `mouseEntered`/`mouseExited`：这两条消息的收件人是
/// 跟踪区的 owner，交给这个小对象就不必给每个控件再写两遍转发。
/// **`AnnotationToolbarButton` 自带一份等价实现**（它的 hover 洗色与"选择工具条逐帧读指针"
/// 两条路共用 `isHovered`），别去合并那一份。
final class PointerTracking: NSObject {
  /// `true` 指针进来、`false` 出去。
  private let handler: (Bool) -> Void
  private weak var view: NSView?
  private var area: NSTrackingArea?

  init(view: NSView, handler: @escaping (Bool) -> Void) {
    self.view = view
    self.handler = handler
    super.init()
  }

  /// 重装跟踪区：初始与每次 `updateTrackingAreas()` 都调它（幂等）。
  func refresh() {
    guard let view else { return }
    if let area { view.removeTrackingArea(area) }
    let area = NSTrackingArea(
      rect: .zero, options: [.mouseEnteredAndExited, .activeAlways, .inVisibleRect], owner: self)
    view.addTrackingArea(area)
    self.area = area
  }

  @objc func mouseEntered(with event: NSEvent) { handler(true) }
  @objc func mouseExited(with event: NSEvent) { handler(false) }
}
