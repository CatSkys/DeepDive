// AppDelegate 的「磁盘/工作区类」host 命令（从 AppDelegate.swift 拆出，行数
// 棘轮 + §「新逻辑不再向上堆」）：目录列举/打开方式候选/项目目录落地/项目
// 指令落盘/空间格图标。它们共同的纪律就是**磁盘 IO/LaunchServices 查询一律
// 后台队列（对齐 runGit 样板），主线程只回推 payload**——本章是这条纪律的
// 既有落点，git 族不在此（留在主文件的 gitChanges/gitRun）。
import Foundation

extension AppDelegate {
    /// 壳侧目录列举（@ 引用候选源，host.listDir 契约见 frontend/src/host.ts）：
    /// 一层目录、目录优先、隐藏文件排除。错误也回包（entries 空 + error），
    /// 前端按 reqId 配对。目录 IO 在后台队列（对齐 runGit 的线程纪律——此前在
    /// 主线程同步读目录，深目录/慢盘会把输入框的 @ 弹层卡住）。
    func listDirectory(reqId: String, path: String, to source: BridgeSource) {
        // 应答回**发起的那一页**（@ 引用候选两页都要用，见 pushHost 的注释）
        func reply(_ entries: [[String: Any]], error: String? = nil) {
            var fields: [String: Any] = ["reqId": reqId, "entries": entries]
            if let error { fields["error"] = error }
            pushHost("dirListing", payload: fields, to: source)
        }
        guard FileManager.default.fileExists(atPath: path) else {
            reply([], error: "not-found")
            return
        }
        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            let items = (try? FileManager.default.contentsOfDirectory(
                at: URL(fileURLWithPath: path),
                includingPropertiesForKeys: [.isDirectoryKey, .isHiddenKey],
            )) ?? []
            struct Row { let name: String; let path: String; let isDir: Bool }
            var rows: [Row] = []
            for url in items {
                guard let values = try? url.resourceValues(forKeys: [.isDirectoryKey, .isHiddenKey]),
                      values.isHidden != true else { continue }
                rows.append(Row(name: url.lastPathComponent, path: url.path, isDir: values.isDirectory ?? false))
            }
            rows.sort { a, b in
                if a.isDir != b.isDir { return a.isDir }
                return a.name < b.name
            }
            let payload = rows.prefix(200).map { ["name": $0.name, "path": $0.path, "isDir": $0.isDir] }
            DispatchQueue.main.async { reply(payload) }
        }
    }

    /// 全屏预览页「打开方式」候选：OpenWithCatalog 出事实（App 列表 + 图标
    /// dataURL + 默认 App），这里只负责按桥约定回推。文件不存在/无候选回空表
    /// （前端按「无候选」隐藏选择器，不冒充）。LaunchServices 逐 App 查询在
    /// 后台队列（对齐 runGit 的线程纪律；此前主线程同步查询，候选多时预览页
    /// 点「打开方式」会卡）。
    func openWithList(reqId: String, path: String, out window: MainWindowController) {
        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            let listing = OpenWithCatalog.listing(forPath: path)
            DispatchQueue.main.async {
                guard let listing else {
                    window.pushHostCommand(
                        "openWith",
                        payload: AppDelegate.jsonPayload(["reqId": reqId, "defaultId": "", "apps": []]),
                    )
                    return
                }
                window.pushHostCommand(
                    "openWith",
                    payload: AppDelegate.jsonPayload(OpenWithCatalog.payload(listing, reqId: reqId)),
                )
            }
        }
    }

    /// 新建项目弹窗的落地准备：① 目录——引擎 workspace/create 要求目录已
    /// 存在（vendored workspace 包 realpath+stat 校验），自动建目录只能在壳
    /// 做：未显式给 path 时在 ~/Documents/DeepDive Projects/<净化名> 下建
    /// （撞名追加序号）；② 项目指令——写入 <目录>/AGENTS.md（引擎按会话
    /// cwd 读它），文件已存在则不改动。磁盘操作走后台队列（对齐 runGit
    /// 的线程纪律），主线程只回推 payload。
    func prepareWorkspace(reqId: String, path: String, name: String, instructions: String, out window: MainWindowController) {
        func reply(_ fields: [String: Any]) {
            var all = fields
            all["reqId"] = reqId
            window.pushHostCommand("workspacePrepared", payload: AppDelegate.jsonPayload(all))
        }
        DispatchQueue.global(qos: .userInitiated).async {
            var target = path
            if target.isEmpty {
                let safe = name
                    .components(separatedBy: CharacterSet(charactersIn: "/:").union(.newlines).union(.controlCharacters))
                    .joined(separator: "-")
                    .trimmingCharacters(in: .whitespacesAndNewlines)
                let base = FileManager.default.homeDirectoryForCurrentUser
                    .appendingPathComponent("Documents", isDirectory: true)
                    .appendingPathComponent("DeepDive Projects", isDirectory: true)
                var candidate = base.appendingPathComponent(safe.isEmpty ? "Project" : safe)
                var n = 2
                while FileManager.default.fileExists(atPath: candidate.path) {
                    candidate = base.appendingPathComponent("\(safe.isEmpty ? "Project" : safe) \(n)")
                    n += 1
                }
                target = candidate.path
            }
            let fm = FileManager.default
            do {
                try fm.createDirectory(atPath: target, withIntermediateDirectories: true)
            } catch {
                DispatchQueue.main.async { reply(["error": error.localizedDescription]) }
                return
            }
            var agentsFile = false
            if !instructions.isEmpty {
                let agents = URL(fileURLWithPath: target).appendingPathComponent("AGENTS.md")
                if !fm.fileExists(atPath: agents.path) {
                    do {
                        try instructions.write(to: agents, atomically: true, encoding: .utf8)
                        agentsFile = true
                    } catch {
                        DispatchQueue.main.async { reply(["error": error.localizedDescription]) }
                        return
                    }
                }
            }
            DispatchQueue.main.async { reply(["path": target, "agentsFile": agentsFile]) }
        }
    }

    /// 编辑项目弹窗的落盘：覆写 <项目>/AGENTS.md（与 prepare-workspace 的
    /// 「已存在不改动」相反——编辑是用户显式改，覆盖原内容）。磁盘操作走
    /// 后台队列（对齐 prepareWorkspace 的线程纪律），主线程只回推 payload。
    func writeAgents(reqId: String, path: String, instructions: String, out window: MainWindowController) {
        func reply(_ fields: [String: Any]) {
            var all = fields
            all["reqId"] = reqId
            window.pushHostCommand("agentsWritten", payload: AppDelegate.jsonPayload(all))
        }
        DispatchQueue.global(qos: .userInitiated).async {
            let agents = URL(fileURLWithPath: path).appendingPathComponent("AGENTS.md")
            do {
                try instructions.write(to: agents, atomically: true, encoding: .utf8)
                DispatchQueue.main.async { reply(["ok": true]) }
            } catch {
                DispatchQueue.main.async { reply(["ok": false, "error": error.localizedDescription]) }
            }
        }
    }

    /// 侧栏空间格图标：读项目根目录约定图标文件（WorkspaceIcon.probe），
    /// base64 dataURL 回推；无图标/路径非目录回空串——前端回落项目首字母。
    /// 文件 IO + base64 在后台队列（对齐 runGit 的线程纪律；此前主线程同步
    /// 读盘编码，慢盘会卡侧栏)。
    func readWorkspaceIcon(reqId: String, path: String, out window: MainWindowController) {
        func reply(_ dataUrl: String) {
            window.pushHostCommand("workspaceIcon", payload: AppDelegate.jsonPayload(["reqId": reqId, "dataUrl": dataUrl]))
        }
        DispatchQueue.global(qos: .userInitiated).async {
            let dir = URL(fileURLWithPath: path)
            var isDir: ObjCBool = false
            guard FileManager.default.fileExists(atPath: dir.path, isDirectory: &isDir), isDir.boolValue,
                  let hit = WorkspaceIcon.probe(in: dir) else {
                DispatchQueue.main.async { reply("") }
                return
            }
            let dataUrl = "data:\(hit.mime);base64,\(hit.data.base64EncodedString())"
            DispatchQueue.main.async { reply(dataUrl) }
        }
    }
}
