import AppKit

/// Images of the annotation toolbar. Functional glyphs are Lucide template image sets in the App
/// target's asset catalog (`App/Assets.xcassets/Capture/lucide-<name>.imageset`), found in the
/// main bundle by `NSImage(named:)` like the status item's images. Outside the app bundle
/// (`swift run`, tests) they are missing and the controls keep their tooltips and labels.
///
/// Source: unmodified SVGs from lucide-static 1.48.0 (ISC), the `lucide-react` version pinned in
/// `apps/desktop/package.json`, each from `https://unpkg.com/lucide-static@1.48.0/icons/<name>.svg`
/// for the names below. Swatches and the cover box depict their values, so they are drawn here.
enum AnnotationIcons {
  static let undo = "undo-2"
  static let redo = "redo-2"
  static let cancel = "x"
  static let copy = "copy"
  static let confirm = "check"
  /// The chat bar's two glyphs: open the message field, and send what it holds.
  static let chat = "message-circle"
  static let send = "arrow-up"
  static let textBackground = "square-text"
  static let grip = "grip-vertical"
  /// 工具条上的「提取文字」：扫描框里三行字。
  static let extract = "scan-text"

  /// The Lucide glyph for pixelate and blur; a drawn black box for solid, which depicts itself.
  static func redaction(_ redaction: AnnotationRedaction, label: String) -> NSImage {
    switch redaction {
    case .pixelate: return glyph("grid-3x3", label: label)
    case .blur: return glyph("droplet", label: label)
    case .solid:
      let image = NSImage(size: NSSize(width: 16, height: 16), flipped: false) { rect in
        NSColor.black.setFill()
        NSBezierPath(roundedRect: rect.insetBy(dx: 2, dy: 3), xRadius: 2, yRadius: 2).fill()
        return true
      }
      image.isTemplate = true
      image.accessibilityDescription = label
      return image
    }
  }

  static func lucideName(for tool: AnnotationTool) -> String {
    switch tool {
    case .select: "mouse-pointer-2"
    case .rectangle: "square"
    case .ellipse: "circle"
    case .arrow: "arrow-up-right"
    case .line: "slash"
    case .pen: "pencil"
    case .highlighter: "highlighter"
    case .text: "type"
    case .mosaic: "grid-3x3"
    case .spotlight: "focus"
    case .step: "list-ordered"
    }
  }

  /// The Lucide glyph `name` at toolbar size, described for VoiceOver as `label`.
  static func glyph(_ name: String, label: String) -> NSImage {
    let image =
      (NSImage(named: "lucide-\(name)")?.copy() as? NSImage)
      ?? NSImage(size: NSSize(width: 16, height: 16))
    image.size = NSSize(width: 16, height: 16)
    image.accessibilityDescription = label
    return image
  }

  /// A filled colour dot with a hairline edge in the label colour, so white stays visible on a
  /// light glass and black on a dark one (the image is drawn in the current appearance).
  static func swatch(_ color: AnnotationColor, label: String) -> NSImage {
    let image = NSImage(size: NSSize(width: 14, height: 14), flipped: false) { rect in
      let dot = NSBezierPath(ovalIn: rect.insetBy(dx: 1, dy: 1))
      color.nsColor.setFill()
      dot.fill()
      NSColor.labelColor.withAlphaComponent(0.4).setStroke()
      dot.lineWidth = 1
      dot.stroke()
      return true
    }
    image.accessibilityDescription = label
    return image
  }
}

extension AnnotationColor {
  var nsColor: NSColor {
    let rgb = components
    return NSColor(srgbRed: rgb.red, green: rgb.green, blue: rgb.blue, alpha: 1)
  }
}
