// 会话数据维护：取消归档 / 删除（用户定稿功能）。
//
// 为什么由壳来做：引脚的引擎 wire 面只有 `workspace/archiveSession`（单向），
// 既没有取消归档也没有删除会话的方法——官方自己的 README 也写着 “No Session
// deletion or unarchive control”。而归档集与会话日志都是 DSH_HOME 下的普通文件：
//   归档集 = storages/workspace.json 的 global.archivedSessionIds
//   会话日志 = sessions/<转义 cwd>/<sessionId>/（session*.jsonl.zstd + lock）
//   投影缓存 = storages/session_projcache/sessions/<sessionId>.json
//              （per-record 布局：一个会话一份文档，见引擎
//              session-projection-cache/src/spec.ts 的 layout: 'per-record'。
//              同名的 session_projcache.json 是旧整文件布局，引擎只在"新树里
//              一个文档都没有"时拿它做 bootstrap，此后**永不读写**——别再写它。）
//
// 两条路径（用户定稿：**不重启引擎**，重启太慢且会闪断连横幅）：
//   ① 立即：删掉被删会话的日志目录（毫秒级，不需要引擎配合）；
//   ② 延迟：取消归档 / 删除在引擎状态里的落账，登记到 UserDefaults，等**下次启动
//      的空窗期**（引擎还没起）一次落盘——引擎把归档集与会话列表缓存在内存（实测：
//      运行中删日志目录后 session/list 照样列它），运行期改文件会被内存状态覆写，
//      所以只在停机时写。
// 纪律：JSON 结构不符预期一律不写、fail-loud 报错，不做“尽量修一修”的兜底。
// 会话是否在跑 / 是否正开着由调用方把关（壳这边读不到运行态，见 deleteDirectories）。

import Foundation

enum SessionAdmin {
    struct Result: Equatable {
        /** 实际处理成功的 sessionId（删目录失败的计入 error，不计入这里）。 */
        var removed: [String]
        var error: String?
    }

    // MARK: - 对外操作

    // MARK: - 纯函数（单测钉子）

    /** 摘掉归档集里的这些 id；结构不符预期回 nil（调用方不写盘）。 */
    static func removingArchived(_ ids: Set<String>, from state: [String: Any]) -> [String: Any]? {
        guard let global = state["global"] as? [String: Any],
              let archived = global["archivedSessionIds"] as? [String] else { return nil }
        var nextGlobal = global
        nextGlobal["archivedSessionIds"] = archived.filter { !ids.contains($0) }
        var next = state
        next["global"] = nextGlobal
        return next
    }

    /** 投影缓存里这些会话的文档（per-record：一会话一份，见文件头）。
     *  整文件 session_projcache.json 是引擎的 legacy bootstrap，按存储层契约
     *  "never changed or deleted"——不碰它。 */
    static func projectionDocuments(in home: URL, sessionIds: Set<String>) -> [URL] {
        let dir = home.appendingPathComponent("storages/session_projcache/sessions", isDirectory: true)
        let files = (try? FileManager.default.contentsOfDirectory(
            at: dir, includingPropertiesForKeys: nil, options: [.skipsHiddenFiles],
        )) ?? []
        return files.filter { sessionIds.contains($0.deletingPathExtension().lastPathComponent) &&
            $0.pathExtension == "json" }
    }

    /** 会话日志目录：sessions/<转义 cwd>/<sessionId>/（目录名就是 sessionId，
     *  不去复刻引擎的 cwd 转义规则，直接扫一层找同名目录）。 */
    static func sessionDirectories(in home: URL, sessionIds: Set<String>) -> [URL] {
        let root = home.appendingPathComponent("sessions", isDirectory: true)
        guard let buckets = try? FileManager.default.contentsOfDirectory(
            at: root, includingPropertiesForKeys: [.isDirectoryKey], options: [.skipsHiddenFiles],
        ) else { return [] }
        var hits: [URL] = []
        for bucket in buckets {
            for id in sessionIds {
                let dir = bucket.appendingPathComponent(id, isDirectory: true)
                var isDir: ObjCBool = false
                if FileManager.default.fileExists(atPath: dir.path, isDirectory: &isDir), isDir.boolValue {
                    hits.append(dir)
                }
            }
        }
        return hits
    }

