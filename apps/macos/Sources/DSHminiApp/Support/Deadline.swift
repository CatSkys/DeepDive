import Synchronization

/// Bounded waits for operations that cannot be cancelled (a blocking AX read, a request to a
/// slow service).
nonisolated enum Deadline {
  /// The operation's value, or `fallback` once `limit` passes, whichever comes first. A late
  /// operation keeps running and its value is dropped.
  static func value<T: Sendable>(
    within limit: Duration, fallback: T, _ operation: @escaping @Sendable () async -> T
  ) async -> T {
    let answer = FirstAnswer<T>()
    return await withCheckedContinuation { continuation in
      answer.install(continuation)
      Task.detached(priority: .userInitiated) { answer.resume(await operation()) }
      Task.detached {
        try? await Task.sleep(for: limit)
        answer.resume(fallback)
      }
    }
  }
}

/// Resumes a continuation with the first value only.
private nonisolated final class FirstAnswer<Value: Sendable>: Sendable {
  private struct State {
    var continuation: CheckedContinuation<Value, Never>?
    var answered = false
  }

  private let state = Mutex(State())

  func install(_ continuation: CheckedContinuation<Value, Never>) {
    state.withLock { $0.continuation = continuation }
  }

  func resume(_ value: Value) {
    let continuation = state.withLock { state -> CheckedContinuation<Value, Never>? in
      guard !state.answered else { return nil }
      state.answered = true
      return state.continuation
    }
    continuation?.resume(returning: value)
  }
}
