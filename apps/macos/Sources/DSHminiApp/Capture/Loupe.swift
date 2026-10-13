import AppKit

/// The magnifier beside the pointer: a nearest-neighbour grid of the frozen pixels around it,
/// the pixel under it framed, and below that the pointer's Quartz point and that pixel's sRGB
/// hex colour. Each update renders only the small pixel window, so following the pointer stays
/// cheap on a large display.
final class LoupeView: NSView {
  /// Pixels across the grid; odd, so one pixel is the center.
  private static let span = 15
  private static let zoom: CGFloat = 8
  private static let gap: CGFloat = 20
  private static let infoFont = NSFont.monospacedDigitSystemFont(ofSize: 11, weight: .regular)
  private static var gridSide: CGFloat { CGFloat(span) * zoom }

  private let image: CGImage
  private let scale: CGFloat
  private var magnified: CGImage?
  private var info = ""
  private let colorSpace = CGColorSpace(name: CGColorSpace.sRGB) ?? CGColorSpaceCreateDeviceRGB()

  init(image: CGImage, scale: CGFloat) {
    self.image = image
    self.scale = scale
    let infoHeight = CaptureBadge.size(of: "0", font: Self.infoFont).height
    super.init(
      frame: CGRect(x: 0, y: 0, width: Self.gridSide, height: Self.gridSide + infoHeight + 4))
  }

  @available(*, unavailable)
  required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }

  override var isFlipped: Bool { true }
  override func hitTest(_ point: NSPoint) -> NSView? { nil }

  /// Shows the pixels around `point` (view space) and the readout for `quartz`.
  func update(at point: CGPoint, quartz: CGPoint) {
    let pixel = CaptureCoordinates.pixel(
      at: point, scale: scale, width: image.width, height: image.height)
    let rendered = render(around: pixel)
    magnified = rendered.image
    info = "\(Int(quartz.x.rounded(.down))), \(Int(quartz.y.rounded(.down)))  \(rendered.hex)"
    needsDisplay = true
  }

  /// Down and to the right of the pointer, flipped to the other side near a display edge.
  func place(near point: CGPoint, in bounds: CGRect) {
    var origin = CGPoint(x: point.x + Self.gap, y: point.y + Self.gap)
    if origin.x + frame.width > bounds.maxX { origin.x = point.x - Self.gap - frame.width }
    if origin.y + frame.height > bounds.maxY { origin.y = point.y - Self.gap - frame.height }
    setFrameOrigin(origin)
  }

  override func draw(_ dirtyRect: NSRect) {
    let grid = CGRect(x: 0, y: 0, width: Self.gridSide, height: Self.gridSide)
    NSColor.black.setFill()
    grid.fill()
    if let magnified {
      NSGraphicsContext.current?.imageInterpolation = .none
      NSImage(cgImage: magnified, size: grid.size).draw(
        in: grid, from: .zero, operation: .copy, fraction: 1, respectFlipped: true, hints: nil)
    }
    let lines = NSBezierPath()
    for index in 1..<Self.span {
      let offset = CGFloat(index) * Self.zoom
      lines.move(to: CGPoint(x: offset, y: 0))
      lines.line(to: CGPoint(x: offset, y: grid.maxY))
      lines.move(to: CGPoint(x: 0, y: offset))
      lines.line(to: CGPoint(x: grid.maxX, y: offset))
    }
    lines.lineWidth = 0.5
    NSColor(white: 1, alpha: 0.12).setStroke()
    lines.stroke()
    let center = CGFloat(Self.span / 2) * Self.zoom
    let reticle = NSBezierPath(
      rect: CGRect(x: center, y: center, width: Self.zoom, height: Self.zoom))
    reticle.lineWidth = 1.5
    NSColor.controlAccentColor.setStroke()
    reticle.stroke()
    let border = NSBezierPath(rect: grid.insetBy(dx: 0.5, dy: 0.5))
    NSColor(white: 1, alpha: 0.8).setStroke()
    border.lineWidth = 1
    border.stroke()
    let infoSize = CaptureBadge.size(of: info, font: Self.infoFont)
    CaptureBadge.draw(
      info, font: Self.infoFont,
      in: CGRect(
        x: 0, y: grid.maxY + 4, width: max(infoSize.width, grid.width), height: infoSize.height))
  }

  /// The `span` × `span` pixels around `pixel` in sRGB (black past the image's edges) and the
  /// center pixel's hex colour.
  private func render(around pixel: CapturePixel) -> (image: CGImage?, hex: String) {
    let span = Self.span
    let half = span / 2
    guard
      let context = CGContext(
        data: nil, width: span, height: span, bitsPerComponent: 8, bytesPerRow: span * 4,
        space: colorSpace,
        bitmapInfo: CGImageAlphaInfo.premultipliedFirst.rawValue
          | CGBitmapInfo.byteOrder32Little.rawValue)
    else { return (nil, "") }
    context.interpolationQuality = .none
    let area = CGRect(x: pixel.x - half, y: pixel.y - half, width: span, height: span)
    let visible = area.intersection(CGRect(x: 0, y: 0, width: image.width, height: image.height))
    if !visible.isNull, let crop = image.cropping(to: visible) {
      // Bitmap contexts are y-up; the crop's top row lands `visible.minY - area.minY` rows
      // below the area's top.
      let top = visible.minY - area.minY
      context.draw(
        crop,
        in: CGRect(
          x: visible.minX - area.minX, y: CGFloat(span) - top - visible.height,
          width: visible.width, height: visible.height))
    }
    var hex = ""
    if let data = context.data?.assumingMemoryBound(to: UInt8.self) {
      // Rows are stored top first; BGRA in memory for 32-bit little-endian ARGB.
      let offset = half * span * 4 + half * 4
      hex = String(format: "#%02X%02X%02X", data[offset + 2], data[offset + 1], data[offset])
    }
    return (context.makeImage(), hex)
  }
}
