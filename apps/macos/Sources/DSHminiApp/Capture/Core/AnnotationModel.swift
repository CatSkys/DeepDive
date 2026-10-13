import CoreGraphics
import Foundation

// The screenshot annotation model: plain values in the capture overlay's view points (origin at
// the display's top-left, y down), so the live canvas, hit-testing and export all read the same
// data. Annotations are anchored to the screen: the selection moves and resizes over them and
// only decides what is exported (decision D14). AICore stays free of AppKit; the shell turns
// colours and text into drawing objects.

/// The six swatches of the annotation toolbar. The raw values are what style memory stores
/// (``AnnotationStyleMemory``), so they must not change.
public enum AnnotationColor: String, CaseIterable, Sendable {
  case red, yellow, green, blue, black, white

  /// sRGB components in 0...1, matching the system accent palette.
  public var components: (red: Double, green: Double, blue: Double) {
    switch self {
    case .red: (1, 0.231, 0.188)
    case .yellow: (1, 0.8, 0)
    case .green: (0.204, 0.78, 0.349)
    case .blue: (0, 0.478, 1)
    case .black: (0, 0, 0)
    case .white: (1, 1, 1)
    }
  }

  /// Light swatches carry dark text on a step badge or a text plate, and a dark edge on the
  /// toolbar swatch.
  public var isLight: Bool {
    let rgb = components
    return 0.2126 * rgb.red + 0.7152 * rgb.green + 0.0722 * rgb.blue > 0.6
  }
}

/// How big an annotation is drawn, from 0 (smallest) to 1 (largest), as the style bar's size
/// slider (like PixPin's) and the scroll wheel set it; each tool reads the measure it draws with.
/// Every measure grows linearly and is rounded to a quarter point; each range is chosen so the
/// default 0.3 gives exactly the size the medium of the former three widths had. Always within
/// 0...1.
public struct AnnotationStroke: Equatable, Sendable {
  public let value: Double

  public init(_ value: Double) {
    self.value = value.isFinite ? min(max(value, 0), 1) : Self.default.value
  }

  public static let `default` = Self(0.3)

  /// Outline width of rectangles, ellipses, arrows, lines and the pen: 1 to 11 pt.
  public var lineWidth: CGFloat { measure(1, 11) }

  /// The highlighter is a broad translucent marker, several times the line width: 8 to 48 pt.
  public var highlighterWidth: CGFloat { measure(8, 48) }

  /// Point size of text annotations: 13 to 43 pt.
  public var fontSize: CGFloat { measure(13, 43) }

  /// Diameter of a step-number badge: 19 to 49 pt.
  public var stepDiameter: CGFloat { measure(19, 49) }

  /// Edge of a pixelating mosaic's blocks: 3 to 33 pt. It does not scale with the region, so a
  /// region being drawn, resized or moved keeps the same blocks.
  public var mosaicBlock: CGFloat { measure(3, 33) }

  /// Gaussian blur radius of a blurring mosaic: 1 to 31 pt.
  public var blurRadius: CGFloat { measure(1, 31) }

  /// Width of a step badge's tail, scaled with the badge.
  public var stepTailWidth: CGFloat { stepDiameter / 8 }

  /// Length of a step badge tail's arrowhead: small, so it does not outweigh the badge.
  public var stepTailHeadLength: CGFloat { stepDiameter * 0.4 }

  /// The size `steps` twentieths of the range larger (or smaller, when negative): one scroll-wheel
  /// notch or one press of `[` `]` `-` `=` moves it one step. Clamped at either end, so it never
  /// wraps.
  public func stepped(by steps: Double) -> Self { Self(value + steps / 20) }

  private func measure(_ smallest: CGFloat, _ largest: CGFloat) -> CGFloat {
    ((smallest + (largest - smallest) * value) * 4).rounded() / 4
  }
}

/// How a mosaic hides the screenshot under it. The raw values are what style memory stores, so
/// they must not change.
public enum AnnotationRedaction: String, CaseIterable, Sendable {
  /// Blocks of ``AnnotationStroke/mosaicBlock``, each the average colour of the pixels it covers,
  /// on a grid fixed to the display rather than to the region.
  case pixelate
  /// A Gaussian blur of ``AnnotationStroke/blurRadius`` over the whole display, seen through the
  /// region.
  case blur
  /// An opaque black box. Pixelation and blur keep some of what they hide (their averages can be
  /// matched against rendered text), so this is the one form that keeps none; it has no size.
  case solid
}

