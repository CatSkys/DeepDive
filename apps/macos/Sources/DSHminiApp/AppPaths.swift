import Foundation

/// Filesystem locations owned by DSHmini.
enum AppPaths {
    static var supportDir: URL {
        let fm = FileManager.default
        let base = fm.urls(for: .applicationSupportDirectory, in: .userDomainMask).first
            ?? fm.homeDirectoryForCurrentUser.appendingPathComponent("Library/Application Support")
        let dir = base.appendingPathComponent("DSHmini", isDirectory: true)
        try? fm.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir
    }

    /// Dedicated Harness home; isolated from any other dsh installation.
    static var harnessHome: URL { supportDir.appendingPathComponent("harness", isDirectory: true) }
    static var configURL: URL { supportDir.appendingPathComponent("config.json") }
    static var logURL: URL { supportDir.appendingPathComponent("engine.log") }
}

/// Minimal shell configuration (v1).
struct AppConfig: Codable {
    var hotkey: String = "option+space"
    /// Monochrome dark-glass theme (CSS token overrides + forced dark
    /// appearance). Off = stock official UI following the system.
    var themeEnabled: Bool = true
    var launchWorkspace: String?
    var openAtLogin: Bool = false

    static func load() -> AppConfig {
        guard let data = try? Data(contentsOf: AppPaths.configURL),
              let cfg = try? JSONDecoder().decode(AppConfig.self, from: data) else {
            return AppConfig()
        }
        return cfg
    }

    func save() {
        let enc = JSONEncoder()
        enc.outputFormatting = [.prettyPrinted, .sortedKeys]
        if let data = try? enc.encode(self) {
            try? data.write(to: AppPaths.configURL, options: .atomic)
        }
    }

    var workspaceURL: URL? {
        guard let path = launchWorkspace, !path.isEmpty else { return nil }
        var isDir: ObjCBool = false
        guard FileManager.default.fileExists(atPath: path, isDirectory: &isDir), isDir.boolValue else { return nil }
        return URL(fileURLWithPath: path, isDirectory: true)
    }
}
