import Foundation

/// The last confirmed selection per display, for this app run (decision F3): `R` in idle
/// selects it again. A region is offered only while its display keeps the frame it was taken
/// on; a rearranged or resized display would put it somewhere the user never selected.
public struct CaptureRegionMemory: Equatable, Sendable {
  private struct Region: Equatable, Sendable {
    var displayFrame: CGRect
    var selection: CGRect
  }

  private var regions: [UInt32: Region] = [:]

  public init() {}

  /// Remembers `selection` (the display's view points) for the display `displayID`, whose
  /// Quartz frame is `displayFrame`; it replaces the display's previous region.
  public mutating func remember(_ selection: CGRect, displayID: UInt32, displayFrame: CGRect) {
    regions[displayID] = Region(displayFrame: displayFrame, selection: selection)
  }

  /// The region remembered for `displayID`, or nil when there is none or the display's frame is
  /// no longer `displayFrame`.
  public func region(displayID: UInt32, displayFrame: CGRect) -> CGRect? {
    guard let region = regions[displayID], region.displayFrame == displayFrame else { return nil }
    return region.selection
  }
}

/// The most recent values by key, oldest dropped first once ``capacity`` is reached. Holds
/// what reopening a capture needs (decision F2) for the last few captures of this app run.
public struct RecentValues<Value> {
  public let capacity: Int
  private var entries: [(key: String, value: Value)] = []

  public init(capacity: Int) {
    self.capacity = max(capacity, 0)
  }

  public var count: Int { entries.count }

  /// Stores `value` as the newest; a value already under `key` is replaced.
  public mutating func insert(_ value: Value, for key: String) {
    entries.removeAll { $0.key == key }
    entries.append((key, value))
    if entries.count > capacity { entries.removeFirst(entries.count - capacity) }
  }

  public func value(for key: String) -> Value? {
    entries.last { $0.key == key }?.value
  }
}

extension RecentValues: Sendable where Value: Sendable {}