/// Colour, stroke, text background and redaction of one annotation; also the style bar's current
/// choice for new ones.
public struct AnnotationStyle: Equatable, Sendable {
  public var color: AnnotationColor
  public var stroke: AnnotationStroke
  /// Text only: the text sits on a rounded plate in ``color`` and its glyphs turn black or
  /// white for contrast (decision E9). Other shapes ignore it.
  public var textBackground: Bool
  /// Mosaic only; other shapes ignore it.
  public var redaction: AnnotationRedaction

  public init(
    color: AnnotationColor = .red, stroke: AnnotationStroke = .default,
    textBackground: Bool = false, redaction: AnnotationRedaction = .pixelate
  ) {
    self.color = color
    self.stroke = stroke
    self.textBackground = textBackground
    self.redaction = redaction
  }

  /// This style with only what the style bar changed replaced, so picking a colour keeps an
  /// annotation's stroke and the other way round.
  public func with(
    color: AnnotationColor? = nil, stroke: AnnotationStroke? = nil, textBackground: Bool? = nil,
    redaction: AnnotationRedaction? = nil
  ) -> Self {
    Self(
      color: color ?? self.color, stroke: stroke ?? self.stroke,
      textBackground: textBackground ?? self.textBackground,
      redaction: redaction ?? self.redaction)
  }
}

/// One change the style bar makes: only the parts it names.
public struct AnnotationStyleChange: Equatable, Sendable {
  public var color: AnnotationColor?
  public var stroke: AnnotationStroke?
  public var textBackground: Bool?
  public var redaction: AnnotationRedaction?

  public init(
    color: AnnotationColor? = nil, stroke: AnnotationStroke? = nil, textBackground: Bool? = nil,
    redaction: AnnotationRedaction? = nil
  ) {
    self.color = color
    self.stroke = stroke
    self.textBackground = textBackground
    self.redaction = redaction
  }

  public func applied(to style: AnnotationStyle) -> AnnotationStyle {
    style.with(
      color: color, stroke: stroke, textBackground: textBackground, redaction: redaction)
  }
}

/// What an annotation draws, with its geometry.
public enum AnnotationShape: Equatable, Sendable {
  case rectangle(CGRect)
  case ellipse(CGRect)
  case arrow(from: CGPoint, to: CGPoint)
  case line(from: CGPoint, to: CGPoint)
  /// Raw pointer samples; the renderer smooths them (``AnnotationPath``).
  case pen([CGPoint])
  case highlighter([CGPoint])
  /// `frame` is the laid-out text's box: its origin is where the first line starts and its size
  /// is what the editor measured, so hit-testing needs no text layout.
  case text(String, frame: CGRect)
  /// Pixelates or blurs the screenshot under the rect, as its style's ``AnnotationRedaction``.
  case mosaic(CGRect)
  /// A numbered badge, optionally with a tail from its edge to `tip` that ends in a small
  /// arrowhead (``AnnotationPath/stepTailStart(center:tip:diameter:)``). The number is not
  /// stored: it is the badge's position among the document's step badges, so deleting one
  /// renumbers the rest (and undo restores them).
  case step(center: CGPoint, tip: CGPoint? = nil)
  /// Keeps the rect bright: once any spotlight exists, the screenshot outside the union of all
  /// spotlights is dimmed (decision E11). It has no style and paints nothing of its own.
  case spotlight(CGRect)
}

/// One annotation on the frozen display.
public struct Annotation: Equatable, Identifiable, Sendable {
  public let id: UUID
  public var shape: AnnotationShape
  public var style: AnnotationStyle

  public init(id: UUID = UUID(), shape: AnnotationShape, style: AnnotationStyle) {
    self.id = id
    self.shape = shape
    self.style = style
  }
}

/// The annotation tools (D9, E11), in toolbar order.
public enum AnnotationTool: CaseIterable, Sendable {
  case select, rectangle, ellipse, arrow, line, pen, highlighter, text, mosaic, spotlight, step

  /// The single-letter shortcut that picks the tool.
  public var key: Character {
    switch self {
    case .select: "v"
    case .rectangle: "r"
    case .ellipse: "o"
    case .arrow: "a"
    case .line: "l"
    case .pen: "p"
    case .highlighter: "h"
    case .text: "t"
    case .mosaic: "m"
    case .spotlight: "s"
    case .step: "n"
    }
  }

  /// The tool whose shortcut is `characters` (the key's characters ignoring modifiers), in
  /// either case; nil for any other key.
  public init?(key characters: String) {
    guard characters.count == 1, let typed = characters.lowercased().first,
      let tool = Self.allCases.first(where: { $0.key == typed })
    else { return nil }
    self = tool
  }
}
