import CoreGraphics

/// The hover label's way in and out (hover-label-v2): it grows out of, and draws back into, the
/// hovered control's middle, which lies inside the capsule (or the commands card for a row's
/// label), so it never pokes past the capsule's rounded ends as a stub.
///
/// At `progress` 1 the label rests beside the capsule; at 0 it has shrunk to nothing at the
/// control's middle. Its width and height shrink in step, so it stays a capsule all the way. Its
/// side nearest the capsule holds its place while the rest draws in, and moves in only in the
/// last part of the way (`1 − (1 − p)⁴` of its way out, so at half the way it has moved
/// in only 1/16), so the label shrinks as one shape first and reaches the capsule glass, and
/// merges with it, only as it is nearly gone. Values past 1 (an elastic entrance) grow it a
/// little past its rest.
public enum MiniPanelLabelPath {
  /// The label at `progress`, resting at `rest`, converging into `point`, beside a shape on
  /// `edge` of the work area (the label is on the shape's interior side). Works in any
  /// coordinates whose x grows toward the right.
  public static func rect(
    progress p: Double, rest: CGRect, point: CGPoint, edge: MiniPanelEdge
  ) -> CGRect {
    let width = rest.width * max(p, 0)
    let height = rest.height * max(p, 0)
    let left = max(1 - p, 0)
    let near = 1 - left * left * left * left
    // The side facing the capsule: the right side of a label beside a right-edge capsule.
    let restNear = edge == .right ? rest.maxX : rest.minX
    let nearX = point.x + (restNear - point.x) * near
    let midY = point.y + (rest.midY - point.y) * p
    let minX = edge == .right ? nearX - width : nearX
    return CGRect(x: minX, y: midY - height / 2, width: width, height: height)
  }
}
