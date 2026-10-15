import CoreGraphics
import Foundation

/// All annotations of a capture, back to front: later ones draw over earlier ones, and
/// hit-testing prefers the front-most. A value, so undo can restore any earlier document whole.
public struct AnnotationDocument: Equatable, Sendable {
  public private(set) var annotations: [Annotation]

  public init(_ annotations: [Annotation] = []) {
    self.annotations = annotations
  }

  public var isEmpty: Bool { annotations.isEmpty }

  public subscript(id: UUID) -> Annotation? {
    annotations.first { $0.id == id }
  }

  /// Adds `annotation` in front of the others.
  public mutating func add(_ annotation: Annotation) {
    annotations.append(annotation)
  }

  /// Replaces the annotation with the same id, keeping its place in the z-order.
  public mutating func update(_ annotation: Annotation) {
    guard let index = annotations.firstIndex(where: { $0.id == annotation.id }) else { return }
    annotations[index] = annotation
  }

  public mutating func remove(_ id: UUID) {
    annotations.removeAll { $0.id == id }
  }

  /// The front-most annotation under `point`, with `tolerance` points of slack around strokes.
  public func hit(at point: CGPoint, tolerance: CGFloat) -> UUID? {
    annotations.last { $0.contains(point, tolerance: tolerance) }?.id
  }

  /// The document with every annotation moved by `offset`: between the overlay's view points
  /// and selection-local points, in which a capture is archived for reopening.
  public func translated(by offset: CGVector) -> AnnotationDocument {
    AnnotationDocument(annotations.map { $0.moved(by: offset) })
  }

  /// The 1-based number a step badge shows: its position among the step badges.
  public func stepNumber(of id: UUID) -> Int? {
    var number = 0
    for annotation in annotations {
      guard case .step = annotation.shape else { continue }
      number += 1
      if annotation.id == id { return number }
    }
    return nil
  }
}
