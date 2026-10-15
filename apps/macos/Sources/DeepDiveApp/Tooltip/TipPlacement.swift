import AppKit

/// 悬浮注释该摆在哪：纯几何，不碰任何视图——`TooltipController` 把锚点（屏幕坐标，y 向上）、
/// 注释实测尺寸、偏好边与间距交进来，这里定案。
///
/// 语义与页内那份（`Tooltip.tsx` 的落位）同一套：按偏好边对齐（上/下居中，左/右垂直居中），
/// 放不下就翻到对侧，最后夹进屏幕可视区。两处各留一份是因为页内那份拿不到屏幕坐标、
/// 壳这份拿不到元素在文档里的位置——边界清楚，谁也不越界。
enum TipPlacement {
  /// 注释默认浮在锚点**上方**；`side` 只认四个方向，其余一律当上方。
  static func normalize(_ side: String) -> String {
    switch side {
    case "bottom", "left", "right": side
    default: "top"
    }
  }

  static func opposite(_ side: String) -> String {
    switch normalize(side) {
    case "bottom": "top"
    case "left": "right"
    case "right": "left"
    default: "bottom"
    }
  }

  /// 注释**内容**该占的屏幕矩形（y 向上）。`limits` 是它可以待的范围（触发窗口所在屏的
  /// 可视区）。
  static func frame(anchor: NSRect, size: NSSize, side: String, gap: CGFloat, limits: NSRect) -> NSRect {
    var side = normalize(side)
    if !fits(anchor: anchor, size: size, side: side, gap: gap, limits: limits) {
      side = opposite(side)
    }
    let origin: NSPoint
    switch side {
    case "bottom":
      origin = NSPoint(x: anchor.midX - size.width / 2, y: anchor.minY - gap - size.height)
    case "left":
      origin = NSPoint(x: anchor.minX - gap - size.width, y: anchor.midY - size.height / 2)
    case "right":
      origin = NSPoint(x: anchor.maxX + gap, y: anchor.midY - size.height / 2)
    default:
      origin = NSPoint(x: anchor.midX - size.width / 2, y: anchor.maxY + gap)
    }
    // 夹进可视区：注释比可视区还大时贴左边/下边（`max` 保证上界不反成负值）
    let clampedX = min(max(limits.minX, origin.x), max(limits.minX, limits.maxX - size.width))
    let clampedY = min(max(limits.minY, origin.y), max(limits.minY, limits.maxY - size.height))
    return NSRect(origin: NSPoint(x: clampedX, y: clampedY), size: size)
  }

  /// 这一侧放得下吗（放不下就翻面）。
  private static func fits(anchor: NSRect, size: NSSize, side: String, gap: CGFloat, limits: NSRect) -> Bool {
    switch normalize(side) {
    case "bottom": return anchor.minY - gap - size.height >= limits.minY
    case "left": return anchor.minX - gap - size.width >= limits.minX
    case "right": return anchor.maxX + gap + size.width <= limits.maxX
    default: return anchor.maxY + gap + size.height <= limits.maxY
    }
  }
}
