import Foundation

/// 插件市场壳侧安装仓（§7）：「发现在前端、安装在壳侧」分工的壳半。
/// 安装 = 下载 repo tarball → 解包 → 校验 package.json → 原子移入
/// DSH_HOME/plugins/<id> → 记入清单。红线：不执行任何插件脚本（tar 解包是
/// 打包机制；引擎装载走 patch insert 的绝对路径 file URL，无 npm 生命周期）。
final class PluginStore {
    struct Entry: Codable {
        let id: String
        let repo: String
        let packageName: String
        let dir: String
    }

    static func manifestURL(home: URL) -> URL {
        home.appendingPathComponent("deepdive-plugins.json")
    }

    static func load(home: URL) -> [Entry] {
        guard let data = try? Data(contentsOf: manifestURL(home: home)),
              let entries = try? JSONDecoder().decode([Entry].self, from: data) else { return [] }
        return entries
    }

    static func save(home: URL, entries: [Entry]) {
        let url = manifestURL(home: home)
        guard let data = try? JSONEncoder().encode(entries) else { return }
        try? data.write(to: url, options: .atomic)
    }

    static func pluginsDir(home: URL) -> URL {
        home.appendingPathComponent("plugins", isDirectory: true)
    }

    /// 用户插件的 patch insert 条目（绝对路径 → 引擎转 file URL 装载；
    /// 与 app 内建 insert 一并在每次启动重写的 engine-patch.yml 里）。
    static func patchInsertLines(home: URL) -> [String] {
        load(home: home).map { entry in
            """
            - id: plugin-\(entry.id)
              name: '\(entry.dir)'
            """
        }
    }

    /// 下载并安装一个 GitHub 仓库（默认分支 HEAD tarball）。completion 在后台
    /// 线程回调；幂等：同 id 重装 = 原子替换。
    struct InstallError: Error { let message: String }

    static func install(home: URL, repo: String, completion: @escaping (Result<Entry, InstallError>) -> Void) {
        let cleaned = repo
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .replacingOccurrences(of: "https://github.com/", with: "")
            .replacingOccurrences(of: ".git", with: "")
        let parts = cleaned.split(separator: "/").map(String.init)
        guard parts.count >= 2, !parts[0].isEmpty, !parts[1].isEmpty else {
            completion(.failure(InstallError(message: "仓库地址无效：需要 owner/repo")))
            return
        }
        let owner = parts[0], name = parts[1]
        let id = name.lowercased()
        let url = URL(string: "https://codeload.github.com/\(owner)/\(name)/tar.gz/HEAD")!
        let tmpDir = pluginsDir(home: home).appendingPathComponent(".tmp-\(id)-\(Int(Date().timeIntervalSince1970))", isDirectory: true)

        let task = URLSession.shared.downloadTask(with: url) { location, response, error in
            let http = response as? HTTPURLResponse
            guard error == nil, let location, http?.statusCode == 200 else {
                completion(.failure(InstallError(message: "下载失败：\(http?.statusCode ?? -1) \(error?.localizedDescription ?? "")")))
                return
            }
            do {
                try FileManager.default.createDirectory(at: tmpDir, withIntermediateDirectories: true)
                let archive = tmpDir.appendingPathComponent("repo.tar.gz")
                try FileManager.default.moveItem(at: location, to: archive)
                // 系统 tar 解包：打包机制而非插件脚本（红线只针对插件自身的安装钩子）
                let tar = Process()
                tar.executableURL = URL(fileURLWithPath: "/usr/bin/tar")
                tar.arguments = ["-xzf", archive.path, "-C", tmpDir.path]
                try tar.run()
                tar.waitUntilExit()
                guard tar.terminationStatus == 0 else { throw NSError(domain: "plugin", code: 1) }

                // 定位包根（tarball 顶层是 <repo>-<sha>/；包根 = 含 package.json 的最浅目录）
                guard let root = Self.findPackageRoot(in: tmpDir) else {
                    throw NSError(domain: "plugin", code: 2)
                }
                guard let pkgData = try? Data(contentsOf: root.appendingPathComponent("package.json")),
                      let pkg = try? JSONSerialization.jsonObject(with: pkgData) as? [String: Any],
                      let packageName = pkg["name"] as? String, !packageName.isEmpty else {
                    throw NSError(domain: "plugin", code: 3)
                }

                // 原子落位：目标先移走再移入（同卷 rename）
                let dest = Self.pluginsDir(home: home).appendingPathComponent(id, isDirectory: true)
                try? FileManager.default.removeItem(at: dest)
                try FileManager.default.createDirectory(at: Self.pluginsDir(home: home), withIntermediateDirectories: true)
                try FileManager.default.moveItem(at: root, to: dest)
                try? FileManager.default.removeItem(at: tmpDir)

                let entry = Entry(id: id, repo: "\(owner)/\(name)", packageName: packageName, dir: dest.path)
                var entries = load(home: home).filter { $0.id != id }
                entries.append(entry)
                save(home: home, entries: entries)
                completion(.success(entry))
            } catch {
                try? FileManager.default.removeItem(at: tmpDir)
                completion(.failure(InstallError(message: "安装失败：\(error.localizedDescription)（缺 package.json 的仓库不能作为引擎插件安装）")))
            }
        }
        task.resume()
    }

    static func remove(home: URL, id: String) {
        var entries = load(home: home)
        guard let entry = entries.first(where: { $0.id == id }) else { return }
        try? FileManager.default.removeItem(atPath: entry.dir)
        entries.removeAll { $0.id == id }
        save(home: home, entries: entries)
    }

    /// 包根 = 目录树里最浅的含 package.json 的目录（跳过 tarball 顶层壳）。
    private static func findPackageRoot(in dir: URL) -> URL? {
        let fm = FileManager.default
        if fm.fileExists(atPath: dir.appendingPathComponent("package.json").path) { return dir }
        guard let children = try? fm.contentsOfDirectory(at: dir, includingPropertiesForKeys: [.isDirectoryKey]) else { return nil }
        for child in children where (try? child.resourceValues(forKeys: [.isDirectoryKey]))?.isDirectory == true {
            if let found = findPackageRoot(in: child) { return found }
        }
        return nil
    }
}
