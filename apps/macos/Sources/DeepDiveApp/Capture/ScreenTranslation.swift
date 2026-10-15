import Foundation
import NaturalLanguage
import Translation

/// Translation of recognized text, for the extract card's translate button: the system's
/// Translation framework with on-device models the user installs once (System Settings → General
/// → Language & Region → Translation Languages). Nothing runs until the button is pressed, and a
/// pair whose model is not installed is answered by ``isInstalled(_:)`` so the card hides the
/// button instead of failing on a press.
///
/// Which language a run of text goes into is ``target(detected:appLanguage:)`` — the app's own
/// interface language, unless the text already is in that one, in which case the other of the
/// two the interface is written in.
nonisolated enum ScreenTranslation {
  /// One translation: the language the text is in and the one it goes into.
  struct Plan: Equatable, Sendable {
    var source: Locale.Language
    var target: Locale.Language

    init(source: Locale.Language, target: Locale.Language) {
      self.source = source
      self.target = target
    }
  }

  /// The two languages the interface is written in; a translation goes between them.
  static let chinese = Locale.Language(identifier: "zh-Hans")
  static let english = Locale.Language(identifier: "en-US")

  /// What translating `text` would do, or nil when its language cannot be told. `appLanguage` is
  /// the app's own preference (`DSHAppPrefs.language`: "zh"/"en").
  static func plan(for text: String, appLanguage: String) -> Plan? {
    guard let source = detected(in: text) else { return nil }
    return Plan(source: source, target: target(detected: source, appLanguage: appLanguage))
  }

  /// The language `text` is in, per the system's language recognizer; nil when it cannot tell.
  static func detected(in text: String) -> Locale.Language? {
    let recognizer = NLLanguageRecognizer()
    recognizer.processString(text)
    return recognizer.dominantLanguage.map { Locale.Language(identifier: $0.rawValue) }
  }

  /// The language a translation goes into: `appLanguage`'s own, unless `detected` already is that
  /// one — then the other. Chinese is compared with its script: Traditional text is not
  /// Simplified, so a Simplified interface translates Traditional into Simplified.
  static func target(detected: Locale.Language, appLanguage: String) -> Locale.Language {
    let preferred = appLanguage == "en" ? english : chinese
    return isSameLanguage(detected, preferred) ? (preferred == english ? chinese : english)
      : preferred
  }

  /// Whether both models of `plan` are installed; the framework refuses to run without them.
  @concurrent
  static func isInstalled(_ plan: Plan) async -> Bool {
    await LanguageAvailability().status(from: plan.source, to: plan.target) == .installed
  }

  /// Translates `text` along `plan`.
  @concurrent
  static func translate(_ text: String, _ plan: Plan) async throws -> String {
    let session = TranslationSession(installedSource: plan.source, target: plan.target)
    return try await session.translate(text).targetText
  }

  /// Whether two tags name the same language: the language and, when both tags spell it out, the
  /// script. A tag without a script ("zh") matches any script of its language.
  private static func isSameLanguage(_ a: Locale.Language, _ b: Locale.Language) -> Bool {
    guard a.languageCode == b.languageCode else { return false }
    guard let script = a.script, let otherScript = b.script else { return true }
    return script == otherScript
  }
}
