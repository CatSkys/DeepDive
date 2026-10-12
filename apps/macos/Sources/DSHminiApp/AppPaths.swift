import Foundation

/// Filesystem locations owned by DSHmini.
enum AppPaths {
    static var supportDir: URL {
        // Dev isolation hook (same family as DSHMINI_WEB_ROOT/DSHMINI_DSH_ENTRY):
        // lets a second, test instance run beside a live one without touching
        // its harness home or instance lock.
        if let env = ProcessInfo.processInfo.environment["DSHMINI_SUPPORT_DIR"], !env.isEmpty {
            let override = URL(fileURLWithPath: env, isDirectory: true)
            try? FileManager.default.createDirectory(at: override, withIntermediateDirectories: true)
            return override
        }
        // §5 按树隔离：测试宿主（xcodebuild test 会注入 XCTest 环境）把支撑目录
        // 钉在所属树的 .build/test-support——每棵树自己的 instance.lock，多树并行
        // 测试互不挡。真机 app（无 XCTest 环境）不走这条，仍用共享支撑目录。
        // 布局假设：宿主 bundle 位于 <树根>/.build/debug/Build/Products/Debug/*.app；
        // 前缀不符（布局将来变了）就落回共享目录——宁可退回旧行为也不猜。
        if ProcessInfo.processInfo.environment["XCTestConfigurationFilePath"] != nil {
            let bundlePath = Bundle.main.bundleURL.path
            let layoutSuffix = "/.build/debug/Build/Products/Debug/"
            if bundlePath.contains(layoutSuffix),
               let cut = bundlePath.range(of: layoutSuffix) {
                let treeRoot = String(bundlePath[..<cut.lowerBound])
                let scratch = URL(fileURLWithPath: treeRoot, isDirectory: true)
                    .appendingPathComponent(".build/test-support", isDirectory: true)
                try? FileManager.default.createDirectory(at: scratch, withIntermediateDirectories: true)
                return scratch
            }
        }
        let fm = FileManager.default
        let base = fm.urls(for: .applicationSupportDirectory, in: .userDomainMask).first
            ?? fm.homeDirectoryForCurrentUser.appendingPathComponent("Library/Application Support")
        let dir = base.appendingPathComponent("DeepDive", isDirectory: true)
        try? fm.createDirectory(at: dir, withIntermediateDirectories: true)
        // 品牌改名一次性迁移（BRANDING §5）：旧 ~/Library/Application
        // Support/DSHmini 的全部内容（harness 会话/config.yaml/engine.log/
        // instance.lock）按子项搬入新目录；按项搬运而非整目录改名，兼容旧
        // 目录仍被旧版占用的场景。
        if !UserDefaults.standard.bool(forKey: "deepdive.dirMigratedFromDSHmini") {
            let old = base.appendingPathComponent("DSHmini", isDirectory: true)
            if fm.fileExists(atPath: old.path) {
                for c in (try? fm.contentsOfDirectory(atPath: old.path)) ?? [] {
                    let src = old.appendingPathComponent(c)
                    let dst = dir.appendingPathComponent(c)
                    if !fm.fileExists(atPath: dst.path) {
                        try? fm.moveItem(at: src, to: dst)
                    }
                }
            }
            UserDefaults.standard.set(true, forKey: "deepdive.dirMigratedFromDSHmini")
        }
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
