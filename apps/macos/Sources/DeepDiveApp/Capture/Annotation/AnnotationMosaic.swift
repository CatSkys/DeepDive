import CoreImage
import CoreImage.CIFilterBuiltins

/// Mosaic regions over the screenshot's own pixels (never over other annotations), so the
/// exported image holds only the blocks or the blur. Both are fixed to the frozen display rather
/// than to the region: a region being drawn, resized or moved keeps every block or blurred pixel
/// where it overlaps its old place, and only uncovers or covers others.
///
/// - Pixelate: the display is cut into blocks from its top-left pixel, and each block is the
///   average of all its pixels (``BlockGrid``), as PixPin does. Core Image's `CIPixellate` samples
///   a single pixel per block, so its blocks flip between text and background whenever the grid
///   shifts.
/// - Blur: a Gaussian blur of the whole display, rendered only where the region is, so its edges
///   blur into the real neighbours instead of a clamped copy of the region.
final class AnnotationMosaic {
  private struct BlurKey: Hashable {
    let x: Int, y: Int, width: Int, height: Int, radius: Int
  }

  private let context = CIContext(options: [.cacheIntermediates: false])
  private var backdrop: ObjectIdentifier?
  /// By block edge in pixels.
  private var grids: [Int: BlockGrid] = [:]
  /// The display blurred, by radius in pixels; Core Image renders only the parts asked for.
  private var blurs: [Int: CIImage] = [:]
  private var blurCache: [BlurKey: CGImage] = [:]

  /// The image to draw for a mosaic over `rect` (view points) in `style`, and the point rect it
  /// covers: `rect` grown to whole blocks or pixels and clipped to the display, so the caller
  /// clips the drawing to `rect`. `backdrop` is the frozen display's image with `scale` pixels
  /// per point; nil when the region is off the image, and for a solid mosaic, which the
  /// renderer fills without reading the screenshot.
  func render(_ rect: CGRect, style: AnnotationStyle, backdrop image: CGImage, scale: CGFloat)
    -> (CGImage, CGRect)?
  {
    reset(for: image)
    let bounds = CGRect(x: 0, y: 0, width: image.width, height: image.height)
    let pixels = CGRect(
      x: rect.minX * scale, y: rect.minY * scale, width: rect.width * scale,
      height: rect.height * scale)
    let space = Self.colorSpace(of: image)
    switch style.redaction {
    case .pixelate:
      let block = max(1, Int((style.stroke.mosaicBlock * scale).rounded()))
      let grid = grids[block] ?? BlockGrid(block: block, width: image.width, height: image.height)
      // The slider passes through many sizes; only the ones in use are worth keeping.
      if grids[block] == nil, grids.count >= 8 { grids.removeAll() }
      grids[block] = grid
      let first = (
        column: max(0, Int(floor(pixels.minX / CGFloat(block)))),
        row: max(0, Int(floor(pixels.minY / CGFloat(block))))
      )
      let end = (
        column: min(grid.columns, Int(ceil(pixels.maxX / CGFloat(block)))),
        row: min(grid.rows, Int(ceil(pixels.maxY / CGFloat(block))))
      )
      guard first.column < end.column, first.row < end.row,
        let blocks = grid.image(
          columns: first.column..<end.column, rows: first.row..<end.row, of: image, in: space)
      else { return nil }
      let covered = CGRect(
        x: first.column * block, y: first.row * block, width: (end.column - first.column) * block,
        height: (end.row - first.row) * block)
      return (blocks, Self.points(covered, scale: scale))
    case .solid:
      return nil
    case .blur:
      let area = pixels.integral.intersection(bounds)
      guard !area.isNull, area.width >= 1, area.height >= 1 else { return nil }
      let radius = max(1, Int((style.stroke.blurRadius * scale).rounded()))
      let key = BlurKey(
        x: Int(area.minX), y: Int(area.minY), width: Int(area.width), height: Int(area.height),
        radius: radius)
      if let cached = blurCache[key] { return (cached, Self.points(area, scale: scale)) }
      guard let blurred = blur(area, radius: radius, of: image, in: space) else { return nil }
      if blurCache.count > 64 { blurCache.removeAll() }
      blurCache[key] = blurred
      return (blurred, Self.points(area, scale: scale))
    }
  }

  /// Drops everything kept for an earlier backdrop.
  private func reset(for image: CGImage) {
    let identity = ObjectIdentifier(image)
    guard backdrop != identity else { return }
    backdrop = identity
    grids.removeAll()
    blurs.removeAll()
    blurCache.removeAll()
  }

  /// Core Image's origin is bottom-left, so the top-left pixel rect is flipped first. The blur
  /// reads the whole display, clamped at its edges so they do not fade to transparent.
  private func blur(_ area: CGRect, radius: Int, of image: CGImage, in space: CGColorSpace)
    -> CGImage?
  {
    let blurred: CIImage
    if let cached = blurs[radius] {
      blurred = cached
    } else {
      let filter = CIFilter.gaussianBlur()
      filter.inputImage = CIImage(cgImage: image).clampedToExtent()
      filter.radius = Float(radius)
      guard let output = filter.outputImage else { return nil }
      blurred = output
      if blurs.count >= 8 { blurs.removeAll() }
      blurs[radius] = output
    }
    let flipped = CGRect(
      x: area.minX, y: CGFloat(image.height) - area.maxY, width: area.width, height: area.height)
    return context.createCGImage(blurred, from: flipped, format: .RGBA8, colorSpace: space)
  }

