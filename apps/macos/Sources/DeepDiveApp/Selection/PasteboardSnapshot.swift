import AppKit

/// Copies of every item on a pasteboard with all of its types' data, taken because the
/// originals belong to the pasteboard and go with `clearContents`. Promised data is resolved
/// when the snapshot is taken. ``ClipboardPaste`` and ``CopySelection`` put the user's
/// pasteboard back from one.
struct PasteboardSnapshot {
  private let items: [NSPasteboardItem]

  init(of pasteboard: NSPasteboard) {
    items = (pasteboard.pasteboardItems ?? []).map { item in
      let copy = NSPasteboardItem()
      for type in item.types {
        if let data = item.data(forType: type) { copy.setData(data, forType: type) }
      }
      return copy
    }
  }

  /// Replaces whatever `pasteboard` holds with the snapshot's items. Once per snapshot: a
  /// pasteboard item can be written only once.
  func restore(to pasteboard: NSPasteboard) {
    pasteboard.clearContents()
    if !items.isEmpty { pasteboard.writeObjects(items) }
  }
}