    // MARK: - 文件读写

    private static func readJSON(_ url: URL) -> [String: Any]? {
        guard let data = try? Data(contentsOf: url) else { return nil }
        return (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
    }

    /** 原子写（临时文件 + 替换）：写坏引擎状态文件的代价太高。 */
    private static func writeJSON(_ state: [String: Any], to url: URL) -> Bool {
        guard let data = try? JSONSerialization.data(withJSONObject: state) else { return false }
        let tmp = url.deletingLastPathComponent().appendingPathComponent(".\(url.lastPathComponent).tmp")
        do {
            try data.write(to: tmp)
            _ = try FileManager.default.replaceItemAt(url, withItemAt: tmp)
            return true
        } catch {
            try? FileManager.default.removeItem(at: tmp)
            return false
        }
    }

    // MARK: - 延迟落账（下次启动的空窗期）

    /// 覆盖集的持久登记（UserDefaults）：壳在引擎未起的空窗期把它落到引擎状态文件。
    private static let pendingKey = "deepdive.pendingSessionAdmin"

    static func remember(unarchived: [String], removed: [String]) {
        UserDefaults.standard.set(["unarchived": unarchived, "removed": removed], forKey: pendingKey)
    }

    private static func pending() -> (unarchived: [String], removed: [String]) {
        let raw = UserDefaults.standard.dictionary(forKey: pendingKey) ?? [:]
        return (raw["unarchived"] as? [String] ?? [], raw["removed"] as? [String] ?? [])
    }

    /// 启动空窗期落账：把归档集里这些 id 摘掉、删投影缓存文档、补删 removed 的日志
    /// 目录（删目录可能在上次运行中失败——进程被杀/权限），最后清空登记。
    /// 调用方保证此刻引擎还没起（否则写文件会被内存状态覆写）。
    @discardableResult
    static func applyPending(home: URL) -> Result? {
        let pend = pending()
        let ids = Set(pend.unarchived).union(pend.removed)
        guard !ids.isEmpty else { return nil }
        var removed: [String] = []
        var errors: [String] = []
        let workspaceURL = home.appendingPathComponent("storages/workspace.json")
        if let state = readJSON(workspaceURL), let next = removingArchived(ids, from: state) {
            if !writeJSON(next, to: workspaceURL) { errors.append("workspace 状态写入失败") }
        } else {
            errors.append("workspace 状态不可用")
        }
        for doc in projectionDocuments(in: home, sessionIds: Set(pend.removed)) {
            do {
                try FileManager.default.removeItem(at: doc)
            } catch {
                errors.append("投影缓存 \(doc.lastPathComponent): \(error.localizedDescription)")
            }
        }
        for dir in sessionDirectories(in: home, sessionIds: Set(pend.removed)) {
            do {
                try FileManager.default.removeItem(at: dir)
                removed.append(dir.lastPathComponent)
            } catch {
                errors.append("\(dir.lastPathComponent): \(error.localizedDescription)")
            }
        }
        // 只在全部落到位时清登记：失败（状态文件不可读等）留到下次启动再试
        if errors.isEmpty { UserDefaults.standard.removeObject(forKey: pendingKey) }
        return Result(removed: removed, error: errors.isEmpty ? nil : errors.joined(separator: "; "))
    }

    /// 立即删掉这些会话的日志目录与投影缓存文档。
    /// **会话在跑 / 正开着由调用方挡住**（壳读不到运行态，这里不猜）。
    static func deleteDirectories(sessionIds: [String], home: URL) -> Result {
        let ids = Set(sessionIds)
        var removed: [String] = []
        var errors: [String] = []
        for doc in projectionDocuments(in: home, sessionIds: ids) {
            do {
                try FileManager.default.removeItem(at: doc)
            } catch {
                errors.append("投影缓存 \(doc.lastPathComponent): \(error.localizedDescription)")
            }
        }
        for dir in sessionDirectories(in: home, sessionIds: ids) {
            do {
                try FileManager.default.removeItem(at: dir)
                removed.append(dir.lastPathComponent)
            } catch {
                errors.append("\(dir.lastPathComponent): \(error.localizedDescription)")
            }
        }
        return Result(removed: removed, error: errors.isEmpty ? nil : errors.joined(separator: "; "))
    }
}