  private static func points(_ pixels: CGRect, scale: CGFloat) -> CGRect {
    CGRect(
      x: pixels.minX / scale, y: pixels.minY / scale, width: pixels.width / scale,
      height: pixels.height / scale)
  }

  /// The backdrop's own RGB space, so averages and blur keep its colours.
  private static func colorSpace(of image: CGImage) -> CGColorSpace {
    if let space = image.colorSpace, space.model == .rgb { return space }
    return CGColorSpace(name: CGColorSpace.sRGB)!
  }
}

/// The average colour of every `block` × `block` square of one backdrop, on a grid from its
/// top-left pixel, worked out the first time a region needs it and then kept. The last column and
/// row may be cut short by the display's edge; they average the pixels they have.
///
/// No noise is added: per-block noise (CleanShot X's randomization) makes flat areas read as a
/// speckled checkerboard. Averages can still be matched against rendered text (Depix), so the
/// Cover form is what hides text for certain.
private final class BlockGrid {
  let block: Int
  let columns: Int
  let rows: Int
  private let width: Int
  private let height: Int
  /// Premultiplied RGBA, row by row.
  private var colors: [UInt8]
  private var known: [Bool]

  init(block: Int, width: Int, height: Int) {
    self.block = block
    self.width = width
    self.height = height
    columns = (width + block - 1) / block
    rows = (height + block - 1) / block
    colors = Array(repeating: 0, count: columns * rows * 4)
    known = Array(repeating: false, count: columns * rows)
  }

  /// The blocks in `columns` × `rows`, one pixel each.
  func image(
    columns: Range<Int>, rows: Range<Int>, of backdrop: CGImage, in space: CGColorSpace
  ) -> CGImage? {
    fill(columns: columns, rows: rows, of: backdrop, in: space)
    var bytes = [UInt8]()
    bytes.reserveCapacity(columns.count * rows.count * 4)
    for row in rows {
      let start = (row * self.columns + columns.lowerBound) * 4
      bytes.append(contentsOf: colors[start..<start + columns.count * 4])
    }
    guard let provider = CGDataProvider(data: Data(bytes) as CFData) else { return nil }
    return CGImage(
      width: columns.count, height: rows.count, bitsPerComponent: 8, bitsPerPixel: 32,
      bytesPerRow: columns.count * 4, space: space,
      bitmapInfo: CGBitmapInfo(rawValue: CGImageAlphaInfo.premultipliedLast.rawValue),
      provider: provider, decode: nil, shouldInterpolate: false, intent: .defaultIntent)
  }

  /// Averages the blocks in range not yet known, reading the backdrop only where they are.
  private func fill(
    columns: Range<Int>, rows: Range<Int>, of backdrop: CGImage, in space: CGColorSpace
  ) {
    var missing: (columns: ClosedRange<Int>, rows: ClosedRange<Int>)?
    for row in rows {
      for column in columns where !known[row * self.columns + column] {
        let old = missing ?? (column...column, row...row)
        missing = (
          min(old.columns.lowerBound, column)...max(old.columns.upperBound, column),
          min(old.rows.lowerBound, row)...max(old.rows.upperBound, row)
        )
      }
    }
    guard let missing else { return }
    let origin = (x: missing.columns.lowerBound * block, y: missing.rows.lowerBound * block)
    let crop = CGRect(
      x: origin.x, y: origin.y,
      width: min(width, (missing.columns.upperBound + 1) * block) - origin.x,
      height: min(height, (missing.rows.upperBound + 1) * block) - origin.y)
    guard let part = backdrop.cropping(to: crop),
      let bitmap = CGContext(
        data: nil, width: part.width, height: part.height, bitsPerComponent: 8, bytesPerRow: 0,
        space: space, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)
    else { return }
    bitmap.draw(part, in: CGRect(x: 0, y: 0, width: part.width, height: part.height))
    guard let data = bitmap.data?.assumingMemoryBound(to: UInt8.self) else { return }
    let rowBytes = bitmap.bytesPerRow
    for row in missing.rows {
      let top = row * block - origin.y
      let bottom = min(top + block, part.height)
      for column in missing.columns where !known[row * self.columns + column] {
        let left = column * block - origin.x
        let right = min(left + block, part.width)
        var sums = (0, 0, 0, 0)
        for y in top..<bottom {
          var pixel = data + y * rowBytes + left * 4
          for _ in left..<right {
            sums.0 += Int(pixel[0])
            sums.1 += Int(pixel[1])
            sums.2 += Int(pixel[2])
            sums.3 += Int(pixel[3])
            pixel += 4
          }
        }
        let count = max(1, (bottom - top) * (right - left))
        let index = row * self.columns + column
        for (channel, sum) in [sums.0, sums.1, sums.2, sums.3].enumerated() {
          colors[index * 4 + channel] = UInt8((sum + count / 2) / count)
        }
        known[index] = true
      }
    }
  }
}
