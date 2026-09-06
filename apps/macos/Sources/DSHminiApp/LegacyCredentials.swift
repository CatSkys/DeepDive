import Foundation

/// ~/.dsh/.credentials.yaml → DeepDive harness home 的旧版凭据导入
/// （恢复窗「从 ~/.dsh 导入凭据」按钮的唯一实现）。
enum LegacyCredentials {
    enum Status: Equatable {
        /// 已从 ~/.dsh 复制进 harness home。
        case imported
        /// harness home 已有凭据，无需导入（引擎热发布语义下同样视为成功）。
        case already
        /// ~/.dsh/.credentials.yaml 不存在——没有可导入的来源。
        case missing
        /// 复制失败，携带可呈现的原因。
        case failed(String)
    }

    static func perform() -> Status {
        let src = FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent(".dsh/.credentials.yaml")
        let dst = AppPaths.harnessHome.appendingPathComponent(".credentials.yaml")
        if FileManager.default.fileExists(atPath: dst.path) { return .already }
        guard FileManager.default.fileExists(atPath: src.path) else { return .missing }
        do {
            try FileManager.default.createDirectory(at: AppPaths.harnessHome, withIntermediateDirectories: true)
            try FileManager.default.copyItem(at: src, to: dst)
            EngineLog.shared.append("[credentials] imported from \(src.path)")
            return .imported
        } catch {
            EngineLog.shared.append("[credentials] import failed: \(error.localizedDescription)")
            return .failed(error.localizedDescription)
        }
    }
}
