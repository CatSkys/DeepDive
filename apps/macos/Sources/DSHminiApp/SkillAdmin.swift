// 技能与插件管理面（设置 → 技能与插件）里属于壳的那一半：**技能**。
//
// 为什么技能由壳来做：技能是 `<DSH_HOME>/skills/<name>/SKILL.md` 的普通文件（引擎按
// rank 400 发现、chokidar 热生效），wire 上**没有任何 skill 方法**，前端读不到盘。
// 插件的清单来自引擎 `pluginInventory/list`（只读，前端直读），启停落在应用自己的
// overlay patch 上（`EngineSupervisor.enginePatchBody`）——那是另一个家。
//
// 纪律：技能目录只认技能根下的一层（拒路径穿越）；frontmatter 缺 `name`/`description`
// 的技能**引擎会静默忽略**（日志只留 warn），所以这里照样列出来并标注缺了什么，
// 不替它补默认值、也不把坏技能藏起来。

import Foundation

enum SkillAdmin {
    struct Skill: Equatable {
        /// 目录名 = 技能的发现单位，也是删除目标。
        var id: String
        /// frontmatter 的 name（模型看到的技能名）；缺失回退目录名。
        var title: String
        /// frontmatter 的 description；缺失为空串。
        var detail: String
        /// SKILL.md 的绝对路径（Finder 定位用）。
        var manifest: String
        /// 技能目录的绝对路径（删除用）。
        var directory: String
        /// frontmatter 缺的必填键；非空 = 引擎会忽略这个技能。
        var missing: [String]
    }

    /// 随应用发布、每次启动重写的技能：列表里标注来源，不提供删除（删了下次启动回来）。
    static var managedNames: Set<String> {
        [
            EngineSupervisor.automationSkillName,
            EngineSupervisor.evolutionSkillName,
            EngineSupervisor.sessionMemorySkillName,
        ]
    }

    /// `<home>/skills/<name>/SKILL.md` 的清单（按目录名排序）。
    static func list(in home: URL) -> [Skill] {
        let root = home.appendingPathComponent("skills", isDirectory: true)
        let fm = FileManager.default
        let entries = (try? fm.contentsOfDirectory(
            at: root, includingPropertiesForKeys: [.isDirectoryKey], options: [.skipsHiddenFiles],
        )) ?? []
        var skills: [Skill] = []
        for dir in entries {
            var isDirectory: ObjCBool = false
            guard fm.fileExists(atPath: dir.path, isDirectory: &isDirectory), isDirectory.boolValue else { continue }
            let manifest = dir.appendingPathComponent("SKILL.md")
            guard let text = try? String(contentsOf: manifest, encoding: .utf8) else { continue }
            let head = frontmatter(text)
            let id = dir.lastPathComponent
            let title = head["name"] ?? ""
            let detail = head["description"] ?? ""
            var missing: [String] = []
            if title.isEmpty { missing.append("name") }
            if detail.isEmpty { missing.append("description") }
            skills.append(Skill(
                id: id,
                title: title.isEmpty ? id : title,
                detail: detail,
                manifest: manifest.path,
                directory: dir.path,
                missing: missing,
            ))
        }
        return skills.sorted { $0.id < $1.id }
    }

    /// 删除一个技能目录；成功回 nil，否则回给用户看的原因。
    static func remove(directory: String, home: URL) -> String? {
        let root = home.appendingPathComponent("skills", isDirectory: true).standardizedFileURL
        let target = URL(fileURLWithPath: directory).standardizedFileURL
        // 只认技能根下的**一层**目录：目录本身不是根、且父目录就是根
        guard target.path != root.path, target.deletingLastPathComponent().path == root.path else {
            return "只能删除技能根下的一层目录"
        }
        guard FileManager.default.fileExists(atPath: target.appendingPathComponent("SKILL.md").path) else {
            return "这个目录里没有 SKILL.md，没有删除"
        }
        do {
            try FileManager.default.removeItem(at: target)
            return nil
        } catch {
            return error.localizedDescription
        }
    }

    // MARK: - 纯函数（单测钉子）

    /// SKILL.md 正文 → frontmatter 键值。起始行必须是独立的 `---`；到下一个 `---` 结束；
    /// 值两端成对的引号剥掉（YAML 里 description 常带引号与冒号）。
    static func frontmatter(_ text: String) -> [String: String] {
        let lines = text.replacingOccurrences(of: "\r\n", with: "\n")
            .split(separator: "\n", omittingEmptySubsequences: false)
        guard lines.first?.trimmingCharacters(in: .whitespaces) == "---" else { return [:] }
        var out: [String: String] = [:]
        for raw in lines.dropFirst() {
            let line = raw.trimmingCharacters(in: .whitespaces)
            if line == "---" { break }
            guard let colon = line.firstIndex(of: ":") else { continue }
            let key = String(line[line.startIndex..<colon]).trimmingCharacters(in: .whitespaces)
            var value = String(line[line.index(after: colon)...]).trimmingCharacters(in: .whitespaces)
            if value.count >= 2,
               (value.hasPrefix("\"") && value.hasSuffix("\"")) || (value.hasPrefix("'") && value.hasSuffix("'")) {
                value = String(value.dropFirst().dropLast())
            }
            if !key.isEmpty { out[key] = value }
        }
        return out
    }
}
